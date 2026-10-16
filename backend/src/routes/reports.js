const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER));

// Per-surveyor history: disputes (dispute_incident outcomes), fraud-flags-raised
// (discrepancy_flags), and emergencies count. Query-time aggregation over existing
// tables — no dedicated aggregation table needed for this pass.
router.get('/surveyor-history', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id AS user_id, u.name,
        (SELECT count(*) FROM survey_cases sc JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id
           WHERE fa.user_id = u.id AND sc.contact_status = 'dispute_incident') AS disputes_count,
        (SELECT count(*) FROM discrepancy_flags df WHERE df.raised_by = u.id) AS fraud_flags_raised_count,
        (SELECT count(*) FROM emergency_incidents ei WHERE ei.user_id = u.id) AS emergencies_count
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.key = 'surveyor' AND u.deleted_at IS NULL
      ORDER BY u.name
    `);
    res.json({ surveyorHistory: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
