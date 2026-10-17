// RBAC + round-trip test for the village centroid NDJSON upload endpoint.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const villageLookup = require('../../src/services/villageLookupService');

const app = createApp();

const TARGET_FILE = path.join(__dirname, '..', '..', 'data', 'village_centroids.ndjson');
const BACKUP_FILE = `${TARGET_FILE}.test-backup`;

describe('Village centroid NDJSON upload', () => {
  let admin, adminToken, surveyor, surveyorToken;
  let sampleFilePath;
  let hadRealFile = false;

  beforeAll(async () => {
    // This test exercises the real upload-replaces-live-file path, which would
    // otherwise clobber the actual 150MB extracted dataset on disk — back it up and
    // restore it in afterAll so this test suite never destroys real data.
    if (fs.existsSync(TARGET_FILE)) {
      hadRealFile = true;
      fs.renameSync(TARGET_FILE, BACKUP_FILE);
    }
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'vd-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Surveyor', email: 'vd-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');

    sampleFilePath = path.join(os.tmpdir(), `village-sample-${Date.now()}.ndjson`);
    fs.writeFileSync(sampleFilePath, [
      JSON.stringify({ village: 'TestVille', vlcode: '1', district_h: 'TESTDISTRICT', state_name: 'TestState', lat: 20.1, lon: 78.2 }),
      JSON.stringify({ village: 'SecondVille', vlcode: '2', district_h: 'TESTDISTRICT', state_name: 'TestState', lat: 20.2, lon: 78.3 }),
    ].join('\n') + '\n');
  });

  afterAll(async () => {
    fs.unlinkSync(sampleFilePath);
    if (fs.existsSync(TARGET_FILE)) fs.unlinkSync(TARGET_FILE);
    if (hadRealFile) fs.renameSync(BACKUP_FILE, TARGET_FILE);
    villageLookup.resetCache();
    await closePool();
  });

  test('non-admin cannot upload', async () => {
    const res = await request(app).post('/api/village-data/upload')
      .set('Authorization', `Bearer ${surveyorToken}`)
      .attach('file', sampleFilePath);
    expect(res.status).toBe(403);
  });

  test('rejects a file that does not look like village centroid NDJSON', async () => {
    const badPath = path.join(os.tmpdir(), `bad-${Date.now()}.txt`);
    fs.writeFileSync(badPath, 'not json at all\njust text\n');
    const res = await request(app).post('/api/village-data/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', badPath);
    expect(res.status).toBe(400);
    fs.unlinkSync(badPath);
  });

  test('admin upload replaces the live file and is picked up by villageLookupService', async () => {
    const res = await request(app).post('/api/village-data/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', sampleFilePath);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const found = await villageLookup.findVillage('TestVille', 'TESTDISTRICT');
    expect(found.match).not.toBeNull();
    expect(found.match.village).toBe('TestVille');

    const statusRes = await request(app).get('/api/village-data/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.loaded).toBe(true);
  });
});
