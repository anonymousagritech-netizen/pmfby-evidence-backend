const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER));

router.get('/', async (req, res, next) => {
  try {
    const { resourceType, userId } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const params = [];
    let where = '1=1';
    if (resourceType) { params.push(resourceType); where += ` AND resource_type = $${params.length}`; }
    if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }

    const { rows: countRows } = await pool.query(`SELECT count(*)::int AS total FROM audit_logs WHERE ${where}`, params);
    const offsetParams = [...params, pageSize, (page - 1) * pageSize];
    const { rows } = await pool.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC
       LIMIT $${offsetParams.length - 1} OFFSET $${offsetParams.length}`,
      offsetParams
    );
    res.json({ auditLogs: rows, page, pageSize, total: countRows[0]?.total || 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
