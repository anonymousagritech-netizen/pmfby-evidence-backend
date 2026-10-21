const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned } = require('../services/resourceScope');
const { storage } = require('../lib/storage');
const { sha256Buffer } = require('../utils/checksum');
const { resolveSession } = require('../services/sessionScope');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.use(authenticate);

// Explicitly-initiated voice-note fallback (NOT automatic cellular call recording — see
// RISKS.md). Requires on-screen consent acknowledgement from the client before upload.
// Also covers missed-call voice-message LOCAL PLAYBACK logging (kind=voice_message_playback):
// automated injection into a live cellular call is NOT implemented (platform limitation).
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { sessionId, callEventId, kind, consentAcknowledged, durationSeconds, voiceTemplateId } = req.body;
    let caseId = req.body.caseId;
    if (req.user.role_key !== ROLES.SURVEYOR) return res.status(403).json({ error: 'Only surveyors record voice notes' });
    if (!caseId && sessionId) {
      const resolved = await resolveSession(sessionId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      caseId = resolved.caseId;
    }
    if (!caseId) return res.status(400).json({ error: 'caseId or sessionId required' });
    if (kind !== 'voice_message_playback' && consentAcknowledged !== 'true' && consentAcknowledged !== true) {
      return res.status(400).json({ error: 'consentAcknowledged must be true for a recorded voice note' });
    }

    // voice_template_id is an integer column: parse defensively so a value like "1.0" (or junk)
    // can never reach Postgres as a type error and surface as a 500.
    let templateIdNum = null;
    if (voiceTemplateId !== undefined && voiceTemplateId !== null && voiceTemplateId !== '') {
      templateIdNum = Number.parseInt(String(voiceTemplateId), 10);
      if (Number.isNaN(templateIdNum)) return res.status(400).json({ error: 'voiceTemplateId must be a number' });
    }

    const caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    if (!caseRow) return res.status(403).json({ error: 'Farmer is not currently assigned to you' });

    let fileKey = null;
    let checksum = null;
    if (req.file) {
      checksum = sha256Buffer(req.file.buffer);
      const { rows: idRow } = await pool.query('SELECT gen_random_uuid() AS id');
      fileKey = `call_recordings/${idRow[0].id}${require('path').extname(req.file.originalname || '') || '.m4a'}`;
      await storage.putObject(fileKey, req.file.buffer, { encrypt: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO call_recordings (call_event_id, case_id, user_id, kind, file_key,
         checksum_sha256, duration_seconds, consent_acknowledged, voice_template_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [callEventId || null, caseId, req.user.id, kind || 'voice_note', fileKey, checksum,
        durationSeconds || null, kind !== 'voice_message_playback' ? true : false, templateIdNum]
    );
    res.status(201).json({ recording: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/case/:caseId', async (req, res, next) => {
  try {
    const caseRow = req.user.role_key === ROLES.SURVEYOR
      ? await getCaseIfSurveyorAssigned(req.params.caseId, req.user.id)
      : { id: req.params.caseId };
    if (!caseRow) return res.status(403).json({ error: 'Not accessible' });
    const { rows } = await pool.query('SELECT * FROM call_recordings WHERE case_id = $1 ORDER BY created_at DESC', [req.params.caseId]);
    res.json({ recordings: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
