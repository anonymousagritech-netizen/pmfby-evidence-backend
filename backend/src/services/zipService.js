// ZIP generation: one ZIP per contact attempt (anchored to a call_event). Async with
// status tracking (pending -> processing -> ready/failed), idempotent (re-requesting a
// ready zip returns the existing one), integrity-verified (checksum_manifest.txt covers
// every included file, verified after writing before marking ready). Only
// files/folders that actually exist are included — nothing fabricated.
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool } = require('../db/pool');
const { storage } = require('../lib/storage');
const { sha256Buffer, sha256File } = require('../utils/checksum');
const { buildZipFilename, dedupeFilename } = require('../utils/filename');

async function loadBundle(callEventId) {
  const { rows: callRows } = await pool.query(
    `SELECT ce.*, fr.farmer_name, fr.village_name, fr.farmer_mobile, sc.id AS case_id_check
     FROM call_events ce
     JOIN farmer_records fr ON fr.id = ce.farmer_id
     JOIN survey_cases sc ON sc.id = ce.case_id
     WHERE ce.id = $1`,
    [callEventId]
  );
  const callEvent = callRows[0];
  if (!callEvent) throw new Error('call_event not found');

  const { rows: caseRows } = await pool.query('SELECT * FROM survey_cases WHERE id = $1', [callEvent.case_id]);
  const { rows: farmerRows } = await pool.query('SELECT * FROM farmer_records WHERE id = $1', [callEvent.farmer_id]);
  const { rows: messageEvents } = await pool.query(
    'SELECT * FROM message_events WHERE call_event_id = $1 ORDER BY created_at', [callEventId]
  );
  const { rows: evidenceFiles } = await pool.query(
    'SELECT * FROM evidence_files WHERE call_event_id = $1 AND deleted_at IS NULL ORDER BY created_at', [callEventId]
  );
  const { rows: callRecordings } = await pool.query(
    'SELECT * FROM call_recordings WHERE call_event_id = $1 ORDER BY created_at', [callEventId]
  );
  const { rows: emergencyIncidents } = await pool.query(
    'SELECT * FROM emergency_incidents WHERE call_event_id = $1 ORDER BY created_at', [callEventId]
  );

  return {
    callEvent, case: caseRows[0], farmer: farmerRows[0],
    messageEvents, evidenceFiles, callRecordings, emergencyIncidents,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
  return [header, ...lines].join('\n');
}

async function fetchExistingFilenames() {
  const { rows } = await pool.query('SELECT filename FROM zip_archives WHERE filename IS NOT NULL');
  return rows.map((r) => r.filename);
}

async function buildZipBuffer(bundle) {
  const tmpPath = path.join(os.tmpdir(), `pmfby-zip-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const output = fs.createWriteStream(tmpPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const checksumManifestLines = [];
  const finished = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);

  function addJson(name, obj) {
    const buf = Buffer.from(JSON.stringify(obj, null, 2));
    archive.append(buf, { name });
    checksumManifestLines.push(`${sha256Buffer(buf)}  ${name}`);
  }

  function addText(name, text) {
    const buf = Buffer.from(text);
    archive.append(buf, { name });
    checksumManifestLines.push(`${sha256Buffer(buf)}  ${name}`);
  }

  async function addStoredFile(name, fileKey, encrypted) {
    if (!fileKey) return;
    if (!(await storage.exists(fileKey))) return;
    const buf = await storage.getObject(fileKey, { encrypted });
    archive.append(buf, { name });
    checksumManifestLines.push(`${sha256Buffer(buf)}  ${name}`);
  }

  addJson('farmer_details.json', bundle.farmer);
  addJson('case_details.json', bundle.case);

  const callLogCsv = toCsv([bundle.callEvent], [
    'id', 'phone_number', 'attempt_no', 'initiated_at', 'outcome', 'outcome_source',
    'outcome_recorded_at', 'person_contacted_type', 'person_contacted_name',
    'person_contacted_relation', 'geo_lat', 'geo_lon', 'geo_accuracy_m',
  ]);
  addText('call/call_log.csv', callLogCsv);

  for (const rec of bundle.callRecordings) {
    const ext = rec.file_key ? path.extname(rec.file_key) || '.m4a' : '.m4a';
    await addStoredFile(`call/supported_call_recordings/${rec.id}${ext}`, rec.file_key, rec.encrypted);
  }

  if (bundle.messageEvents.length > 0) {
    const messageLogCsv = toCsv(bundle.messageEvents, [
      'id', 'template_id', 'attempt_no', 'status', 'phone_number', 'created_at',
    ]);
    addText('message/message_log.csv', messageLogCsv);
    const renderedText = bundle.messageEvents
      .map((m) => `--- message_event ${m.id} (template ${m.template_id}, status ${m.status}) ---\n${m.rendered_text}`)
      .join('\n\n');
    addText('message/rendered_messages.txt', renderedText);
  }

  for (const file of bundle.evidenceFiles) {
    if (file.kind === 'screenshot') {
      const ext = file.original_filename ? path.extname(file.original_filename) : '';
      await addStoredFile(`user_provided_screenshots/${file.id}${ext}`, file.file_key, file.encrypted);
    }
    if (file.kind === 'emergency_audio' || file.kind === 'emergency_video') {
      const ext = file.kind === 'emergency_audio' ? '.m4a' : '.mp4';
      await addStoredFile(`emergency/emergency_audio+video/${file.id}${ext}`, file.file_key, file.encrypted);
    }
  }

  if (bundle.emergencyIncidents.length > 0) {
    addJson('emergency/incident_report.json', bundle.emergencyIncidents);
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    case_id: bundle.case.id,
    farmer_id: bundle.farmer.id,
    call_event_id: bundle.callEvent.id,
    included_message_events: bundle.messageEvents.length,
    included_evidence_files: bundle.evidenceFiles.map((f) => ({ id: f.id, kind: f.kind })),
    included_call_recordings: bundle.callRecordings.length,
    included_emergency_incidents: bundle.emergencyIncidents.length,
  };
  addJson('manifest.json', manifest);

  // checksum_manifest.txt itself is appended last and NOT included in its own checksums.
  archive.append(Buffer.from(checksumManifestLines.join('\n')), { name: 'checksum_manifest.txt' });

  await archive.finalize();
  await finished;

  const zipBuffer = await fs.promises.readFile(tmpPath);
  await fs.promises.unlink(tmpPath);
  return { zipBuffer, checksumManifestLines };
}

async function generateZipForCallEvent({ callEventId, requestedBy }) {
  const existing = await pool.query(
    `SELECT * FROM zip_archives WHERE call_event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callEventId]
  );
  if (existing.rows[0] && existing.rows[0].status === 'ready') {
    return existing.rows[0]; // idempotent
  }

  const bundle = await loadBundle(callEventId);

  let zipRow = existing.rows[0];
  if (!zipRow) {
    const inserted = await pool.query(
      `INSERT INTO zip_archives (case_id, farmer_id, call_event_id, requested_by, status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
      [bundle.case.id, bundle.farmer.id, callEventId, requestedBy]
    );
    zipRow = inserted.rows[0];
  }

  await pool.query(`UPDATE zip_archives SET status = 'processing', updated_at = now() WHERE id = $1`, [zipRow.id]);

  try {
    const { zipBuffer } = await buildZipBuffer(bundle);
    const checksum = sha256Buffer(zipBuffer);

    const existingNames = await fetchExistingFilenames();
    const date = bundle.callEvent.initiated_at.toISOString().slice(0, 10);
    const time = bundle.callEvent.initiated_at.toISOString().slice(11, 19).replace(/:/g, '-');
    const desiredName = buildZipFilename({
      farmerName: bundle.farmer.farmer_name,
      village: bundle.farmer.village_name,
      date,
      time,
    });
    const filename = dedupeFilename(desiredName, existingNames);
    const fileKey = `zips/${zipRow.id}/${filename}`;

    await storage.putObject(fileKey, zipBuffer, { encrypt: true });

    // Integrity verification: re-read what we just wrote (decrypting), confirm checksum
    // matches, before marking ready.
    const verifyBuffer = await storage.getObject(fileKey, { encrypted: true });
    const verifyChecksum = sha256Buffer(verifyBuffer);
    if (verifyChecksum !== checksum) {
      throw new Error('ZIP integrity verification failed after write');
    }

    const { rows } = await pool.query(
      `UPDATE zip_archives SET status = 'ready', file_key = $2, filename = $3,
         checksum_sha256 = $4, size_bytes = $5, ready_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [zipRow.id, fileKey, filename, checksum, zipBuffer.length]
    );
    return rows[0];
  } catch (err) {
    await pool.query(
      `UPDATE zip_archives SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1`,
      [zipRow.id, err.message]
    );
    throw err;
  }
}

module.exports = { generateZipForCallEvent, loadBundle };
