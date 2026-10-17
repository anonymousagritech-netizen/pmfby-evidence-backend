// Excel download of an auto-assign run's result: Assigned Cases + Surveyor Summary
// sheets always, Unassigned sheet only when there are unassigned cases.
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, pool, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();
jest.setTimeout(60000); // same NDJSON cold-load rationale as autoAssign.test.js

describe('POST /api/auto-assign/export', () => {
  let admin, adminToken, surveyor, surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'export-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Export Surveyor', email: 'export-surveyor@test.local', roleKey: 'surveyor' });
    surveyorToken = tokenFor(surveyor, 'surveyor');
    adminToken = tokenFor(admin, 'super_admin');
    await pool.query('UPDATE users SET home_district_ids = $1 WHERE id = $2', [['D1'], surveyor.id]);

    await createFarmerWithCase({ farmerName: 'Export Farmer 1', village: 'V1', villageId: 'V1', districtId: 'D1', assignedOn: '2026-01-01' });
    await createFarmerWithCase({ farmerName: 'Export Farmer 2', village: 'V2', villageId: 'V2', districtId: 'D1', assignedOn: '2026-01-01' });
    // No eligible surveyor in D2 -> ends up on the Unassigned sheet.
    await createFarmerWithCase({ farmerName: 'Export Farmer 3', village: 'V3', villageId: 'V3', districtId: 'D2', assignedOn: '2026-01-01' });
  });

  afterAll(async () => { await closePool(); });

  const payload = { districtIds: ['D1', 'D2'], reportDate: '2026-01-05', tatDays: 10, minCases: 1, p1CutoffDays: 5, p2CutoffDays: 7 };

  test('non-admin cannot export', async () => {
    const res = await request(app).post('/api/auto-assign/export').set('Authorization', `Bearer ${surveyorToken}`).send(payload);
    expect(res.status).toBe(403);
  });

  test('returns a valid, non-empty .xlsx with the expected sheets and data', async () => {
    const res = await request(app).post('/api/auto-assign/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.body.length).toBeGreaterThan(1000); // a real xlsx, not an empty/error stub

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheetNames = wb.worksheets.map((s) => s.name);
    expect(sheetNames).toContain('Assigned Cases');
    expect(sheetNames).toContain('Surveyor Summary');
    expect(sheetNames).toContain('Unassigned');

    const casesSheet = wb.getWorksheet('Assigned Cases');
    expect(casesSheet.rowCount).toBe(3); // header + 2 assigned cases
    const header = casesSheet.getRow(1).values.filter(Boolean);
    expect(header).toContain('ASSIGN');
    expect(header).toContain('Priority');

    const summarySheet = wb.getWorksheet('Surveyor Summary');
    expect(summarySheet.rowCount).toBe(2); // header + 1 surveyor
    const summaryRow2 = summarySheet.getRow(2).values;
    expect(summaryRow2).toContain('Export Surveyor');

    const unassignedSheet = wb.getWorksheet('Unassigned');
    expect(unassignedSheet.rowCount).toBe(2); // header + the D2 case
  });

  test('is audited', async () => {
    const { rows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'auto_assign_export'");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
