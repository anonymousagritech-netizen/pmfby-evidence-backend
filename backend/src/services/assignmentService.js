const { withTransaction } = require('../db/pool');
const { recordAudit } = require('./auditLog');

class EmergencyReviewRequiredError extends Error {}

// Transaction-safe assign/reassign: deactivates any current active assignment for the
// farmer and creates a new one, atomically, so a farmer is never assigned to two
// surveyors at once (also enforced at the DB level by a partial unique index).
//
// Gate: a farmer with an unresolved (requires_manager_review, not yet resolved)
// emergency/forceful-survey incident cannot be silently reassigned away — it must be
// reviewed/resolved by a manager first (enforced here, server-side).
async function assignFarmer({ farmerId, toUserId, assignedBy }) {
  return withTransaction(async (client) => {
    const { rows: unresolved } = await client.query(
      `SELECT ei.id FROM emergency_incidents ei
       JOIN survey_cases sc ON sc.id = ei.case_id
       WHERE sc.farmer_id = $1 AND ei.requires_manager_review = true AND ei.resolved_at IS NULL
       LIMIT 1`,
      [farmerId]
    );
    if (unresolved[0]) {
      throw new EmergencyReviewRequiredError(
        'This farmer has an unresolved emergency/forceful-survey incident. A manager must review and resolve it before reassignment.'
      );
    }

    await client.query(
      `UPDATE farmer_assignments SET active = false, unassigned_at = now()
       WHERE farmer_id = $1 AND active = true`,
      [farmerId]
    );
    const { rows } = await client.query(
      `INSERT INTO farmer_assignments (farmer_id, user_id, assigned_by)
       VALUES ($1,$2,$3) RETURNING *`,
      [farmerId, toUserId, assignedBy]
    );
    await recordAudit(client, {
      userId: assignedBy,
      action: 'assign_farmer',
      resourceType: 'farmer_records',
      resourceId: farmerId,
      metadata: { toUserId },
    });
    return rows[0];
  });
}

async function getActiveAssignment(client, farmerId) {
  const executor = client;
  const { rows } = await executor.query(
    `SELECT * FROM farmer_assignments WHERE farmer_id = $1 AND active = true LIMIT 1`,
    [farmerId]
  );
  return rows[0] || null;
}

module.exports = { assignFarmer, getActiveAssignment, EmergencyReviewRequiredError };
