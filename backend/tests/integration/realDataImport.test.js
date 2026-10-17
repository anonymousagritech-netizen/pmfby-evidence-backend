// Real-data-shape regression test. Built from the actual column schema and value
// shapes found in a real production Haryana PMFBY sample (`NEW DATA.xlsx`, Sheet1,
// 3192 rows — too large/environment-specific to commit as a fixture, so this
// reconstructs a small representative subset of the same shape), after running that
// exact file through the pipeline once by hand to find what broke:
//  1. The workbook has a near-empty "Sheet2" ordered BEFORE "Sheet1" in
//     workbook.worksheets — picking worksheets[0] silently imported the wrong sheet.
//  2. Real headers are camelCase (docketID, farmerName, ...), not the spec's
//     Docket_ID2-style names — column mapping must still resolve them with high
//     confidence.
//  3. stateID/districtID/level4-7ID are GUIDs, not small integers — must round-trip
//     as exact strings, never coerced through Number().
//  4. intimationAssignDeadline's real value is the STATUS STRING "Active", not a date,
//     despite the column name/spec assuming a date — must not crash the whole row.
//  5. survey_assigned_on is present and is the real TAT basis (see autoAssignService).
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, pool, closePool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

// Same rationale as autoAssign.test.js: auto-assign lazily loads the (large, real)
// village centroid/boundary NDJSON files on first use.
jest.setTimeout(60000);

// Builds an in-memory .xlsx matching the real file's sheet-ordering quirk (a smaller
// "Sheet2" added first) and real camelCase headers/value shapes for a handful of rows.
async function buildRealShapedWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const decoy = wb.addWorksheet('Sheet2');
  decoy.addRow(['unrelated', 'decoy', 'sheet']);
  decoy.addRow(['x', 'y', 'z']);

  const sheet1 = wb.addWorksheet('Sheet1');
  const headers = [
    'docketID', 'seasonName', 'schemeName', 'applicationNo', 'farmerName',
    'farmerIntimationDate', 'stateName', 'stateID', 'districtName', 'districtID',
    'level7Name', 'level7ID', 'surveyAgencyName', 'surveyAssignedOn',
    'surveyorName', 'surveyorMobile', 'latitude', 'longitude',
    'intimationAssignDeadline', 'surveyStatus', 'isFarmerPresent',
    'villagersRelation', 'villagersName', 'villagersMobile', 'ASSIGN',
  ];
  sheet1.addRow(headers);
  const rows = [
    ['040106260002542975', 'KHARIF', 'PMFBY', '040106261031541068110', 'Jogender Singh',
      new Date('2026-10-13T17:05:02.510Z'), 'HARYANA', '5C77DA4F-BC9B-4099-BED7-15E06A45F376', 'Palwal', 'C8F18EC8-9F46-4C5F-A333-9DD719AF15AF',
      'Janauli(45)', '38C308F0-7483-47E2-974D-AB56B07EEEF6', 'KrishiCare and Mgmt Services Pvt Ltd', new Date('2026-10-14T14:00:28.883Z'),
      null, null, null, null,
      'Active', 'Survey Agency Assigned', 'No',
      null, null, null, null],
    ['040106260002542976', 'KHARIF', 'PMFBY', '040106261031541068111', 'Ramesh Kumar',
      new Date('2026-10-12T10:00:00.000Z'), 'HARYANA', '5C77DA4F-BC9B-4099-BED7-15E06A45F376', 'Palwal', 'C8F18EC8-9F46-4C5F-A333-9DD719AF15AF',
      'Janauli(45)', '38C308F0-7483-47E2-974D-AB56B07EEEF6', 'KrishiCare and Mgmt Services Pvt Ltd', new Date('2026-10-05T09:00:00.000Z'),
      'Surveyor A', '9999999999', 29.43, 77.32,
      'Active', 'Survey Agency Assigned', 'Yes',
      'Neighbor', 'Suresh', '8888888888'],
  ];
  for (const r of rows) sheet1.addRow(r);

  return wb.xlsx.writeBuffer();
}

describe('Real-data-shape import regression (Haryana PMFBY sample column schema)', () => {
  let admin, adminToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'realdata-admin@test.local', roleKey: 'super_admin' });
    adminToken = tokenFor(admin, 'super_admin');
  });

  afterAll(async () => { await closePool(); });

  test('picks Sheet1 (not the decoy Sheet2 that is ordered first) and maps real camelCase headers with exact confidence', async () => {
    const buffer = await buildRealShapedWorkbookBuffer();
    const res = await request(app).post('/api/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(buffer), 'real-shaped.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(2); // not the 2-row decoy's own row count coincidence — proven below by header content
    expect(res.body.headers).toContain('docketID');
    expect(res.body.headers).not.toContain('unrelated');

    const mapping = res.body.proposedMapping;
    expect(mapping.docketID).toEqual({ field: 'Docket_ID2', confidence: 'exact' });
    expect(mapping.farmerName).toEqual({ field: 'Farmer_Name', confidence: 'exact' });
    expect(mapping.stateID).toEqual({ field: 'State_ID', confidence: 'exact' });
    expect(mapping.districtID).toEqual({ field: 'District_ID', confidence: 'exact' });
    expect(mapping.level7ID).toEqual({ field: 'Level7_ID', confidence: 'exact' });
    expect(mapping.surveyAssignedOn).toEqual({ field: 'Survey_Assigned_On', confidence: 'exact' });
    expect(mapping.intimationAssignDeadline).toEqual({ field: 'Intimation_Assign_Deadline', confidence: 'exact' });
    expect(mapping.latitude).toEqual({ field: 'Case_Latitude', confidence: 'exact' });
    expect(mapping.villagersName).toEqual({ field: 'Source_Villager_Name', confidence: 'exact' });
    expect(mapping.ASSIGN).toEqual({ field: null, confidence: 'none' }); // no app field claims this — see ROADMAP.md
  });

  test('commits without error: GUID IDs preserved exactly, non-date "Active" string becomes NULL not a crash', async () => {
    const buffer = await buildRealShapedWorkbookBuffer();
    const previewRes = await request(app).post('/api/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(buffer), 'real-shaped.xlsx');

    const confirmedMapping = {};
    for (const [header, p] of Object.entries(previewRes.body.proposedMapping)) {
      if (p.field) confirmedMapping[header] = p.field;
    }

    const commitRes = await request(app).post('/api/import/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionId: previewRes.body.sessionId, confirmedMapping });

    expect(commitRes.status).toBe(200);
    expect(commitRes.body.summary.errored).toBe(0);
    expect(commitRes.body.summary.inserted).toBe(2);

    const { rows } = await pool.query(
      `SELECT docket_id2, state_id, district_id, level7_id, intimation_assign_deadline, survey_assigned_on,
              case_latitude, case_longitude, source_villager_name, source_villager_relation, source_villager_mobile
       FROM survey_cases ORDER BY docket_id2`
    );
    expect(rows).toHaveLength(2);

    // GUIDs round-trip exactly, as strings (never coerced through Number()).
    expect(rows[0].state_id).toBe('5C77DA4F-BC9B-4099-BED7-15E06A45F376');
    expect(rows[0].district_id).toBe('C8F18EC8-9F46-4C5F-A333-9DD719AF15AF');
    expect(rows[0].level7_id).toBe('38C308F0-7483-47E2-974D-AB56B07EEEF6');

    // The real "Active" status string never reaches the date column as a bad value.
    expect(rows[0].intimation_assign_deadline).toBeNull();

    // survey_assigned_on (the real TAT basis) imported correctly as a date.
    expect(rows[0].survey_assigned_on).not.toBeNull();

    // New fields from this round: GPS + source villager contact.
    expect(Number(rows[1].case_latitude)).toBeCloseTo(29.43, 2);
    expect(Number(rows[1].case_longitude)).toBeCloseTo(77.32, 2);
    expect(rows[1].source_villager_name).toBe('Suresh');
    expect(rows[1].source_villager_relation).toBe('Neighbor');
    expect(rows[1].source_villager_mobile).toBe('8888888888');
  });

  test('auto-assign priority for these imported cases is driven by survey_assigned_on, and villages group by district_id correctly', async () => {
    // Give a surveyor eligibility in this district (district_id is the real GUID here,
    // proving auto-assign's district grouping works against GUID district IDs too).
    const surveyor = await createUser({ name: 'HR Surveyor', email: 'realdata-surveyor@test.local', roleKey: 'surveyor' });
    await pool.query('UPDATE users SET home_district_ids = $1 WHERE id = $2', [['C8F18EC8-9F46-4C5F-A333-9DD719AF15AF'], surveyor.id]);

    const previewRes = await request(app).post('/api/auto-assign/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        districtIds: ['C8F18EC8-9F46-4C5F-A333-9DD719AF15AF'],
        reportDate: '2026-10-20', tatDays: 10, minCases: 1, p1CutoffDays: 5, p2CutoffDays: 7,
      });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.totalAssigned).toBe(2);
    const s = previewRes.body.perSurveyor.find((x) => x.surveyorId === surveyor.id);
    expect(s).toBeTruthy();
    expect(s.totalCases).toBe(2);
    // Both cases share Janauli(45) -> one village -> one surveyor, never split.
    expect(s.villageCount).toBe(1);
    // row 1: assignedOn Oct14 + 10 = Oct24; report Oct20 -> daysRemaining=4 -> P1.
    // row 2: assignedOn Oct5 + 10 = Oct15; report Oct20 -> daysRemaining=-5 -> P1 (overdue).
    expect(s.p1).toBe(2);
  });
});
