// Bulk password reset: the real way to bootstrap accounts (like the 121 real
// surveyors from the first bulk import, before the show-once-at-creation fix existed)
// whose passwords were generated, hashed, and never shown to anyone.
const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, pool, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const { verifyPassword } = require('../../src/utils/auth');

const app = createApp();

describe('POST /api/users/bulk-reset-password', () => {
  let admin, adminToken, surveyorA, surveyorB, surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'brp-admin@test.local', roleKey: 'super_admin' });
    surveyorA = await createUser({ name: 'Surveyor A', email: 'brp-a@test.local', roleKey: 'surveyor' });
    surveyorB = await createUser({ name: 'Surveyor B', email: 'brp-b@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyorA, 'surveyor');
    // Simulate an "unknown password" account: directly set a password nobody knows,
    // same real-world state as the 121 existing bulk-imported surveyors.
    await pool.query('UPDATE users SET password_hash = $1, force_password_change = false WHERE id = ANY($2)',
      ['$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345', [surveyorA.id, surveyorB.id]]);
  });

  afterAll(async () => { await closePool(); });

  test('non-admin cannot bulk-reset passwords', async () => {
    const res = await request(app).post('/api/users/bulk-reset-password')
      .set('Authorization', `Bearer ${surveyorToken}`).send({ userIds: [surveyorA.id] });
    expect(res.status).toBe(403);
  });

  test('admin resets multiple users at once: new passwords work, force_password_change set, one audit row', async () => {
    const res = await request(app).post('/api/users/bulk-reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [surveyorA.id, surveyorB.id] });

    expect(res.status).toBe(200);
    expect(res.body.resetCount).toBe(2);
    expect(res.body.credentials).toHaveLength(2);

    for (const cred of res.body.credentials) {
      expect(cred.tempPassword).toBeTruthy();
      const { rows } = await pool.query('SELECT password_hash, force_password_change FROM users WHERE id = $1', [cred.userId]);
      expect(rows[0].force_password_change).toBe(true);
      const matches = await verifyPassword(cred.tempPassword, rows[0].password_hash);
      expect(matches).toBe(true);

      const loginRes = await request(app).post('/api/auth/login').send({ email: cred.email, password: cred.tempPassword });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.forcePasswordChange).toBe(true);
    }

    const { rows: auditRows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'bulk_reset_password' ORDER BY created_at DESC LIMIT 1");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata.resetCount).toBe(2);
    expect(JSON.stringify(auditRows[0].metadata)).not.toMatch(/tempPassword/i);
  });

  test('returns 404 for an empty/non-matching selection', async () => {
    const res = await request(app).post('/api/users/bulk-reset-password')
      .set('Authorization', `Bearer ${adminToken}`).send({ userIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(404);
  });
});
