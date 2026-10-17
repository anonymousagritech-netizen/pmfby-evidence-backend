// Bulk cross-surveyor case transfer: moves a block of farmers' active assignment to
// one destination surveyor in a single transaction/audit entry, reusing
// assignmentService's single-case reassign logic under the hood (reassignFarmerTx) so
// the emergency-incident safety gate exists in exactly one place.
const request = require('supertest');
const { createApp } = require('../../src/app');
const {
  resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, assignFarmerDirect, pool, closePool,
} = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const { bulkReassignFarmers, EmergencyReviewRequiredError } = require('../../src/services/assignmentService');

const app = createApp();

describe('assignmentService.bulkReassignFarmers (unit-level, real Postgres)', () => {
  let surveyorA, surveyorB, admin, farmers;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'bulk-admin@test.local', roleKey: 'super_admin' });
    surveyorA = await createUser({ name: 'Surveyor A', email: 'bulk-a@test.local', roleKey: 'surveyor' });
    surveyorB = await createUser({ name: 'Surveyor B', email: 'bulk-b@test.local', roleKey: 'surveyor' });

    farmers = [];
    for (let i = 0; i < 3; i++) {
      const { farmer, surveyCase } = await createFarmerWithCase({ farmerName: `Bulk Farmer ${i}` });
      await assignFarmerDirect(farmer.id, surveyorA.id);
      farmers.push({ farmer, surveyCase });
    }
  });

  test('moves all farmers to the destination surveyor in one transaction, one audit row', async () => {
    const farmerIds = farmers.map((f) => f.farmer.id);
    const result = await bulkReassignFarmers({ farmerIds, toUserId: surveyorB.id, assignedBy: admin.id });

    expect(result.transferred).toHaveLength(3);
    expect(result.blocked).toHaveLength(0);

    const { rows: active } = await pool.query(
      'SELECT farmer_id, user_id FROM farmer_assignments WHERE active = true AND farmer_id = ANY($1)',
      [farmerIds]
    );
    expect(active).toHaveLength(3);
    expect(active.every((r) => r.user_id === surveyorB.id)).toBe(true);

    const { rows: auditRows } = await pool.query(
      "SELECT * FROM audit_logs WHERE action = 'bulk_transfer_cases' ORDER BY created_at DESC LIMIT 1"
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata.transferredCount).toBe(3);
  });

  test('a farmer with an unresolved emergency incident is skipped (blocked), not transferred, rest still succeed', async () => {
    const { farmer, surveyCase } = await createFarmerWithCase({ farmerName: 'Emergency Farmer' });
    await assignFarmerDirect(farmer.id, surveyorA.id);
    const okFarmer = farmers[0].farmer; // already on surveyorB from the previous test; move back to A first
    await pool.query('UPDATE farmer_assignments SET active = false, unassigned_at = now() WHERE farmer_id = $1 AND active = true', [okFarmer.id]);
    await assignFarmerDirect(okFarmer.id, surveyorA.id);

    await pool.query(
      `INSERT INTO emergency_incidents (case_id, farmer_id, user_id, incident_type, requires_manager_review)
       VALUES ($1,$2,$3,'THREAT', true)`,
      [surveyCase.id, farmer.id, surveyorA.id]
    );

    const result = await bulkReassignFarmers({
      farmerIds: [farmer.id, okFarmer.id], toUserId: surveyorB.id, assignedBy: admin.id,
    });

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].farmerId).toBe(farmer.id);
    expect(result.transferred).toHaveLength(1);
    expect(result.transferred[0].farmerId).toBe(okFarmer.id);

    // The blocked farmer's assignment is untouched (still with surveyor A).
    const { rows } = await pool.query('SELECT user_id FROM farmer_assignments WHERE farmer_id = $1 AND active = true', [farmer.id]);
    expect(rows[0].user_id).toBe(surveyorA.id);
  });
});

describe('POST /api/assignments/bulk-transfer (RBAC + validation)', () => {
  let admin, adminToken, surveyor, surveyorToken, destSurveyor, farmerIds;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin2', email: 'bulk-admin2@test.local', roleKey: 'super_admin' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyor = await createUser({ name: 'Surveyor2', email: 'bulk-s2@test.local', roleKey: 'surveyor' });
    surveyorToken = tokenFor(surveyor, 'surveyor');
    destSurveyor = await createUser({ name: 'Dest', email: 'bulk-dest@test.local', roleKey: 'surveyor' });

    const { farmer: f1 } = await createFarmerWithCase({ farmerName: 'RBAC Farmer 1' });
    const { farmer: f2 } = await createFarmerWithCase({ farmerName: 'RBAC Farmer 2' });
    await assignFarmerDirect(f1.id, surveyor.id);
    await assignFarmerDirect(f2.id, surveyor.id);
    farmerIds = [f1.id, f2.id];
  });

  afterAll(async () => { await closePool(); });

  test('non-admin cannot bulk-transfer', async () => {
    const res = await request(app).post('/api/assignments/bulk-transfer')
      .set('Authorization', `Bearer ${surveyorToken}`)
      .send({ farmerIds, toUserId: destSurveyor.id });
    expect(res.status).toBe(403);
  });

  test('rejects a destination that is not a surveyor', async () => {
    const res = await request(app).post('/api/assignments/bulk-transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ farmerIds, toUserId: admin.id });
    expect(res.status).toBe(400);
  });

  test('admin can bulk-transfer to a valid surveyor', async () => {
    const res = await request(app).post('/api/assignments/bulk-transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ farmerIds, toUserId: destSurveyor.id });
    expect(res.status).toBe(200);
    expect(res.body.transferred).toHaveLength(2);
  });
});
