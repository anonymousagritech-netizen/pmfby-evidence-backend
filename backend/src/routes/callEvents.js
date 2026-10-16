const express = require('express');
const { withTransaction, pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned, getCaseForUserOrNull } = require('../services/resourceScope');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

const VALID_CALL_OUTCOMES = [
  'pending', 'answered', 'not_answered', 'busy', 'switched_off', 'unreachable',
  'invalid_number', 'farmer_not_found',
];

// Create a call_event. Attempt No. is ALWAYS backend-assigned (never surveyor-typed) —
// atomically incremented from survey_cases.attempt_count in the same transaction.
// Idempotent on client-supplied idempotencyKey (offline-queue-safe).
router.post('/', async (req, res, next) => {
  try {
    const { caseId, phoneNumber, idempotencyKey, geo } = req.body;
    if (!caseId || !phoneNumber) return res.status(400).json({ error: 'caseId and phoneNumber required' });

    if (req.user.role_key !== ROLES.SURVEYOR) {
      return res.status(403).json({ error: 'Only surveyors initiate calls' });
    }
    // Server-side reassignment/revocation check: reject if farmer no longer assigned.
    const caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    if (!caseRow) return res.status(403).json({ error: 'Farmer is not currently assigned to you' });

    if (idempotencyKey) {
      const existing = await pool.query('SELECT * FROM call_events WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) return res.status(200).json({ callEvent: existing.rows[0], deduped: true });
    }

    const result = await withTransaction(async (client) => {
      const { rows: caseRows } = await client.query(
        'UPDATE survey_cases SET attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1 RETURNING attempt_count',
        [caseId]
      );
      const attemptNo = caseRows[0].attempt_count;
      const { rows } = await client.query(
        `INSERT INTO call_events (case_id, farmer_id, user_id, phone_number, attempt_no,
           idempotency_key, geo_lat, geo_lon, geo_accuracy_m, geo_captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,
           CASE WHEN $7::numeric IS NOT NULL THEN now() ELSE NULL END)
         RETURNING *`,
        [caseId, caseRow.farmer_id, req.user.id, phoneNumber, attemptNo, idempotencyKey || null,
          geo?.lat ?? null, geo?.lon ?? null, geo?.accuracyM ?? null]
      );
      await recordAudit(client, {
        userId: req.user.id, action: 'initiate_call', resourceType: 'call_events', resourceId: rows[0].id,
      });
      return rows[0];
    });
    res.status(201).json({ callEvent: result });
  } catch (err) {
    if (err.code === '23505') {
      const existing = await pool.query('SELECT * FROM call_events WHERE idempotency_key = $1', [req.body.idempotencyKey]);
      return res.status(200).json({ callEvent: existing.rows[0], deduped: true });
    }
    next(err);
  }
});

// Record outcome afterward. outcome_source is ALWAYS 'user_entered' — Linking/tel: gives
// no verified call-state callback, so we never claim otherwise.
router.patch('/:id/outcome', async (req, res, next) => {
  try {
    const { outcome, personContacted, geo } = req.body;
    if (!VALID_CALL_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of ${VALID_CALL_OUTCOMES.join(', ')}` });
    }
    const { rows: callRows } = await pool.query('SELECT * FROM call_events WHERE id = $1', [req.params.id]);
    const callEvent = callRows[0];
    if (!callEvent) return res.status(404).json({ error: 'Not found' });

    if (req.user.role_key === ROLES.SURVEYOR && callEvent.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your call event' });
    }
    if (req.user.role_key === ROLES.MANAGER) {
      const caseRow = await getCaseForUserOrNull(callEvent.case_id, req.user);
      if (!caseRow) return res.status(403).json({ error: 'Out of scope' });
    }

    const { rows } = await pool.query(
      `UPDATE call_events SET outcome = $2, outcome_source = 'user_entered', outcome_recorded_at = now(),
         person_contacted_type = COALESCE($3, person_contacted_type),
         person_contacted_name = COALESCE($4, person_contacted_name),
         person_contacted_relation = COALESCE($5, person_contacted_relation),
         geo_lat = COALESCE($6::numeric, geo_lat), geo_lon = COALESCE($7::numeric, geo_lon),
         geo_accuracy_m = COALESCE($8::numeric, geo_accuracy_m),
         geo_captured_at = CASE WHEN $6::numeric IS NOT NULL THEN now() ELSE geo_captured_at END
       WHERE id = $1 RETURNING *`,
      [req.params.id, outcome, personContacted?.type ?? null, personContacted?.name ?? null,
        personContacted?.relation ?? null, geo?.lat ?? null, geo?.lon ?? null, geo?.accuracyM ?? null]
    );
    await recordAudit(null, { userId: req.user.id, action: 'record_call_outcome', resourceType: 'call_events', resourceId: req.params.id, metadata: { outcome } });
    res.json({ callEvent: rows[0] });
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

    const { rows } = await pool.query('SELECT * FROM call_events WHERE case_id = $1 ORDER BY initiated_at DESC', [req.params.caseId]);
    res.json({ callEvents: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
