const { pool } = require('../db/pool');

async function recordAudit(client, { userId, action, resourceType, resourceId, metadata, ipAddress }) {
  const executor = client || pool;
  await executor.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId || null, action, resourceType, resourceId || null, metadata ? JSON.stringify(metadata) : null, ipAddress || null]
  );
}

module.exports = { recordAudit };
