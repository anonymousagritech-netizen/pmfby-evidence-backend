const { withTransaction } = require('../db/pool');
const { recordAudit } = require('./auditLog');

class EmergencyReviewRequiredError extends Error {}

// Core reassign step given an already-open transaction client — deactivates any
// current active assignment for the farmer and creates a new one atomically (also
// enforced at the DB level by a partial unique index), gated by the same
// emergency-incident check. Shared by both the single-case path (assignFarmer) and the
// bulk-transfer path (bulkReassignFarmers) so the actual reassignment logic — and the
// safety gate — exists in exactly one place.
//
// Gate: a farmer with an unresolved (requires_manager_review, not yet resolved)
// emergency/forceful-survey incident cannot be silently reassigned away — it must be
// reviewed/resolved by a manager first.
async function reassignFarmerTx(client, { farmerId, toUserId, assignedBy }) {
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
  return rows[0];
}

async function assignFarmer({ farmerId, toUserId, assignedBy }) {
  return withTransaction(async (client) => {
    const assignment = await reassignFarmerTx(client, { farmerId, toUserId, assignedBy });
    await recordAudit(client, {
      userId: assignedBy,
      action: 'assign_farmer',
      resourceType: 'farmer_records',
      resourceId: farmerId,
      metadata: { toUserId },
    });
    return assignment;
  });
}

// Bulk cross-surveyor transfer: moves many farmers' active assignment to one
// destination surveyor in a single transaction. A farmer blocked by the
// emergency-incident gate is skipped (not thrown — one blocked case shouldn't abort an
// otherwise-valid bulk move of the rest) and reported back in `blocked`. Logged as ONE
// audit row covering the whole batch (not N individual rows), per the brief.
async function bulkReassignFarmers({ farmerIds, toUserId, assignedBy }) {
  return withTransaction(async (client) => {
    const transferred = [];
    const blocked = [];
    for (const farmerId of farmerIds) {
      try {
        const assignment = await reassignFarmerTx(client, { farmerId, toUserId, assignedBy });
        transferred.push({ farmerId, assignmentId: assignment.id });
      } catch (err) {
        if (err instanceof EmergencyReviewRequiredError) {
          blocked.push({ farmerId, reason: err.message });
        } else {
          throw err;
        }
      }
    }
    await recordAudit(client, {
      userId: assignedBy,
      action: 'bulk_transfer_cases',
      resourceType: 'farmer_assignments',
      resourceId: null,
      metadata: {
        toUserId,
        requestedCount: farmerIds.length,
        transferredCount: transferred.length,
        blockedCount: blocked.length,
        transferredFarmerIds: transferred.map((t) => t.farmerId),
        blockedFarmerIds: blocked.map((b) => b.farmerId),
      },
    });
    return { transferred, blocked };
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

module.exports = { assignFarmer, bulkReassignFarmers, getActiveAssignment, EmergencyReviewRequiredError };
