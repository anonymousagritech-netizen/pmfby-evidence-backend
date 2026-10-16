// In-memory store for parsed-but-not-yet-committed import sessions (upload -> preview ->
// confirm mapping -> commit). Single-process only — fine for this pass's single backend
// instance; a horizontally-scaled deployment would need this moved to Redis/DB (see
// ROADMAP.md).
const crypto = require('crypto');

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map();

function createSession({ headers, rows, originalFilename, uploadedBy }) {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    headers,
    rows,
    originalFilename,
    uploadedBy,
    createdAt: Date.now(),
  });
  return id;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function deleteSession(id) {
  sessions.delete(id);
}

module.exports = { createSession, getSession, deleteSession };
