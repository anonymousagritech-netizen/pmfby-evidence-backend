// Proves: a surveyor cannot see another surveyor's farmer, case, evidence, or ZIP
// (403/404), and a manager CAN download any ZIP in their scope. This is the spec's
// explicit required integration test.
const request = require('supertest');
const { createApp } = require('../../src/app');
const {
  resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, assignFarmerDirect, closePool,
} = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

describe('Cross-tenant isolation (RBAC)', () => {
  let surveyorA;
  let surveyorB;
  let manager;
  let tokenA;
  let tokenB;
  let managerToken;
  let farmerA;
  let caseA;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    surveyorA = await createUser({ name: 'Surveyor A', email: 'surveyorA@test.local', roleKey: 'surveyor' });
    surveyorB = await createUser({ name: 'Surveyor B', email: 'surveyorB@test.local', roleKey: 'surveyor' });
    manager = await createUser({ name: 'Manager', email: 'manager@test.local', roleKey: 'manager', scopeStateId: 'HR' });
    tokenA = tokenFor(surveyorA, 'surveyor');
    tokenB = tokenFor(surveyorB, 'surveyor');
    managerToken = tokenFor(manager, 'manager');

    const created = await createFarmerWithCase({ farmerName: 'Isolation Farmer', stateId: 'HR', districtId: 'HR-01' });
    farmerA = created.farmer;
    caseA = created.surveyCase;
    await assignFarmerDirect(farmerA.id, surveyorA.id);
  });

  afterAll(async () => { await closePool(); });

  test('surveyor A can see their own assigned farmer', async () => {
    const res = await request(app).get(`/api/farmers/${farmerA.id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  test('surveyor B CANNOT see surveyor A\'s farmer (403)', async () => {
    const res = await request(app).get(`/api/farmers/${farmerA.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  test('surveyor B CANNOT see surveyor A\'s case (404, not accessible)', async () => {
    const res = await request(app).get(`/api/cases/${caseA.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  test('surveyor B CANNOT initiate a call against surveyor A\'s case (403)', async () => {
    const res = await request(app).post('/api/call-events').set('Authorization', `Bearer ${tokenB}`)
      .send({ caseId: caseA.id, phoneNumber: '9999999999' });
    expect(res.status).toBe(403);
  });

  test('surveyor B CANNOT list evidence for surveyor A\'s case (404)', async () => {
    const res = await request(app).get(`/api/evidence/case/${caseA.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  describe('once a call event + evidence + zip exist for farmer A', () => {
    let callEventId;
    let evidenceFileId;
    let zipArchiveId;

    beforeAll(async () => {
      const callRes = await request(app).post('/api/call-events').set('Authorization', `Bearer ${tokenA}`)
        .send({ caseId: caseA.id, phoneNumber: '9999999999' });
      callEventId = callRes.body.callEvent.id;

      const evidenceRes = await request(app).post('/api/evidence').set('Authorization', `Bearer ${tokenA}`)
        .field('caseId', caseA.id).field('kind', 'screenshot').field('callEventId', callEventId)
        .attach('file', Buffer.from('fake screenshot bytes'), 'shot.png');
      evidenceFileId = evidenceRes.body.evidenceFile.id;

      const zipRes = await request(app).post('/api/zip-archives/generate').set('Authorization', `Bearer ${tokenA}`)
        .send({ callEventId });
      zipArchiveId = zipRes.body.zipArchive.id;
    });

    test('surveyor B CANNOT download surveyor A\'s evidence file (403)', async () => {
      const res = await request(app).get(`/api/evidence/${evidenceFileId}/download`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    test('surveyor B CANNOT download surveyor A\'s ZIP (403)', async () => {
      const res = await request(app).get(`/api/zip-archives/${zipArchiveId}/download`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    test('surveyor A CAN download their own ZIP', async () => {
      const res = await request(app).get(`/api/zip-archives/${zipArchiveId}/download`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
    });

    test('manager in scope CAN download the ZIP', async () => {
      const res = await request(app).get(`/api/zip-archives/${zipArchiveId}/download`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
    });

    test('manager out of scope CANNOT download the ZIP (403)', async () => {
      const outOfScopeManager = await createUser({ name: 'Punjab Manager', email: 'pbmanager@test.local', roleKey: 'manager', scopeStateId: 'PB' });
      const outOfScopeToken = tokenFor(outOfScopeManager, 'manager');
      const res = await request(app).get(`/api/zip-archives/${zipArchiveId}/download`).set('Authorization', `Bearer ${outOfScopeToken}`);
      expect(res.status).toBe(403);
    });
  });
});
