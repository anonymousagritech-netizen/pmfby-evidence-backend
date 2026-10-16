// End-to-end slice: import -> assign -> call -> SMS -> evidence saved -> ZIP produced ->
// manager downloads it. Exercises the real routes against the real (test) Postgres DB.
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../../src/app');
const { resetDb, ensureRolesAndTemplates, createUser, closePool, pool } = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');

const app = createApp();

async function buildSampleWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow([
    'Docket_ID2', 'Application_No', 'Farmer_Name', 'Level7_Name', 'Level7_ID',
    'District_Name', 'District_ID', 'State_Name', 'State_ID', 'Survey_Status',
    'Surveyor_Name', 'Surveyor_Mobile',
  ]);
  sheet.addRow([
    '00123', 'APP-001', 'Ramesh Kumar', 'Siwan Kalan', '007',
    'Kaithal', 'HR-01', 'Haryana', 'HR', 'ASSIGNED', 'Source Surveyor', '9000000000',
  ]);
  return workbook.xlsx.writeBuffer();
}

describe('End-to-end: import -> assign -> call -> SMS -> evidence -> ZIP -> download', () => {
  let admin;
  let surveyor;
  let manager;
  let adminToken;
  let surveyorToken;
  let managerToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'e2e-admin@test.local', roleKey: 'super_admin' });
    surveyor = await createUser({ name: 'Surveyor', email: 'e2e-surveyor@test.local', roleKey: 'surveyor' });
    manager = await createUser({ name: 'Manager', email: 'e2e-manager@test.local', roleKey: 'manager', scopeStateId: 'HR' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');
    managerToken = tokenFor(manager, 'manager');
  });

  afterAll(async () => { await closePool(); });

  let farmerId;
  let caseId;
  let callEventId;

  test('1. admin previews + commits the Excel import with the proposed mapping', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const previewRes = await request(app).post('/api/import/preview').set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'farmers.xlsx');
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.totalRows).toBe(1);
    expect(previewRes.body.proposedMapping.Farmer_Name.field).toBe('Farmer_Name');

    const finalMapping = {};
    for (const [header, proposal] of Object.entries(previewRes.body.proposedMapping)) {
      if (proposal.field) finalMapping[header] = proposal.field;
    }

    const commitRes = await request(app).post('/api/import/commit').set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionId: previewRes.body.sessionId, confirmedMapping: finalMapping });
    expect(commitRes.status).toBe(200);
    expect(commitRes.body.summary.inserted).toBe(1);

    const { rows } = await pool.query("SELECT * FROM farmer_records WHERE farmer_name = 'Ramesh Kumar'");
    expect(rows).toHaveLength(1);
    expect(rows[0].farmer_mobile).toBeNull(); // never auto-filled from Surveyor_Mobile
    farmerId = rows[0].id;

    const { rows: caseRows } = await pool.query('SELECT * FROM survey_cases WHERE farmer_id = $1', [farmerId]);
    expect(caseRows).toHaveLength(1);
    expect(caseRows[0].docket_id2).toBe('00123'); // preserved as string
    expect(caseRows[0].surveyor_mobile).toBe('9000000000'); // source surveyor, not farmer
    caseId = caseRows[0].id;
  });

  test('2. admin assigns the farmer to the surveyor', async () => {
    const res = await request(app).post('/api/assignments').set('Authorization', `Bearer ${adminToken}`)
      .send({ farmerId, userId: surveyor.id });
    expect(res.status).toBe(201);
  });

  test('3. surveyor now sees the farmer in their assigned list', async () => {
    const res = await request(app).get('/api/farmers').set('Authorization', `Bearer ${surveyorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.farmers.some((f) => f.id === farmerId)).toBe(true);
  });

  test('4. surveyor enters a validated farmer mobile (never invented)', async () => {
    const res = await request(app).patch(`/api/farmers/${farmerId}/mobile`).set('Authorization', `Bearer ${surveyorToken}`)
      .send({ farmerMobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.farmer.farmer_mobile).toBe('9876543210');
  });

  test('5. surveyor initiates a call -> attempt_no is backend-assigned to 1', async () => {
    const res = await request(app).post('/api/call-events').set('Authorization', `Bearer ${surveyorToken}`)
      .send({ caseId, phoneNumber: '9876543210', geo: { lat: 29.1, lon: 76.3, accuracyM: 12 } });
    expect(res.status).toBe(201);
    expect(res.body.callEvent.attempt_no).toBe(1);
    callEventId = res.body.callEvent.id;
  });

  test('6. surveyor records the call outcome as not_answered (user_entered, never fabricated)', async () => {
    const res = await request(app).patch(`/api/call-events/${callEventId}/outcome`).set('Authorization', `Bearer ${surveyorToken}`)
      .send({ outcome: 'not_answered' });
    expect(res.status).toBe(200);
    expect(res.body.callEvent.outcome_source).toBe('user_entered');
  });

  test('7. surveyor renders Format 3 (wrong number/not connected) SMS and records it as drafted', async () => {
    const { rows: templateRows } = await pool.query("SELECT * FROM message_templates WHERE code = 'FORMAT_1_DENIED'");
    const templateId = templateRows[0].id;

    const renderRes = await request(app).post(`/api/templates/${templateId}/render`).set('Authorization', `Bearer ${surveyorToken}`)
      .send({ caseId });
    expect(renderRes.status).toBe(200);
    expect(renderRes.body.rendered).toContain('Ramesh Kumar');
    expect(renderRes.body.attemptNo).toBe(1);

    const msgRes = await request(app).post('/api/message-events').set('Authorization', `Bearer ${surveyorToken}`)
      .send({ caseId, templateId, renderedText: renderRes.body.rendered, phoneNumber: '9876543210', callEventId });
    expect(msgRes.status).toBe(201);
    expect(msgRes.body.messageEvent.status).toBe('drafted');

    const openRes = await request(app).patch(`/api/message-events/${msgRes.body.messageEvent.id}/status`)
      .set('Authorization', `Bearer ${surveyorToken}`).send({ status: 'opened_composer' });
    expect(openRes.status).toBe(200);
    expect(openRes.body.messageEvent.status).toBe('opened_composer');
  });

  test('8. surveyor uploads a screenshot as evidence', async () => {
    const res = await request(app).post('/api/evidence').set('Authorization', `Bearer ${surveyorToken}`)
      .field('caseId', caseId).field('kind', 'screenshot').field('callEventId', callEventId)
      .attach('file', Buffer.from('fake-screenshot-bytes'), 'proof.png');
    expect(res.status).toBe(201);
    expect(res.body.evidenceFile.upload_status).toBe('uploaded');
  });

  test('9. surveyor requests ZIP generation; it becomes ready and is checksum-verified', async () => {
    const genRes = await request(app).post('/api/zip-archives/generate').set('Authorization', `Bearer ${surveyorToken}`)
      .send({ callEventId });
    expect(genRes.status).toBe(202);
    expect(genRes.body.zipArchive.status).toBe('ready');
    expect(genRes.body.zipArchive.filename).toMatch(/^Ramesh_Kumar_Contact_Siwan_Kalan_.*\.zip$/);
    expect(genRes.body.zipArchive.checksum_sha256).toHaveLength(64);
  });

  test('10. re-requesting ZIP generation is idempotent (returns the same ready archive)', async () => {
    const res1 = await request(app).post('/api/zip-archives/generate').set('Authorization', `Bearer ${surveyorToken}`).send({ callEventId });
    const res2 = await request(app).post('/api/zip-archives/generate').set('Authorization', `Bearer ${surveyorToken}`).send({ callEventId });
    expect(res1.body.zipArchive.id).toBe(res2.body.zipArchive.id);
  });

  test('11. manager (in scope) downloads the ZIP successfully', async () => {
    const { rows } = await pool.query('SELECT id FROM zip_archives WHERE call_event_id = $1', [callEventId]);
    const res = await request(app).get(`/api/zip-archives/${rows[0].id}/download`).set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  test('12. surveyor marks the case Survey Completed -> fully closes it', async () => {
    const res = await request(app).post(`/api/cases/${caseId}/resolve-outcome`).set('Authorization', `Bearer ${surveyorToken}`)
      .send({ outcome: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.case.contact_status).toBe('completed');
    expect(res.body.case.closed_at).toBeTruthy();
  });
});
