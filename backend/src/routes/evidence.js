const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned, getCaseForUserOrNull } = require('../services/resourceScope');
const { storage } = require('../lib/storage');
const { sha256Buffer } = require('../utils/checksum');
const { recordAudit } = require('../services/auditLog');
const { resolveSession } = require('../services/sessionScope');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.use(authenticate);

const VALID_KINDS = ['screenshot', 'call_screenshot', 'voice_note', 'emergency_audio', 'emergency_video', 'other'];

// Upload evidence (screenshot reference, voice note, emergency media). Stores
// AES-256-GCM-encrypted at rest; records sha256 checksum of the plaintext bytes.
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { sessionId, kind, callEventId, messageEventId, emergencyIncidentId, idempotencyKey } = req.body;
    let caseId = req.body.caseId;
    let contactSessionId = null;
    if (!caseId && sessionId) {
      const resolved = await resolveSession(sessionId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      caseId = resolved.caseId;
      contactSessionId = sessionId;
    }
    if (!caseId || !kind || !req.file) return res.status(400).json({ error: 'caseId (or sessionId), kind, file required' });
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${VALID_KINDS.join(', ')}` });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    else caseRow = await getCaseForUserOrNull(caseId, req.user);
    if (!caseRow) return res.status(403).json({ error: 'Not accessible' });

    if (idempotencyKey) {
      const existing = await pool.query('SELECT * FROM evidence_files WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) return res.status(200).json({ evidenceFile: existing.rows[0], deduped: true });
    }

    const checksum = sha256Buffer(req.file.buffer);
    const { rows: insertedRows } = await pool.query(
      `INSERT INTO evidence_files (case_id, farmer_id, user_id, call_event_id, message_event_id,
         emergency_incident_id, kind, original_filename, checksum_sha256, encrypted,
         upload_status, size_bytes, idempotency_key, contact_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'pending',$10,$11,$12) RETURNING *`,
      [caseId, caseRow.farmer_id, req.user.id, callEventId || null, messageEventId || null,
        emergencyIncidentId || null, kind, req.file.originalname, checksum, req.file.size, idempotencyKey || null,
        contactSessionId]
    );
    const evidenceFile = insertedRows[0];

    const fileKey = `evidence/${evidenceFile.id}/${req.file.originalname || 'file'}`;
    await storage.putObject(fileKey, req.file.buffer, { encrypt: true });

    const { rows } = await pool.query(
      `UPDATE evidence_files SET file_key = $2, upload_status = 'uploaded' WHERE id = $1 RETURNING *`,
      [evidenceFile.id, fileKey]
    );
    await recordAudit(null, { userId: req.user.id, action: 'upload_evidence', resourceType: 'evidence_files', resourceId: evidenceFile.id, metadata: { kind } });
    res.status(201).json({ evidenceFile: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/case/:caseId', async (req, res, next) => {
  try {
    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(req.params.caseId, req.user.id);
    else caseRow = await getCaseForUserOrNull(req.params.caseId, req.user);
    if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });

    const { rows } = await pool.query(
      'SELECT * FROM evidence_files WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [req.params.caseId]
    );
    res.json({ evidenceFiles: rows });
  } catch (err) {
    next(err);
  }
});

// Restricted download with audit logging. Role + scope enforced identically to the
// case-level access check.
router.get('/:id/download', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM evidence_files WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'Not found' });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(file.case_id, req.user.id);
    else caseRow = await getCaseForUserOrNull(file.case_id, req.user);
    if (!caseRow) return res.status(403).json({ error: 'Not accessible' });

    if (!file.file_key) return res.status(409).json({ error: 'File not yet uploaded' });
    const buffer = await storage.getObject(file.file_key, { encrypted: file.encrypted });
    await recordAudit(null, { userId: req.user.id, action: 'download_evidence', resourceType: 'evidence_files', resourceId: file.id });
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_filename || file.id}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
