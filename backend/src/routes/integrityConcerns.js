const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Confidential bribe/inducement reporting. NOT a safety incident (see emergencyIncidents
// for that) — a corruption-reporting path. Any authenticated user may submit (most often
// a surveyor); only super_admin may ever read the list. Immutable once submitted: this
// file intentionally has NO PUT/PATCH/DELETE route anywhere in the app.
router.post('/', async (req, res, next) => {
  try {
    const { caseId, farmerId, description } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });
    const { rows } = await pool.query(
      `INSERT INTO integrity_concerns (case_id, farmer_id, reported_by, description)
       VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [caseId || null, farmerId || null, req.user.id, description]
    );
    await recordAudit(null, { userId: req.user.id, action: 'report_integrity_concern', resourceType: 'integrity_concerns', resourceId: rows[0].id });
    res.status(201).json({ concern: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM integrity_concerns ORDER BY created_at DESC');
    res.json({ concerns: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
