const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned } = require('../services/resourceScope');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Records an SMS attempt with the rendered text. Status values:
// 'drafted' / 'opened_composer' — the legacy composer-handoff path (no delivery
// confirmation possible, see SmsComposer.kt); 'sent' / 'send_failed' / 'delivered' /
// 'delivery_failed' — the direct-send path (DirectSmsSender.kt), reporting REAL
// carrier-level status via SmsManager PendingIntent broadcasts.
router.post('/', async (req, res, next) => {
  try {
    const { caseId, sessionId, templateId, renderedText, phoneNumber, status, callEventId, idempotencyKey } = req.body;
    // sessionId OR caseId required (session-based is the new preferred path).
    if (!templateId || !renderedText) {
      return res.status(400).json({ error: 'templateId, renderedText required' });
    }
    if (!caseId && !sessionId) {
      return res.status(400).json({ error: 'caseId or sessionId required' });
    }
    if (req.user.role_key !== ROLES.SURVEYOR) return res.status(403).json({ error: 'Only surveyors send messages' });

    if (idempotencyKey) {
      const existing = await pool.query('SELECT * FROM message_events WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) return res.status(200).json({ messageEvent: existing.rows[0], deduped: true });
    }

    let farmerId, resolvedCaseId, attemptNo;

    if (sessionId) {
      // Session path: one message event covers all cases in the batch.
      const { rows: [session] } = await pool.query(
        `SELECT * FROM contact_sessions WHERE id = $1`, [sessionId]
      );
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
      farmerId = session.farmer_id;
      resolvedCaseId = null;   // session-level event has no single case_id
      // Attempt no = number of sessions for this farmer+batch so far
      const { rows: [{ cnt }] } = await pool.query(
        `SELECT count(*)::int AS cnt FROM contact_sessions
         WHERE farmer_id = $1 AND intimation_batch_date IS NOT DISTINCT FROM $2`,
        [session.farmer_id, session.intimation_batch_date]
      );
      attemptNo = cnt;
    } else {
      const caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
      if (!caseRow) return res.status(403).json({ error: 'Farmer is not currently assigned to you' });
      farmerId = caseRow.farmer_id;
      resolvedCaseId = caseId;
      attemptNo = caseRow.attempt_count;
    }

    const { rows } = await pool.query(
      `INSERT INTO message_events (case_id, farmer_id, user_id, call_event_id, template_id,
         rendered_text, attempt_no, phone_number, status, idempotency_key, contact_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [resolvedCaseId, farmerId, req.user.id, callEventId || null, templateId, renderedText,
        attemptNo, phoneNumber || null, status || 'drafted', idempotencyKey || null, sessionId || null]
    );
    await recordAudit(null, { userId: req.user.id, action: 'create_message_event', resourceType: 'message_events', resourceId: rows[0].id });
    res.status(201).json({ messageEvent: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      const existing = await pool.query('SELECT * FROM message_events WHERE idempotency_key = $1', [req.body.idempotencyKey]);
      return res.status(200).json({ messageEvent: existing.rows[0], deduped: true });
    }
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const VALID_STATUSES = ['drafted', 'opened_composer', 'sent', 'send_failed', 'delivered', 'delivery_failed', 'send_status_unknown'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
    }
    const { rows: existingRows } = await pool.query('SELECT * FROM message_events WHERE id = $1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    if (req.user.role_key === ROLES.SURVEYOR && existingRows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your message event' });
    }
    const { rows } = await pool.query('UPDATE message_events SET status = $2 WHERE id = $1 RETURNING *', [req.params.id, status]);
    res.json({ messageEvent: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
