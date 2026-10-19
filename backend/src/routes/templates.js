const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { renderTemplate } = require('../utils/templateRenderer');
const { formatDateIST, formatDateTimeIST } = require('../utils/dateFormat');
const { getCaseIfSurveyorAssigned, getCaseForUserOrNull } = require('../services/resourceScope');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM message_templates WHERE is_active = true ORDER BY code');
    res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

// Admin creates a new template (any channel: sms or internal).
router.post('/', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { name, code, channel = 'sms', bodyTemplate } = req.body;
    if (!name || !code || !bodyTemplate) return res.status(400).json({ error: 'name, code, bodyTemplate required' });
    const { rows } = await pool.query(
      `INSERT INTO message_templates (name, code, channel, body_template)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), code.trim().toUpperCase(), channel, bodyTemplate.trim()]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A template with that code already exists' });
    next(err);
  }
});

// Admin soft-deletes a template (sets is_active = false so existing references still resolve).
router.delete('/:id', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE message_templates SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { bodyTemplate, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE message_templates SET body_template = COALESCE($2, body_template),
         is_active = COALESCE($3, is_active), updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, bodyTemplate ?? null, typeof isActive === 'boolean' ? isActive : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Server-side render endpoint: fields come from case/farmer data, never hand-typed.
// Supports two modes:
//   caseId   — single-case render (legacy, still works for per-case SMS)
//   sessionId — session render (farmer-batch contact): includes {Docket_IDs}, {Case_Count}
router.post('/:id/render', async (req, res, next) => {
  try {
    const { caseId, sessionId } = req.body;
    if (!caseId && !sessionId) return res.status(400).json({ error: 'caseId or sessionId required' });

    const { rows: templateRows } = await pool.query('SELECT * FROM message_templates WHERE id = $1', [req.params.id]);
    const template = templateRows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    let farmer, attemptNo, docketIdsText, caseCount, caseRow;

    if (sessionId) {
      // Session-based render: fetch session + farmer + all docket IDs in the batch.
      const { rows: [session] } = await pool.query(
        `SELECT cs.*, fr.farmer_name, fr.farmer_mobile, fr.village_name
         FROM contact_sessions cs JOIN farmer_records fr ON fr.id = cs.farmer_id
         WHERE cs.id = $1`, [sessionId]
      );
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (req.user.role_key === ROLES.SURVEYOR && session.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your session' });
      }
      farmer = { farmer_name: session.farmer_name, farmer_mobile: session.farmer_mobile, village_name: session.village_name };
      docketIdsText = session.docket_ids_text || '';
      caseCount = session.case_count || 0;
      // Attempt No for session = how many sessions exist for this farmer+batch so far.
      const { rows: [{ cnt }] } = await pool.query(
        `SELECT count(*)::int AS cnt FROM contact_sessions
         WHERE farmer_id = $1 AND intimation_batch_date IS NOT DISTINCT FROM $2`,
        [session.farmer_id, session.intimation_batch_date]
      );
      attemptNo = cnt;
    } else {
      // Single-case legacy mode.
      if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
      else caseRow = await getCaseForUserOrNull(caseId, req.user);
      if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });
      const { rows: farmerRows } = await pool.query('SELECT * FROM farmer_records WHERE id = $1', [caseRow.farmer_id]);
      farmer = farmerRows[0];
      attemptNo = caseRow.attempt_count + 1;
      docketIdsText = caseRow.docket_id2 || '';
      caseCount = 1;
    }

    const data = {
      Farmer_Name: farmer.farmer_name,
      Farmer_Mobile: farmer.farmer_mobile,
      Attempt_No: attemptNo,
      Village_Name: farmer.village_name,
      Docket_IDs: docketIdsText,
      Case_Count: caseCount,
      Original_Survey_Date: caseRow ? formatDateIST(caseRow.survey_assigned_on) : '',
      Denial_Reason: req.body.denialReason,
      Postponed_Survey_Date: formatDateIST(req.body.postponedSurveyDate),
      Postpone_Reason: req.body.postponeReason,
      Contact_Issue: req.body.contactIssue,
      Survey_Date: caseRow ? formatDateIST(caseRow.survey_assigned_on) : '',
      Incident_Description: req.body.incidentDescription,
      Evidence_DateTime: formatDateTimeIST(req.body.evidenceDateTime),
      Surveyor_Name: req.user.name,
      Surveyor_Mobile: req.user.phone,
    };
    const { rendered, missing } = renderTemplate(template.body_template, data);
    res.json({ rendered, missing, attemptNo, docketIdsText, caseCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
