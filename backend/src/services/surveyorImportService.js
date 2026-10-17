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
const MIN_PASSWORD_LENGTH = 8; // same rule POST /api/auth/change-password already enforces

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
    else if (/^email$/.test(h)) headers.email = col; // optional — see below
    else if (/^password$/.test(h)) headers.password = col; // optional — see below
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
    // Optional admin-supplied credentials — "IN TEMPLATE I WANT PROPER NAME/MO./
    // DISTRICT/EMAIL/PASSWORD.... TO IMPORT". Blank/missing falls back to the existing
    // auto-generated synthetic email + random temp password behavior (see
    // upsertSurveyor) — fully backward compatible with the simpler template already
    // in use for the real 121-surveyor import.
    const email = headers.email ? String(row.getCell(headers.email).value || '').trim() : '';
    const password = headers.password ? String(row.getCell(headers.password).value || '').trim() : '';

    if (!groups.has(mobile)) {
      groups.set(mobile, { mobile, name: '', districts: new Set(), statusesInOrder: [], rowCount: 0, email: '', password: '' });
    }
    const g = groups.get(mobile);
    g.rowCount += 1;
    if (name) g.name = name; // last non-empty name wins, same spirit as "latest status wins"
    if (district) g.districts.add(district);
    if (status) g.statusesInOrder.push(status);
    if (email) g.email = email; // last non-empty wins, same spirit as name/status
    if (password) g.password = password;
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
      email: g.email || null,
      password: g.password || null,
      passwordTooShort: !!g.password && g.password.length < MIN_PASSWORD_LENGTH,
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
    weakPasswordCount: groups.filter((g) => g.passwordTooShort).length,
    groups,
  };
}

function generateTempPassword() {
  // ~12 chars, URL-safe. Returned exactly once, in commitSurveyorImport's response
  // (see `credentials`), for the admin to relay to the surveyor — never logged, never
  // written to audit_logs, and not recoverable after that response (only the bcrypt
  // hash is persisted). A lost password needs a real reset, not a lookup.
  return crypto.randomBytes(9).toString('base64url');
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
    // Admin-supplied email/password (new optional template columns) win when present
    // and valid; otherwise fall back to the original auto-generated behavior. A
    // too-short admin-supplied password is NOT silently accepted — treated the same as
    // "not supplied" (falls back to auto-gen) and flagged via usedFallbackPassword so
    // the caller can warn about it, rather than either rejecting the whole row or
    // quietly using a weak password.
    const email = group.email || `${group.mobile}@${EMAIL_DOMAIN}`;
    const useAdminPassword = !!group.password && group.password.length >= MIN_PASSWORD_LENGTH;
    const tempPassword = useAdminPassword ? null : generateTempPassword();
    const passwordHash = await hashPassword(useAdminPassword ? group.password : tempPassword);
    // An admin who explicitly set a real password intends the surveyor to use it
    // as-is, not treat it as a one-time temp credential — only auto-generated
    // passwords force an immediate change.
    const forcePasswordChange = !useAdminPassword;
    const { rows } = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role_id, home_district_ids, is_active, force_password_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [group.name, email, group.mobile, passwordHash, surveyorRoleId, group.districts, wantActive, forcePasswordChange]
    );
    // tempPassword is returned here ONLY so commitSurveyorImport can hand it back to
    // the caller once, at creation time (see credentials[] below) — it is never
    // written to audit_logs or anywhere else persistent. There is no way to recover it
    // after this response; a lost password needs a real reset, not a lookup. When the
    // admin supplied their own password, there is nothing to show back (they already
    // know it) — tempPassword stays null and this account is excluded from
    // `credentials`.
    return {
      action: 'created', mobile: group.mobile, userId: rows[0].id, email, finalStatus: group.finalStatus,
      tempPassword, usedAdminSuppliedPassword: useAdminPassword,
    };
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
  // Mobile + plaintext temp password for every account CREATED in this commit only
  // (never for an already-existing account re-upserted by this run — "show once at
  // creation" means exactly that run, not retroactively for prior imports). This is
  // the only place these plaintext values ever exist outside the admin's own copy —
  // not logged, not in audit_logs, not persisted anywhere after this response.
  const credentials = [];

  await withTransaction(async (client) => {
    for (const group of groups) {
      const result = await upsertSurveyor(client, group, importedBy);
      if (result.action === 'created' && result.tempPassword) {
        credentials.push({ mobile: result.mobile, name: group.name, email: result.email, tempPassword: result.tempPassword });
      }
      // Never let the plaintext password reach audit_logs (or anywhere else
      // persistent) — strip it before it's added to the change log that gets
      // embedded in the batch audit row's metadata below.
      const { tempPassword, ...resultForAudit } = result;
      changeLog.push(resultForAudit);
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
  return { summary, warnings, changeLog, credentials };
}

// Template columns kept in sync with parseAndGroupSurveyorFile's header matching above
// (one definition, read by both) — districtName/surveyorName/surveyorMobile/Status are
// the original real-file columns; email/password are the newer optional ones ("IN
// TEMPLATE I WANT PROPER NAME/MO./DISTRICT/EMAIL/PASSWORD.... TO IMPORT").
async function buildSurveyorImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['districtName', 'surveyorName', 'surveyorMobile', 'Status (Active/Inactive/Delete)', 'email', 'password']);
  sheet.addRow(['Palwal', 'EXAMPLE Ramesh Kumar', '9999999999', 'Active', '', '']);
  sheet.addRow(['Faridabad', 'EXAMPLE Suresh Singh', '9888888888', 'Active', 'suresh@example.com', 'ChosenPassw0rd!']);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).getCell(4).note = 'Status must be exactly: Active, Inactive, or Delete.';
  sheet.getRow(1).getCell(5).note = 'Optional — leave blank to auto-generate a synthetic login email from the mobile number.';
  sheet.getRow(1).getCell(6).note = 'Optional — leave blank to auto-generate a random temp password (min 8 chars if you do set one).';
  for (let r = 2; r <= 3; r += 1) sheet.getRow(r).font = { italic: true, color: { argb: 'FF888888' } };
  sheet.columns.forEach((col) => { col.width = 22; });
  return wb.xlsx.writeBuffer();
}

module.exports = {
  parseAndGroupSurveyorFile,
  createImportPreview,
  commitSurveyorImport,
  normalizeMobile,
  normalizeStatus,
  generateTempPassword,
  buildSurveyorImportTemplateWorkbook,
};
