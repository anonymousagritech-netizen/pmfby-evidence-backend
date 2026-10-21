const { pool } = require('../db/pool');
const { ROLES } = require('../middleware/rbac');

/**
 * Resolves a contact session (one farmer + intimation batch) for the caller.
 * Evidence, SMS events and call recordings stay anchored to a concrete case row (their case_id
 * columns are NOT NULL), so a session-level record is attached to the session's first case and
 * additionally tagged with the session id where the table has that column.
 * Returns { error: { status, message } } or { session, caseId, farmerId }.
 */
async function resolveSession(sessionId, user) {
  const { rows: [session] } = await pool.query('SELECT * FROM contact_sessions WHERE id = $1', [sessionId]);
  if (!session) return { error: { status: 404, message: 'Session not found' } };
  if (user.role_key === ROLES.SURVEYOR && session.user_id !== user.id) {
    return { error: { status: 403, message: 'Not your session' } };
  }
  const { rows: [link] } = await pool.query(
    'SELECT case_id FROM case_contact_sessions WHERE contact_session_id = $1 ORDER BY created_at LIMIT 1',
    [sessionId]
  );
  if (!link) return { error: { status: 404, message: 'Session has no cases' } };
  return { session, caseId: link.case_id, farmerId: session.farmer_id };
}

module.exports = { resolveSession };
