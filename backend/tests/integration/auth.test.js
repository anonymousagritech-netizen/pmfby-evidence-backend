const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool } = require('../helpers/testDb');

const app = createApp();

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    await createUser({ name: 'Admin', email: 'admin@test.local', roleKey: 'super_admin' });
  });

  afterAll(async () => { await closePool(); });

  test('succeeds with correct credentials and returns a usable JWT', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'TestPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.roleKey).toBe('super_admin');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@test.local');
  });

  test('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'WrongPass' });
    expect(res.status).toBe(401);
  });

  test('rejects unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('rejects requests with no Authorization header on a protected route', async () => {
    const res = await request(app).get('/api/farmers');
    expect(res.status).toBe(401);
  });

  test('rejects a malformed/garbage token', async () => {
    const res = await request(app).get('/api/farmers').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
