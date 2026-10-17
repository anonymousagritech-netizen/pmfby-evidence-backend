// RBAC + round-trip test for village boundary polygon endpoints (by-district,
// by-villages, upload). Mirrors tests/integration/villageData.test.js's structure and
// its real-file backup/restore safety net.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const boundaryLookup = require('../../src/services/boundaryLookupService');

const app = createApp();

const TARGET_FILE = path.join(__dirname, '..', '..', 'data', 'village_boundaries.ndjson');
const BACKUP_FILE = `${TARGET_FILE}.test-backup`;

describe('Village boundary polygons: RBAC + upload + lookup', () => {
  let admin, adminToken, surveyor, surveyorToken;
  let sampleFilePath;
  let hadRealFile = false;

  const sampleGeometry = { type: 'Polygon', coordinates: [[[79.1, 13.1], [79.2, 13.1], [79.2, 13.2], [79.1, 13.2], [79.1, 13.1]]] };

  beforeAll(async () => {
    if (fs.existsSync(TARGET_FILE)) {
      hadRealFile = true;
      fs.renameSync(TARGET_FILE, BACKUP_FILE);
    }
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'bd-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Surveyor', email: 'bd-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');

    sampleFilePath = path.join(os.tmpdir(), `boundary-sample-${Date.now()}.ndjson`);
    fs.writeFileSync(sampleFilePath, [
      JSON.stringify({ village: 'TestVille', district: 'TESTDISTRICT', state: 'TestState', geometry: sampleGeometry }),
      JSON.stringify({ village: 'SecondVille', district: 'TESTDISTRICT', state: 'TestState', geometry: sampleGeometry }),
    ].join('\n') + '\n');
  });

  afterAll(async () => {
    fs.unlinkSync(sampleFilePath);
    if (fs.existsSync(TARGET_FILE)) fs.unlinkSync(TARGET_FILE);
    if (hadRealFile) fs.renameSync(BACKUP_FILE, TARGET_FILE);
    boundaryLookup.resetCache();
    await closePool();
  });

  test('non-admin cannot upload', async () => {
    const res = await request(app).post('/api/boundaries/upload')
      .set('Authorization', `Bearer ${surveyorToken}`).attach('file', sampleFilePath);
    expect(res.status).toBe(403);
  });

  test('rejects a file that does not look like boundary NDJSON', async () => {
    const badPath = path.join(os.tmpdir(), `bad-boundary-${Date.now()}.txt`);
    fs.writeFileSync(badPath, 'nonsense\n');
    const res = await request(app).post('/api/boundaries/upload')
      .set('Authorization', `Bearer ${adminToken}`).attach('file', badPath);
    expect(res.status).toBe(400);
    fs.unlinkSync(badPath);
  });

  test('admin upload + by-district + by-villages round trip', async () => {
    const uploadRes = await request(app).post('/api/boundaries/upload')
      .set('Authorization', `Bearer ${adminToken}`).attach('file', sampleFilePath);
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);

    const byDistrictRes = await request(app).get('/api/boundaries/by-district')
      .query({ district: 'TestDistrict' }).set('Authorization', `Bearer ${adminToken}`);
    expect(byDistrictRes.status).toBe(200);
    expect(byDistrictRes.body.boundaries).toHaveLength(2);

    const byVillagesRes = await request(app).post('/api/boundaries/by-villages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ villages: [{ village: 'TestVille', district: 'TestDistrict' }] });
    expect(byVillagesRes.status).toBe(200);
    expect(byVillagesRes.body.boundaries).toHaveLength(1);
    expect(byVillagesRes.body.boundaries[0].geometry.type).toBe('Polygon');

    const statusRes = await request(app).get('/api/boundaries/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusRes.body.loaded).toBe(true);
  });

  test('surveyor cannot read boundary endpoints (manager/super_admin only)', async () => {
    const res = await request(app).get('/api/boundaries/by-district')
      .query({ district: 'TestDistrict' }).set('Authorization', `Bearer ${surveyorToken}`);
    expect(res.status).toBe(403);
  });
});
