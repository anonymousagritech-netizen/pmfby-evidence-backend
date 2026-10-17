// RBAC + preview/commit integration test for the village-based auto-assign feature
// against real Postgres.
const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, pool, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

// The village centroid + boundary NDJSON files are each lazily loaded into memory in
// full on first use (by villageLookupService / boundaryLookupService) and can be
// 150-200MB+ on a real extracted dataset — generous timeout so this suite isn't flaky
// on a slower CI/dev machine or while the extraction scripts themselves are still
// running in the background.
jest.setTimeout(60000);

describe('Auto-assign: RBAC + preview/commit', () => {
  let admin, adminToken, manager, managerToken, surveyor, surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'aa-admin@test.local', roleKey: 'super_admin' });
    manager = await createUser({ name: 'Manager', email: 'aa-manager@test.local', roleKey: 'manager' });
    surveyor = await createUser({ name: 'Surveyor', email: 'aa-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    managerToken = tokenFor(manager, 'manager');
    surveyorToken = tokenFor(surveyor, 'surveyor');

    // Give the surveyor eligibility in district D1.
    await pool.query('UPDATE users SET home_district_ids = $1 WHERE id = $2', [['D1'], surveyor.id]);

    // 3 cases, 1 village, intimation date such that with tat=10, report=+9 days -> P1.
    await createFarmerWithCase({ farmerName: 'F1', village: 'V1', villageId: 'V1', districtId: 'D1', intimationDate: '2026-01-01' });
    await createFarmerWithCase({ farmerName: 'F2', village: 'V1', villageId: 'V1', districtId: 'D1', intimationDate: '2026-01-01' });
    await createFarmerWithCase({ farmerName: 'F3', village: 'V2', villageId: 'V2', districtId: 'D1', intimationDate: '2026-01-01' });
  });

  afterAll(async () => { await closePool(); });

  const basePayload = { districtIds: ['D1'], reportDate: '2026-01-10', tatDays: 10, minCases: 1, p1CutoffDays: 5, p2CutoffDays: 7 };

  test('surveyor and manager cannot trigger preview or commit (super admin only)', async () => {
    for (const token of [surveyorToken, managerToken]) {
      const previewRes = await request(app).post('/api/auto-assign/preview')
        .set('Authorization', `Bearer ${token}`).send(basePayload);
      expect(previewRes.status).toBe(403);

      const commitRes = await request(app).post('/api/auto-assign/commit')
        .set('Authorization', `Bearer ${token}`).send(basePayload);
      expect(commitRes.status).toBe(403);
    }
  });

  test('unauthenticated requests are rejected', async () => {
    const res = await request(app).post('/api/auto-assign/preview').send(basePayload);
    expect(res.status).toBe(401);
  });

  test('preview validates required params', async () => {
    const res = await request(app).post('/api/auto-assign/preview')
      .set('Authorization', `Bearer ${adminToken}`).send({ districtIds: [] });
    expect(res.status).toBe(400);
  });

  test('super admin preview computes assignment without writing farmer_assignments', async () => {
    const res = await request(app).post('/api/auto-assign/preview')
      .set('Authorization', `Bearer ${adminToken}`).send(basePayload);
    expect(res.status).toBe(200);
    expect(res.body.totalAssigned).toBe(3);
    expect(res.body.perSurveyor).toHaveLength(1);
    expect(res.body.perSurveyor[0].surveyorId).toBe(surveyor.id);
    expect(res.body.perSurveyor[0].totalCases).toBe(3);

    const { rows } = await pool.query('SELECT * FROM farmer_assignments WHERE active = true');
    expect(rows).toHaveLength(0);

    const { rows: runRows } = await pool.query("SELECT * FROM assignment_runs WHERE mode = 'preview'");
    expect(runRows).toHaveLength(1);
  });

  test('super admin commit actually writes farmer_assignments', async () => {
    const res = await request(app).post('/api/auto-assign/commit')
      .set('Authorization', `Bearer ${adminToken}`).send(basePayload);
    expect(res.status).toBe(200);
    expect(res.body.totalAssigned).toBe(3);

    const { rows } = await pool.query(
      `SELECT * FROM farmer_assignments WHERE active = true AND user_id = $1`, [surveyor.id]
    );
    expect(rows).toHaveLength(3);

    const { rows: runRows } = await pool.query("SELECT * FROM assignment_runs WHERE mode = 'commit'");
    expect(runRows).toHaveLength(1);

    const { rows: auditRows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'auto_assign_commit'");
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });
});
