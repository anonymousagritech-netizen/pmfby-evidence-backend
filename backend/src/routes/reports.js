const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate);

// Per-surveyor history: disputes (dispute_incident outcomes), fraud-flags-raised
// (discrepancy_flags), and emergencies count. Query-time aggregation over existing
// tables — no dedicated aggregation table needed for this pass.
router.get('/surveyor-history', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
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

// Dashboard summary: case counts by contact_status and by a derived priority bucket
// (same priority definition as autoAssignService — intimation + default 10-day TAT vs
// "today" — this is informational-only on the dashboard, not tied to any specific
// auto-assign run's actual TAT/cutoff parameters), plus emergency/discrepancy counts.
// super_admin sees org-wide; manager is scoped to their state/district like elsewhere.
router.get('/dashboard-summary', async (req, res, next) => {
  try {
    // Build a WHERE fragment + params usable against a bare `survey_cases` table
    // (no alias) and a version usable against it aliased as `sc` (for the two queries
    // joined with emergency_incidents/discrepancy_flags below).
    let bareWhere = '1=1';
    let scWhere = '1=1';
    const params = [];
    if (req.user.role_key === ROLES.MANAGER) {
      if (req.user.scope_district_id) {
        params.push(req.user.scope_district_id);
        bareWhere = `district_id = $${params.length}`;
        scWhere = `sc.district_id = $${params.length}`;
      } else if (req.user.scope_state_id) {
        params.push(req.user.scope_state_id);
        bareWhere = `state_id = $${params.length}`;
        scWhere = `sc.state_id = $${params.length}`;
      } else {
        bareWhere = 'false';
        scWhere = 'false';
      }
    } else if (req.user.role_key === ROLES.SURVEYOR) {
      params.push(req.user.id);
      const sub = `farmer_id IN (SELECT farmer_id FROM farmer_assignments WHERE user_id = $${params.length} AND active = true)`;
      bareWhere = sub;
      scWhere = `sc.${sub}`;
    }

    const { rows: statusRows } = await pool.query(
      `SELECT contact_status, count(*)::int AS count FROM survey_cases
       WHERE deleted_at IS NULL AND ${bareWhere} GROUP BY contact_status`,
      params
    );

    const { rows: priorityRows } = await pool.query(
      `SELECT
         CASE
           WHEN farmer_intimation_date IS NULL THEN 'unknown'
           WHEN (farmer_intimation_date + interval '10 day')::date - CURRENT_DATE <= 5 THEN 'P1'
           WHEN (farmer_intimation_date + interval '10 day')::date - CURRENT_DATE <= 7 THEN 'P2'
           ELSE 'P3'
         END AS priority,
         count(*)::int AS count
       FROM survey_cases
       WHERE deleted_at IS NULL AND contact_status NOT IN ('completed', 'denied') AND ${bareWhere}
       GROUP BY priority`,
      params
    );

    const { rows: totalRows } = await pool.query(
      `SELECT count(*)::int AS total FROM survey_cases WHERE deleted_at IS NULL AND ${bareWhere}`,
      params
    );

    const { rows: emergencyRows } = await pool.query(
      `SELECT count(*)::int AS count FROM emergency_incidents ei
       JOIN survey_cases sc ON sc.id = ei.case_id
       WHERE ei.requires_manager_review = true AND ei.resolved_at IS NULL AND ${scWhere}`,
      params
    );

    const { rows: discrepancyRows } = await pool.query(
      `SELECT count(*)::int AS count FROM discrepancy_flags df
       JOIN survey_cases sc ON sc.id = df.case_id
       WHERE df.status = 'pending' AND ${scWhere}`,
      params
    );

    res.json({
      totalCases: totalRows[0]?.total || 0,
      byStatus: statusRows,
      byPriority: priorityRows,
      pendingEmergencyReviews: emergencyRows[0]?.count || 0,
      pendingDiscrepancyFlags: discrepancyRows[0]?.count || 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
