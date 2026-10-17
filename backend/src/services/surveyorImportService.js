// Bulk surveyor import from Excel (districtName/surveyorName/surveyorMobile/
// "Status (Active/Inactive/Delete)"). The real source file repeats the SAME surveyor
// once per district/village row it covers — this dedupes by mobile (the stable
// identifier; names collide, mobiles don't — same reasoning as the farmer dedupe
// heuristic elsewhere in this app), aggregates every districtName seen for that mobile
// into its home_district_ids, and resolves a lifecycle action from the Status column.
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { withTransaction } = require('../db/pool');
const { hashPassword } = require('../utils/auth');
const { recordAudit } = require('./auditLog');
const { pickWorksheet } = require('./importService');
const importSessionStore = require('./importSessionStore');

const EMAIL_DOMAIN = 'pmfby-evidence.local'; // matches the existing seed-data convention

function normalizeMobile(raw) {
  if (raw === null || raw === undefined) return null;
  // Excel often hands back a phone-number-shaped cell as a JS number — convert without
  // ever going through toString() on a float that could introduce scientific notation
  // or lose a leading zero that was actually present in the source.
  let s;
  if (typeof raw === 'number') s = String(Math.trunc(raw));
  else if (typeof raw === 'object' && raw.text !== undefined) s = String(raw.text);
  else s = String(raw);
  s = s.trim().replace(/\.0+$/, '');
  return s || null;
}

function normalizeStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'active') return 'Active';
  if (lower === 'inactive') return 'Inactive';
  if (lower === 'delete') return 'Delete';
  return null; // unrecognized value treated the same as blank — never guessed at
}

// Parses the sheet and groups by mobile. Returns an array of group records, each:
// { mobile, name (last non-empty seen), districts: string[] (deduped, sorted),
//   rowCount, statusValuesSeen: string[] (distinct, in file order),
//   finalStatus: 'Active'|'Inactive'|'Delete'|null, statusConflict: boolean }
async function parseAndGroupSurveyorFile(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = pickWorksheet(workbook);
  if (!sheet) throw new Error('No worksheet found in uploaded file');

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = String(cell.value || '').trim().toLowerCase();
    if (/^districtname$/.test(h)) headers.district = col;
    else if (/^surveyorname$/.test(h)) headers.name = col;
    else if (/^surveyormobile$/.test(h)) headers.mobile = col;
    else if (/^status/.test(h)) headers.status = col; // "Status (Active/Inactive/Delete)"
  });
  if (!headers.mobile) throw new Error('Could not find a surveyorMobile column in this file');

  const groups = new Map(); // mobile -> accumulator
  let totalRows = 0;
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const mobile = normalizeMobile(row.getCell(headers.mobile).value);
    if (!mobile) continue; // a row with no mobile at all can't be matched to anyone
    totalRows += 1;

    const name = headers.name ? String(row.getCell(headers.name).value || '').trim() : '';
    const district = headers.district ? String(row.getCell(headers.district).value || '').trim() : '';
    const status = headers.status ? normalizeStatus(row.getCell(headers.status).value) : null;

    if (!groups.has(mobile)) {
      groups.set(mobile, { mobile, name: '', districts: new Set(), statusesInOrder: [], rowCount: 0 });
    }
    const g = groups.get(mobile);
    g.rowCount += 1;
    if (name) g.name = name; // last non-empty name wins, same spirit as "latest status wins"
    if (district) g.districts.add(district);
    if (status) g.statusesInOrder.push(status);
  }

  const result = [];
  for (const g of groups.values()) {
    const distinctStatuses = [...new Set(g.statusesInOrder)];
    const finalStatus = g.statusesInOrder.length ? g.statusesInOrder[g.statusesInOrder.length - 1] : null;
    result.push({
      mobile: g.mobile,
      name: g.name || g.mobile,
      districts: [...g.districts].sort(),
      rowCount: g.rowCount,
      statusValuesSeen: distinctStatuses,
      finalStatus,
      statusConflict: distinctStatuses.length > 1,
    });
  }
  return { totalRows, groups: result };
}

async function createImportPreview({ buffer, originalFilename, uploadedBy }) {
  const { totalRows, groups } = await parseAndGroupSurveyorFile(buffer);
  const sessionId = importSessionStore.createSession({
    headers: [], rows: groups, originalFilename, uploadedBy,
  });
  return {
    sessionId,
    totalRows,
    uniqueSurveyors: groups.length,
    noStatusCount: groups.filter((g) => !g.finalStatus).length,
    conflictCount: groups.filter((g) => g.statusConflict).length,
    groups,
  };
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 chars, URL-safe, never logged/returned
}

// One upsert per surveyor group. NOT exported directly — always called from
// commitSurveyorImport inside one transaction so the whole batch is atomic and so the
// batch-level audit summary below reflects exactly what was written.
async function upsertSurveyor(client, group, importedBy) {
  const { rows: roleRows } = await client.query("SELECT id FROM roles WHERE key = 'surveyor'");
  const surveyorRoleId = roleRows[0]?.id;
  if (!surveyorRoleId) throw new Error('surveyor role not seeded');

  const { rows: existingRows } = await client.query('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [group.mobile]);
  const existing = existingRows[0] || null;

  // Rule: an explicit status in the file drives a lifecycle change; a BLANK/unrecognized
  // status never does (see ROADMAP.md "silence does not act"). If the surveyor doesn't
  // exist yet and has no usable status, there is nothing safe to create — skip.
  if (!group.finalStatus) {
    return { action: existing ? 'skipped_no_status_existing' : 'skipped_no_status_new', mobile: group.mobile };
  }

  if (group.finalStatus === 'Delete') {
    if (!existing) return { action: 'skipped_delete_unknown', mobile: group.mobile };
    if (existing.deleted_at) return { action: 'already_deleted', mobile: group.mobile };
    await client.query(
      `UPDATE users SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = $1`,
      [existing.id]
    );
    return { action: 'deleted', mobile: group.mobile, userId: existing.id };
  }

  const wantActive = group.finalStatus === 'Active';

  if (!existing) {
    if (!wantActive) {
      // An Inactive-only surveyor who has never had an account is created, but
      // immediately inactive — preserves the real-world fact that this mobile is a
      // known surveyor (keeps home-district history), without granting login access.
    }
    const email = `${group.mobile}@${EMAIL_DOMAIN}`;
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const { rows } = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role_id, home_district_ids, is_active, force_password_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
      [group.name, email, group.mobile, passwordHash, surveyorRoleId, group.districts, wantActive]
    );
    return { action: 'created', mobile: group.mobile, userId: rows[0].id, email, finalStatus: group.finalStatus };
  }

  // Existing account: re-upload upsert — update districts + status; never touch
  // name/email/password on a re-import (those are account-management concerns, not
  // this file's business).
  const changed = existing.is_active !== wantActive
    || JSON.stringify([...existing.home_district_ids].sort()) !== JSON.stringify(group.districts);
  await client.query(
    `UPDATE users SET is_active = $2, home_district_ids = $3, updated_at = now() WHERE id = $1`,
    [existing.id, wantActive, group.districts]
  );
  if (!changed) return { action: 'unchanged', mobile: group.mobile, userId: existing.id };
  return {
    action: wantActive ? (existing.is_active ? 'updated' : 'reactivated') : 'deactivated',
    mobile: group.mobile, userId: existing.id, finalStatus: group.finalStatus,
  };
}

async function commitSurveyorImport({ sessionId, importedBy }) {
  const session = importSessionStore.getSession(sessionId);
  if (!session) throw new Error('Import session not found or expired. Please re-upload.');
  const groups = session.rows;

  const summary = {
    created: 0, updated: 0, reactivated: 0, deactivated: 0, deleted: 0,
    unchanged: 0, skippedNoStatus: 0, skippedDeleteUnknown: 0, alreadyDeleted: 0,
  };
  const warnings = groups.filter((g) => g.statusConflict).map((g) => ({
    mobile: g.mobile, name: g.name, statusValuesSeen: g.statusValuesSeen, resolvedTo: g.finalStatus,
  }));
  const changeLog = [];

  await withTransaction(async (client) => {
    for (const group of groups) {
      const result = await upsertSurveyor(client, group, importedBy);
      changeLog.push(result);
      switch (result.action) {
        case 'created': summary.created += 1; break;
        case 'updated': summary.updated += 1; break;
        case 'reactivated': summary.reactivated += 1; break;
        case 'deactivated': summary.deactivated += 1; break;
        case 'deleted': summary.deleted += 1; break;
        case 'unchanged': summary.unchanged += 1; break;
        case 'skipped_no_status_existing':
        case 'skipped_no_status_new': summary.skippedNoStatus += 1; break;
        case 'skipped_delete_unknown': summary.skippedDeleteUnknown += 1; break;
        case 'already_deleted': summary.alreadyDeleted += 1; break;
        default: break;
      }
    }

    // ONE batch-summary audit row rather than one row per surveyor (tens of thousands
    // of individual audit_logs rows for a single import would swamp the audit log for
    // every other feature) — but the full per-mobile change list is preserved in its
    // metadata, so "what changed for surveyor X" is never lost, just not a top-level
    // audit_logs row of its own. See ROADMAP.md.
    await recordAudit(client, {
      userId: importedBy,
      action: 'bulk_import_surveyors',
      resourceType: 'users',
      metadata: { summary, warnings, changeLog },
    });
  });

  importSessionStore.deleteSession(sessionId);
  return { summary, warnings, changeLog };
}

module.exports = {
  parseAndGroupSurveyorFile,
  createImportPreview,
  commitSurveyorImport,
  normalizeMobile,
  normalizeStatus,
};
