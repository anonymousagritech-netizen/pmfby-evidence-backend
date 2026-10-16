const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER));

router.get('/', async (req, res, next) => {
  try {
    const { resourceType, userId } = req.query;
    const params = [];
    let where = '1=1';
    if (resourceType) { params.push(resourceType); where += ` AND resource_type = $${params.length}`; }
    if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 500`, params
    );
    res.json({ auditLogs: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
