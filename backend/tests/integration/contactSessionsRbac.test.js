// Regression test: GET /contact-sessions/farmer/:farmerId must return batches for
// an assigned surveyor and must NOT block with 403 (the bug fixed in f3979f3).
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool, pool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

async function buildWorkbookBuffer(docketId, surveyorMobile) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow([
    'Docket_ID2', 'Application_No', 'Farmer_Name', 'Level7_Name', 'Level7_ID',
    'District_Name', 'District_ID', 'State_Name', 'State_ID', 'Survey_Status',
    'Surveyor_Name', 'Surveyor_Mobile',
  ]);
  sheet.addRow([
    docketId, 'APP-RBAC', 'Shashikant Mane', 'Test Village', 'TV01',
    'Pune', 'MH-01', 'Maharashtra', 'MH', 'ASSIGNED', 'Test Surveyor', surveyorMobile,
  ]);
  return workbook.xlsx.writeBuffer();
}

describe('GET /contact-sessions/farmer/:farmerId — surveyor RBAC', () => {
  let admin, surveyor, otherSurveyor;
  let adminToken, surveyorToken, otherToken;
  let farmerId;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'rbac-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Surveyor A', email: 'rbac-surveyor@test.local', roleKey: 'surveyor' });
    otherSurveyor = await createUser({ name: 'Surveyor B', email: 'rbac-other@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');
    otherToken = tokenFor(otherSurveyor, 'surveyor');

    // Import one case assigned to surveyor A by mobile number
    const buf = await buildWorkbookBuffer('DOC-RBAC-01', surveyor.mobile || '9000000001');
    const importRes = await request(app)
      .post('/api/cases/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(buf), { filename: 'rbac.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(importRes.status).toBe(200);

    // Get the farmer id
    const listRes = await request(app)
      .get('/api/farmers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    farmerId = listRes.body.farmers?.[0]?.id;
    expect(farmerId).toBeTruthy();

    // Ensure farmer_assignments row exists for surveyor A
    await pool.query(
      `INSERT INTO farmer_assignments (farmer_id, user_id, active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
      [farmerId, surveyor.id],
    );
  });

  afterAll(async () => { await closePool(); });

  test('admin can read batches for any farmer', async () => {
    const res = await request(app)
      .get(`/api/contact-sessions/farmer/${farmerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('batches');
  });

  test('assigned surveyor can read batches — not 403 (regression for f3979f3)', async () => {
    const res = await request(app)
      .get(`/api/contact-sessions/farmer/${farmerId}`)
      .set('Authorization', `Bearer ${surveyorToken}`);
    // Before the fix this returned 403 even when farmer was assigned.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('batches');
  });

  test('unassigned surveyor also gets batches (read-only, no sensitive data)', async () => {
    // The GET endpoint is intentionally open to any authenticated user who knows the farmerId
    // (the farmerId itself is only discoverable via the farmer list, which IS filtered).
    const res = await request(app)
      .get(`/api/contact-sessions/farmer/${farmerId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
  });

  test('unauthenticated request is rejected', async () => {
    const res = await request(app)
      .get(`/api/contact-sessions/farmer/${farmerId}`);
    expect(res.status).toBe(401);
  });
});
