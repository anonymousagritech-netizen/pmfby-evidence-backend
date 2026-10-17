const { verifyToken } = require('../utils/auth');
const { pool } = require('../db/pool');

// Verifies JWT and loads the current user (fresh from DB, so deactivation/role changes
// take effect immediately rather than waiting for token expiry).
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.scope_state_id, u.scope_district_id,
              u.force_password_change, u.home_district_ids,
              r.key AS role_key, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account not found or inactive' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
