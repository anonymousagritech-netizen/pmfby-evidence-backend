const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { hashPassword } = require('../utils/auth');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// Super Admin: create users/roles.
router.post('/', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { name, email, phone, password, roleKey, scopeStateId, scopeDistrictId } = req.body;
    if (!name || !email || !password || !roleKey) {
      return res.status(400).json({ error: 'name, email, password, roleKey required' });
    }
    const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE key = $1', [roleKey]);
    if (!roleRows[0]) return res.status(400).json({ error: `Unknown roleKey: ${roleKey}` });

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role_id, scope_state_id, scope_district_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, email, phone, scope_state_id, scope_district_id`,
      [name, email, phone || null, passwordHash, roleRows[0].id, scopeStateId || null, scopeDistrictId || null]
    );
    await recordAudit(null, { userId: req.user.id, action: 'create_user', resourceType: 'users', resourceId: rows[0].id });
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    next(err);
  }
});

router.get('/', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.scope_state_id, u.scope_district_id,
              r.key AS role_key
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
