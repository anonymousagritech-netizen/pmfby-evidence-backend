// Downloadable blank/example .xlsx templates for the two Excel-upload features
// (case import, bulk surveyor import) — generated server-side so the column list can
// never drift out of sync with what the importer actually recognizes.
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

describe('Excel import templates', () => {
  let adminToken, surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    const admin = await createUser({ name: 'Admin', email: 'tpl-admin@test.local', roleKey: 'super_admin' });
    const surveyor = await createUser({ name: 'Surveyor', email: 'tpl-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');
  });

  afterAll(async () => { await closePool(); });

  test('GET /api/import/template returns a valid .xlsx with the real camelCase headers', async () => {
    const res = await request(app).get('/api/import/template')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Sheet1');
    const headers = [];
    sheet.getRow(1).eachCell((cell) => headers.push(cell.value));
    expect(headers).toContain('docketID');
    expect(headers).toContain('surveyorMobile');
    expect(headers).toContain('farmerIntimationDate');
    expect(headers).toContain('surveyAssignedOn');
    expect(sheet.rowCount).toBeGreaterThanOrEqual(2); // header + example row
  });

  test('a non-admin cannot download the case-import template', async () => {
    const res = await request(app).get('/api/import/template').set('Authorization', `Bearer ${surveyorToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/users/bulk-import/template returns a valid .xlsx with district/mobile/status/email/password columns', async () => {
    const res = await request(app).get('/api/users/bulk-import/template')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Sheet1');
    const headers = [];
    sheet.getRow(1).eachCell((cell) => headers.push(cell.value));
    expect(headers).toContain('districtName');
    expect(headers).toContain('surveyorMobile');
    expect(headers).toContain('email');
    expect(headers).toContain('password');
  });

  test('a non-admin cannot download the surveyor-import template', async () => {
    const res = await request(app).get('/api/users/bulk-import/template').set('Authorization', `Bearer ${surveyorToken}`);
    expect(res.status).toBe(403);
  });
});
