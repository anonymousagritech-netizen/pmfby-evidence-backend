const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned } = require('../services/resourceScope');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Records that the SMS composer was opened with the rendered text — status is always
// 'drafted' or 'opened_composer', never 'sent'/'delivered' (composer-opened is not
// delivery confirmation; see SMS flow spec).
router.post('/', async (req, res, next) => {
  try {
    const { caseId, templateId, renderedText, phoneNumber, status, callEventId, idempotencyKey } = req.body;
    if (!caseId || !templateId || !renderedText) {
      return res.status(400).json({ error: 'caseId, templateId, renderedText required' });
    }
    if (req.user.role_key !== ROLES.SURVEYOR) return res.status(403).json({ error: 'Only surveyors send messages' });

    const caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    if (!caseRow) return res.status(403).json({ error: 'Farmer is not currently assigned to you' });

    if (idempotencyKey) {
      const existing = await pool.query('SELECT * FROM message_events WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) return res.status(200).json({ messageEvent: existing.rows[0], deduped: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO message_events (case_id, farmer_id, user_id, call_event_id, template_id,
         rendered_text, attempt_no, phone_number, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [caseId, caseRow.farmer_id, req.user.id, callEventId || null, templateId, renderedText,
        caseRow.attempt_count, phoneNumber || null, status || 'drafted', idempotencyKey || null]
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
    if (!['drafted', 'opened_composer'].includes(status)) {
      return res.status(400).json({ error: "status must be 'drafted' or 'opened_composer'" });
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
