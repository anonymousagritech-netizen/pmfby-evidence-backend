const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseIfSurveyorAssigned, getCaseForUserOrNull } = require('../services/resourceScope');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Start an emergency incident. Press-and-hold confirmation, 120s hard cap, and the
// timer/recording controller all live on the client (see mobile/src/lib/emergencyTimer.js
// for the unit-tested controller) — this endpoint just creates the backend record and
// flags the case. No locked-screen/background capture is implemented (platform
// limitation, see RISKS.md); this is always an explicit foreground action.
router.post('/', async (req, res, next) => {
  try {
    const { caseId, incidentType, callEventId, idempotencyKey } = req.body;
    if (!caseId) return res.status(400).json({ error: 'caseId required' });
    if (req.user.role_key !== ROLES.SURVEYOR) return res.status(403).json({ error: 'Only surveyors raise emergencies' });

    const caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    if (!caseRow) return res.status(403).json({ error: 'Farmer is not currently assigned to you' });

    if (idempotencyKey) {
      const existing = await pool.query('SELECT * FROM emergency_incidents WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) return res.status(200).json({ incident: existing.rows[0], deduped: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO emergency_incidents (case_id, farmer_id, user_id, call_event_id, incident_type, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [caseId, caseRow.farmer_id, req.user.id, callEventId || null, incidentType || 'THREAT', idempotencyKey || null]
    );
    await pool.query('UPDATE survey_cases SET forceful_survey_flag = true WHERE id = $1', [caseId]);
    await recordAudit(null, { userId: req.user.id, action: 'start_emergency_incident', resourceType: 'emergency_incidents', resourceId: rows[0].id });
    res.status(201).json({ incident: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      const existing = await pool.query('SELECT * FROM emergency_incidents WHERE idempotency_key = $1', [req.body.idempotencyKey]);
      return res.status(200).json({ incident: existing.rows[0], deduped: true });
    }
    next(err);
  }
});

// Stop/finalize: status in recording|completed|cancelled|uploaded|queued_offline,
// duration (hard-capped client-side at 120s), description (Format 4 fields).
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, durationSeconds, description, whatsappReportStatus, appUpdateStatus } = req.body;
    const { rows: existingRows } = await pool.query('SELECT * FROM emergency_incidents WHERE id = $1', [req.params.id]);
    const incident = existingRows[0];
    if (!incident) return res.status(404).json({ error: 'Not found' });
    if (req.user.role_key === ROLES.SURVEYOR && incident.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your incident' });
    }
    const { rows } = await pool.query(
      `UPDATE emergency_incidents SET
         status = COALESCE($2::text, status), duration_seconds = COALESCE($3::numeric, duration_seconds),
         description = COALESCE($4::text, description),
         whatsapp_report_status = COALESCE($5::text, whatsapp_report_status),
         app_update_status = COALESCE($6::text, app_update_status),
         ended_at = CASE WHEN $2::text IN ('completed','cancelled') THEN now() ELSE ended_at END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, status || null, durationSeconds ?? null, description || null,
        whatsappReportStatus || null, appUpdateStatus || null]
    );
    res.json({ incident: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Manager/admin review+resolve — REQUIRED before the tied case can be reassigned/closed.
router.patch('/:id/resolve', async (req, res, next) => {
  try {
    if (![ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(req.user.role_key)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows: existingRows } = await pool.query('SELECT * FROM emergency_incidents WHERE id = $1', [req.params.id]);
    const incident = existingRows[0];
    if (!incident) return res.status(404).json({ error: 'Not found' });
    if (req.user.role_key === ROLES.MANAGER) {
      const caseRow = await getCaseForUserOrNull(incident.case_id, req.user);
      if (!caseRow) return res.status(403).json({ error: 'Out of scope' });
    }
    const { resolutionNotes } = req.body;
    const { rows } = await pool.query(
      `UPDATE emergency_incidents SET resolved_by = $2, resolved_at = now(), resolution_notes = $3,
         requires_manager_review = false, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.user.id, resolutionNotes || null]
    );
    await recordAudit(null, { userId: req.user.id, action: 'resolve_emergency_incident', resourceType: 'emergency_incidents', resourceId: req.params.id });
    res.json({ incident: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (![ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(req.user.role_key)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await pool.query(
      `SELECT ei.*, sc.district_id, sc.state_id FROM emergency_incidents ei
       JOIN survey_cases sc ON sc.id = ei.case_id ORDER BY ei.created_at DESC`
    );
    const visible = req.user.role_key === ROLES.SUPER_ADMIN ? rows : rows.filter((r) => (
      (req.user.scope_district_id && r.district_id === req.user.scope_district_id)
      || (!req.user.scope_district_id && req.user.scope_state_id && r.state_id === req.user.scope_state_id)
    ));
    res.json({ incidents: visible });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
