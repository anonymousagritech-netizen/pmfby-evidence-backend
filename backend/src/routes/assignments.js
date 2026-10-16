const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { assignFarmer, EmergencyReviewRequiredError } = require('../services/assignmentService');

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
