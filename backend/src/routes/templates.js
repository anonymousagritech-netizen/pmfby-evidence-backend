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

// Server-side render endpoint: fields come from case/farmer data, never hand-typed
// Attempt No. Incident Format 4 is deliberately NOT reachable through this endpoint's
// normal SMS flow consumers (mobile only wires Formats 1-3 into the SMS composer).
router.post('/:id/render', async (req, res, next) => {
  try {
    const { caseId } = req.body;
    if (!caseId) return res.status(400).json({ error: 'caseId required' });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(caseId, req.user.id);
    else caseRow = await getCaseForUserOrNull(caseId, req.user);
    if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });

    const { rows: templateRows } = await pool.query('SELECT * FROM message_templates WHERE id = $1', [req.params.id]);
    const template = templateRows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { rows: farmerRows } = await pool.query('SELECT * FROM farmer_records WHERE id = $1', [caseRow.farmer_id]);
    const farmer = farmerRows[0];

    const data = {
      Farmer_Name: farmer.farmer_name,
      Farmer_Mobile: farmer.farmer_mobile,
      Attempt_No: caseRow.attempt_count,
      Village_Name: farmer.village_name,
      // These were previously passed through raw (a JS Date for the *_on columns,
      // whatever string the client sent for the others) and String()'d by renderTemplate,
      // which leaked `Tue Oct 13 2026 00:00:00 GMT+0000 (Coordinated Universal Time)`
      // straight into sent SMS text. Always format as a clean IST date/time instead.
      Original_Survey_Date: formatDateIST(caseRow.survey_assigned_on),
      Denial_Reason: req.body.denialReason,
      Postponed_Survey_Date: formatDateIST(req.body.postponedSurveyDate),
      Postpone_Reason: req.body.postponeReason,
      Contact_Issue: req.body.contactIssue,
      Survey_Date: formatDateIST(caseRow.survey_assigned_on),
      Incident_Description: req.body.incidentDescription,
      Evidence_DateTime: formatDateTimeIST(req.body.evidenceDateTime),
      Surveyor_Name: req.user.name,
      Surveyor_Mobile: req.user.phone,
    };
    const { rendered, missing } = renderTemplate(template.body_template, data);
    res.json({ rendered, missing, attemptNo: caseRow.attempt_count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
