const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseForUserOrNull, getCaseIfSurveyorAssigned } = require('../services/resourceScope');
const { generateZipForCallEvent } = require('../services/zipService');
const { storage } = require('../lib/storage');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Request (or idempotently fetch) the ZIP for a given contact attempt (call_event).
router.post('/generate', async (req, res, next) => {
  try {
    const { callEventId } = req.body;
    if (!callEventId) return res.status(400).json({ error: 'callEventId required' });

    const { rows: callRows } = await pool.query('SELECT * FROM call_events WHERE id = $1', [callEventId]);
    const callEvent = callRows[0];
    if (!callEvent) return res.status(404).json({ error: 'call_event not found' });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(callEvent.case_id, req.user.id);
    else caseRow = await getCaseForUserOrNull(callEvent.case_id, req.user);
    if (!caseRow) return res.status(403).json({ error: 'Not accessible' });

    const zipArchive = await generateZipForCallEvent({ callEventId, requestedBy: req.user.id });
    res.status(202).json({ zipArchive });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT za.*, sc.district_id, sc.state_id FROM zip_archives za
       JOIN survey_cases sc ON sc.id = za.case_id ORDER BY za.created_at DESC LIMIT 200`
    );
    let visible = rows;
    if (req.user.role_key === ROLES.MANAGER) {
      visible = rows.filter((r) => (
        (req.user.scope_district_id && r.district_id === req.user.scope_district_id)
        || (!req.user.scope_district_id && req.user.scope_state_id && r.state_id === req.user.scope_state_id)
      ));
    } else if (req.user.role_key === ROLES.SURVEYOR) {
      // Surveyor sees only zips for their own currently-assigned farmers.
      const { rows: assignedFarmerRows } = await pool.query(
        'SELECT farmer_id FROM farmer_assignments WHERE user_id = $1 AND active = true', [req.user.id]
      );
      const assignedIds = new Set(assignedFarmerRows.map((r) => r.farmer_id));
      visible = rows.filter((r) => assignedIds.has(r.farmer_id));
    }
    res.json({ zipArchives: visible });
  } catch (err) {
    next(err);
  }
});

// Secure download: auth + role/scope check + audit log row. No cross-farmer leakage.
router.get('/:id/download', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM zip_archives WHERE id = $1', [req.params.id]);
    const zipArchive = rows[0];
    if (!zipArchive) return res.status(404).json({ error: 'Not found' });
    if (zipArchive.status !== 'ready') return res.status(409).json({ error: `ZIP not ready (status: ${zipArchive.status})` });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(zipArchive.case_id, req.user.id);
    else caseRow = await getCaseForUserOrNull(zipArchive.case_id, req.user);
    if (!caseRow) return res.status(403).json({ error: 'Not accessible' });

    const buffer = await storage.getObject(zipArchive.file_key, { encrypted: true });
    await recordAudit(null, { userId: req.user.id, action: 'download_zip', resourceType: 'zip_archives', resourceId: zipArchive.id });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipArchive.filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
