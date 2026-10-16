const express = require('express');
const { pool } = require('../db/pool');
const { verifyPassword, signToken } = require('../utils/auth');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const { rows } = await pool.query(
      `SELECT u.*, r.key AS role_key, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email]
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
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
