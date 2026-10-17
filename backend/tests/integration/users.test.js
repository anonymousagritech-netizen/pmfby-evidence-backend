// User account lifecycle: create (existing), list (existing), deactivate/reactivate and
// soft-delete (new in this pass). Super Admin only; deactivation must take effect
// immediately (not just at next login), and an admin may never lock themselves out.
const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

describe('User management: deactivate / reactivate / delete', () => {
  let admin;
  let adminToken;
  let surveyor;
  let surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'users-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Surveyor', email: 'users-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');
  });

  afterAll(async () => { await closePool(); });

  test('non-admin cannot deactivate or delete a user', async () => {
    const patchRes = await request(app).patch(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${surveyorToken}`).send({ isActive: false });
    expect(patchRes.status).toBe(403);

    const deleteRes = await request(app).delete(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${surveyorToken}`);
    expect(deleteRes.status).toBe(403);
  });

  test('admin cannot deactivate or delete their own account', async () => {
    const patchRes = await request(app).patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });
    expect(patchRes.status).toBe(400);

    const deleteRes = await request(app).delete(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(400);
  });

  test('admin deactivates a user and the effect is immediate (not just at next login)', async () => {
    const meBefore = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${surveyorToken}`);
    expect(meBefore.status).toBe(200);

    const patchRes = await request(app).patch(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.is_active).toBe(false);

    // Same still-unexpired JWT is now rejected because authenticate() re-reads is_active.
    const meAfter = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${surveyorToken}`);
    expect(meAfter.status).toBe(401);

    // Login also rejected while deactivated.
    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: 'users-surveyor@test.local', password: 'TestPass123!' });
    expect(loginRes.status).toBe(401);
  });

  test('admin reactivates the user and access is restored', async () => {
    const patchRes = await request(app).patch(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ isActive: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.is_active).toBe(true);

    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: 'users-surveyor@test.local', password: 'TestPass123!' });
    expect(loginRes.status).toBe(200);
  });

  test('admin soft-deletes a user: login fails, user disappears from the list, audit trail recorded', async () => {
    const deleteRes = await request(app).delete(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);

    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: 'users-surveyor@test.local', password: 'TestPass123!' });
    expect(loginRes.status).toBe(401);

    const listRes = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.users.find((u) => u.id === surveyor.id)).toBeUndefined();

    const auditRes = await request(app).get('/api/audit-logs?resourceType=users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.auditLogs.some((a) => a.action === 'delete_user' && a.resource_id === surveyor.id)).toBe(true);

    // Deleting again is a 404, not a silent success.
    const secondDelete = await request(app).delete(`/api/users/${surveyor.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondDelete.status).toBe(404);
  });

  test('update endpoint can patch name/phone without touching is_active', async () => {
    const other = await createUser({ name: 'Manager Person', email: 'users-manager@test.local', roleKey: 'manager' });
    const res = await request(app).patch(`/api/users/${other.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ name: 'Renamed Manager', phone: '9999999999' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Renamed Manager');
    expect(res.body.user.phone).toBe('9999999999');
    expect(res.body.user.is_active).toBe(true);
  });
});
