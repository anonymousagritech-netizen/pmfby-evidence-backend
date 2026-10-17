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
              u.home_district_ids, r.key AS role_key
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// Update a user's own account fields (name/phone/scope) and/or active status.
// Super Admin only. Deactivating immediately revokes access (authenticate middleware
// re-checks is_active on every request from a fresh DB read, not just at login) — see
// middleware/auth.js. An admin may not deactivate their own account (would be able to
// lock every Super Admin out of the system with no one left to undo it).
router.patch('/:id', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { name, phone, scopeStateId, scopeDistrictId, isActive, homeDistrictIds } = req.body;
    if (typeof isActive === 'boolean' && !isActive && req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    if (homeDistrictIds !== undefined && !Array.isArray(homeDistrictIds)) {
      return res.status(400).json({ error: 'homeDistrictIds must be an array of district id strings' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE($2, name),
         phone = COALESCE($3, phone),
         scope_state_id = COALESCE($4, scope_state_id),
         scope_district_id = COALESCE($5, scope_district_id),
         is_active = COALESCE($6, is_active),
         home_district_ids = COALESCE($7, home_district_ids),
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, email, phone, is_active, scope_state_id, scope_district_id, home_district_ids`,
      [req.params.id, name || null, phone || null, scopeStateId || null, scopeDistrictId || null,
        typeof isActive === 'boolean' ? isActive : null, homeDistrictIds || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await recordAudit(null, {
      userId: req.user.id, action: typeof isActive === 'boolean' ? (isActive ? 'reactivate_user' : 'deactivate_user') : 'update_user',
      resourceType: 'users', resourceId: req.params.id, metadata: { name, phone, scopeStateId, scopeDistrictId, isActive, homeDistrictIds },
    });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Soft-delete (account removal). Super Admin only, and may not delete self (same
// no-self-lockout reasoning as deactivation above). Immutable audit trail (audit_logs
// rows for this user's past actions are preserved — only the users row is soft-deleted,
// never hard-deleted, so FK-referenced history stays intact).
router.delete('/:id', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET deleted_at = now(), is_active = false, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await recordAudit(null, { userId: req.user.id, action: 'delete_user', resourceType: 'users', resourceId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
