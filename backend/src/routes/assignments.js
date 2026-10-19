const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { assignFarmer, bulkReassignFarmers, EmergencyReviewRequiredError } = require('../services/assignmentService');

const router = express.Router();
router.use(authenticate);

// Assign/reassign a farmer to a surveyor. Super Admin only in this pass (managers
// monitor; only Super Admin assigns per spec's role table).
router.post('/', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { farmerId, userId } = req.body;
    if (!farmerId || !userId) return res.status(400).json({ error: 'farmerId and userId required' });

    const { rows: userRows } = await pool.query(
      `SELECT u.id, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (!userRows[0]) return res.status(400).json({ error: 'User not found' });
    if (userRows[0].role_key !== ROLES.SURVEYOR) {
      return res.status(400).json({ error: 'Farmers can only be assigned to surveyor-role users' });
    }

    const assignment = await assignFarmer({ farmerId, toUserId: userId, assignedBy: req.user.id });
    res.status(201).json({ assignment });
  } catch (err) {
    if (err instanceof EmergencyReviewRequiredError) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Bulk cross-surveyor transfer: move a BLOCK of farmers' active assignment to one
// destination surveyor in one transaction/one audit entry — the common real workflow
// of surveyor turnover, post-hoc workload rebalancing, or a surveyor going on leave
// mid-cycle. Super Admin only. A farmer blocked by the emergency-incident gate is
// skipped (reported in `blocked`), not treated as a failure of the whole batch.
router.post('/bulk-transfer', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { farmerIds, toUserId } = req.body;
    if (!Array.isArray(farmerIds) || farmerIds.length === 0) {
      return res.status(400).json({ error: 'farmerIds (non-empty array) required' });
    }
    if (!toUserId) return res.status(400).json({ error: 'toUserId required' });

    const { rows: userRows } = await pool.query(
      `SELECT u.id, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [toUserId]
    );
    if (!userRows[0]) return res.status(400).json({ error: 'Destination user not found' });
    if (userRows[0].role_key !== ROLES.SURVEYOR) {
      return res.status(400).json({ error: 'Cases can only be transferred to a surveyor-role user' });
    }

    const result = await bulkReassignFarmers({ farmerIds, toUserId, assignedBy: req.user.id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Village-level summary: each village with total case count + assigned/unassigned breakdown.
// Used by the admin Assignment page to assign all farmers in a village at once.
router.get('/village-summary', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         fr.village_name, fr.village_id,
         COUNT(DISTINCT fr.id)                                         AS farmer_count,
         COUNT(DISTINCT sc.id)                                         AS case_count,
         COUNT(DISTINCT fa.farmer_id) FILTER (WHERE fa.active = true)  AS assigned_count,
         MAX(u.name)                  FILTER (WHERE fa.active = true)  AS assigned_to_name
       FROM farmer_records fr
       LEFT JOIN survey_cases sc   ON sc.farmer_id = fr.id AND sc.deleted_at IS NULL
       LEFT JOIN farmer_assignments fa ON fa.farmer_id = fr.id
       LEFT JOIN users u ON u.id = fa.user_id
       WHERE fr.deleted_at IS NULL
       GROUP BY fr.village_name, fr.village_id
       ORDER BY case_count DESC`
    );
    res.json({ villages: rows });
  } catch (err) {
    next(err);
  }
});

// Assign all farmers in a village to one surveyor in a single operation.
router.post('/by-village', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { villageId, villageName, userId } = req.body;
    if ((!villageId && !villageName) || !userId) {
      return res.status(400).json({ error: 'villageId (or villageName) and userId required' });
    }
    const where = villageId ? 'fr.village_id = $1' : 'fr.village_name = $1';
    const key   = villageId || villageName;

    const { rows: farmers } = await pool.query(
      `SELECT fr.id FROM farmer_records fr WHERE ${where} AND fr.deleted_at IS NULL`,
      [key]
    );
    if (farmers.length === 0) return res.status(404).json({ error: 'No farmers found for this village' });

    let assigned = 0;
    await withTransaction(async (client) => {
      for (const { id: farmerId } of farmers) {
        const existing = await client.query(
          'SELECT id FROM farmer_assignments WHERE farmer_id = $1 AND user_id = $2 AND active = true LIMIT 1',
          [farmerId, userId]
        );
        if (existing.rows[0]) continue;
        await client.query(
          'UPDATE farmer_assignments SET active = false, unassigned_at = now() WHERE farmer_id = $1 AND active = true',
          [farmerId]
        );
        await client.query(
          'INSERT INTO farmer_assignments (farmer_id, user_id, assigned_by) VALUES ($1,$2,$3)',
          [farmerId, userId, req.user.id]
        );
        assigned++;
      }
    });
    res.json({ assigned, total: farmers.length });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT fa.*, fr.farmer_name, fr.village_name, u.name AS assigned_to_name
       FROM farmer_assignments fa
       JOIN farmer_records fr ON fr.id = fa.farmer_id
       JOIN users u ON u.id = fa.user_id
       WHERE fa.active = true ORDER BY fa.assigned_at DESC LIMIT 500`
    );
    res.json({ assignments: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
