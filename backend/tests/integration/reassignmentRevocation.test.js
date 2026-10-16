// Offline-sync safety: once a farmer is reassigned away from a surveyor, the backend
// must reject (not silently ignore) further events from the old surveyor for that
// farmer — enforced server-side, not client-trusted.
const request = require('supertest');
const { createApp } = require('../../src/app');
const {
  resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, assignFarmerDirect, closePool,
} = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const { assignFarmer } = require('../../src/services/assignmentService');

const app = createApp();

describe('Reassignment / revocation is enforced server-side', () => {
  let surveyorOld;
  let surveyorNew;
  let admin;
  let oldToken;
  let newToken;
  let farmer;
  let surveyCase;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'reassign-admin@test.local', roleKey: 'super_admin' });
    surveyorOld = await createUser({ name: 'Old Surveyor', email: 'old@test.local', roleKey: 'surveyor' });
    surveyorNew = await createUser({ name: 'New Surveyor', email: 'new@test.local', roleKey: 'surveyor' });
    oldToken = tokenFor(surveyorOld, 'surveyor');
    newToken = tokenFor(surveyorNew, 'surveyor');

    const created = await createFarmerWithCase({ farmerName: 'Reassignment Farmer' });
    farmer = created.farmer;
    surveyCase = created.surveyCase;
    await assignFarmerDirect(farmer.id, surveyorOld.id);
  });

  afterAll(async () => { await closePool(); });

  test('old surveyor can call while still assigned', async () => {
    const res = await request(app).post('/api/call-events').set('Authorization', `Bearer ${oldToken}`)
      .send({ caseId: surveyCase.id, phoneNumber: '9000000001' });
    expect(res.status).toBe(201);
  });

  test('after reassignment, old surveyor\'s further writes are rejected (403), new surveyor\'s are accepted', async () => {
    await assignFarmer({ farmerId: farmer.id, toUserId: surveyorNew.id, assignedBy: admin.id });

    const oldAttempt = await request(app).post('/api/call-events').set('Authorization', `Bearer ${oldToken}`)
      .send({ caseId: surveyCase.id, phoneNumber: '9000000001', idempotencyKey: 'offline-queued-event-1' });
    expect(oldAttempt.status).toBe(403);

    const newAttempt = await request(app).post('/api/call-events').set('Authorization', `Bearer ${newToken}`)
      .send({ caseId: surveyCase.id, phoneNumber: '9000000001' });
    expect(newAttempt.status).toBe(201);
  });

  test('old surveyor can no longer see the case at all (404)', async () => {
    const res = await request(app).get(`/api/cases/${surveyCase.id}`).set('Authorization', `Bearer ${oldToken}`);
    expect(res.status).toBe(404);
  });
});
