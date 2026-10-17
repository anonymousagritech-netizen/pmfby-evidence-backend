const express = require('express');
const { pool } = require('../db/pool');
const { verifyPassword, signToken, hashPassword } = require('../utils/auth');
const { authenticate } = require('../middleware/auth');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();

// "USER WILL LOGIN USING MO. AND PASSWORD" — a bulk-imported surveyor only knows their
// mobile number, never the synthetic {mobile}@pmfby-evidence.local email. `identifier`
// accepts either: matched against `email` when it looks like an email address, against
// `phone` otherwise (additive — existing email-based logins for Super Admin/Manager
// accounts are unaffected). Kept as the same `email` request-body field name for
// backward compatibility with any existing caller still sending `email`.
router.post('/login', async (req, res, next) => {
  try {
    const identifier = (req.body.email || req.body.identifier || '').trim();
    const { password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: 'email (or mobile number) and password required' });

    const looksLikeEmail = identifier.includes('@');
    const { rows } = await pool.query(
      `SELECT u.*, r.key AS role_key, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL AND ${looksLikeEmail ? 'u.email = $1' : 'u.phone = $1'}`,
      [identifier]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, roleKey: user.role_key,
        roleName: user.role_name, scopeStateId: user.scope_state_id, scopeDistrictId: user.scope_district_id,
        forcePasswordChange: user.force_password_change,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  // Normalize to the same camelCase shape /login returns (req.user comes straight off
  // a DB row, which is snake_case) — both the android-kotlin and admin-web clients key
  // off `forcePasswordChange`, not `force_password_change`.
  const { force_password_change: forcePasswordChange, role_key: roleKey, role_name: roleName, ...rest } = req.user;
  res.json({ user: { ...rest, roleKey, roleName, forcePasswordChange } });
});

// Minimal self-service password change — the only mechanism for a bulk-imported
// surveyor (whose password was system-generated, never chosen by them) to set their
// own credential. Clears force_password_change so the frontend stops redirecting them
// to the forced-reset screen (see components/RequireAuth or equivalent gate).
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 8) return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const ok = await verifyPassword(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users SET password_hash = $2, force_password_change = false, updated_at = now() WHERE id = $1`,
      [req.user.id, newHash]
    );
    await recordAudit(null, { userId: req.user.id, action: 'change_password', resourceType: 'users', resourceId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
