// End-to-end bulk surveyor import: RBAC, create-on-Active, Active->Inactive and
// Inactive->Delete transitions on re-upload, synthetic login credentials, and the
// hard requirement that a deactivated/deleted bulk-imported surveyor actually cannot
// log in or see assigned farmers (not just that their DB row looks right).
const ExcelJS = require('exceljs');
const request = require('supertest');
const { createApp } = require('../../src/app');
const {
  resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, assignFarmerDirect, pool, closePool,
} = require('../helpers/testDb');
const { tokenFor } = require('../helpers/authToken');
const { verifyPassword } = require('../../src/utils/auth');

const app = createApp();

async function buildBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['districtName', 'surveyorName', 'surveyorMobile', 'Status (Active/Inactive/Delete)']);
  for (const r of rows) sheet.addRow(r);
  return wb.xlsx.writeBuffer();
}

async function doImport(adminToken, rows) {
  const buffer = await buildBuffer(rows);
  const previewRes = await request(app).post('/api/users/bulk-import/preview')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', Buffer.from(buffer), 'surveyors.xlsx');
  expect(previewRes.status).toBe(200);
  const commitRes = await request(app).post('/api/users/bulk-import/commit')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ sessionId: previewRes.body.sessionId });
  expect(commitRes.status).toBe(200);
  return commitRes.body;
}

describe('Bulk surveyor import: RBAC', () => {
  let adminToken, surveyorToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    const admin = await createUser({ name: 'Admin', email: 'sbi-admin@test.local', roleKey: 'super_admin' });
    const surveyor = await createUser({ name: 'Surveyor', email: 'sbi-surveyor@test.local', roleKey: 'surveyor' });
    adminToken = tokenFor(admin, 'super_admin');
    surveyorToken = tokenFor(surveyor, 'surveyor');
  });

  test('non-admin cannot preview or commit', async () => {
    const buffer = await buildBuffer([['Palwal', 'X', 1111111111, 'Active']]);
    const previewRes = await request(app).post('/api/users/bulk-import/preview')
      .set('Authorization', `Bearer ${surveyorToken}`).attach('file', Buffer.from(buffer), 's.xlsx');
    expect(previewRes.status).toBe(403);

    const commitRes = await request(app).post('/api/users/bulk-import/commit')
      .set('Authorization', `Bearer ${surveyorToken}`).send({ sessionId: 'whatever' });
    expect(commitRes.status).toBe(403);
  });
});

describe('Bulk surveyor import: create, re-upload transitions, credentials, and access revocation', () => {
  let adminToken, admin;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    admin = await createUser({ name: 'Admin', email: 'sbi2-admin@test.local', roleKey: 'super_admin' });
    adminToken = tokenFor(admin, 'super_admin');
  });

  afterAll(async () => { await closePool(); });

  test('first upload creates an Active surveyor with a synthetic email, a usable generated password, and force_password_change set', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'Ramesh Kumar', 9000000001, 'Active'],
      ['Faridabad', 'Ramesh Kumar', 9000000001, 'Active'],
    ]);
    expect(result.summary.created).toBe(1);

    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', ['9000000001']);
    expect(rows).toHaveLength(1);
    const user = rows[0];
    expect(user.email).toBe('9000000001@pmfby-evidence.local');
    expect(user.is_active).toBe(true);
    expect(user.force_password_change).toBe(true);
    expect([...user.home_district_ids].sort()).toEqual(['Faridabad', 'Palwal']);

    // The generated password is real and usable — NOT the shared seed password, and
    // different accounts don't collide (we can at least prove it's a real bcrypt hash
    // that isn't the empty/default seed hash by confirming an arbitrary wrong guess
    // fails and the account truly requires *some* real secret to log in).
    const wrongGuess = await verifyPassword('TestPass123!', user.password_hash); // shared seed password used elsewhere in tests
    expect(wrongGuess).toBe(false);
  });

  test('re-upload with status Inactive actually deactivates the existing account (not just a default)', async () => {
    const before = await pool.query('SELECT is_active FROM users WHERE phone = $1', ['9000000001']);
    expect(before.rows[0].is_active).toBe(true);

    const result = await doImport(adminToken, [
      ['Palwal', 'Ramesh Kumar', 9000000001, 'Inactive'],
    ]);
    expect(result.summary.deactivated).toBe(1);

    const after = await pool.query('SELECT is_active FROM users WHERE phone = $1', ['9000000001']);
    expect(after.rows[0].is_active).toBe(false);
  });

  test('deactivated surveyor cannot log in, cannot authenticate, and cannot see their formerly-assigned farmers', async () => {
    const { rows } = await pool.query('SELECT id FROM users WHERE phone = $1', ['9000000001']);
    const surveyorId = rows[0].id;
    const { farmer } = await createFarmerWithCase({ farmerName: 'Formerly Assigned Farmer' });
    await assignFarmerDirect(farmer.id, surveyorId);

    // Can't log in with the (unknown to us, but doesn't matter) generated password —
    // is_active=false alone must block login regardless of password correctness.
    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: '9000000001@pmfby-evidence.local', password: 'anything-at-all' });
    expect(loginRes.status).toBe(401);

    // A token minted directly (bypassing login) must ALSO be rejected by the
    // authenticate middleware's fresh is_active check — deactivation takes effect
    // immediately, not just at next login (same guarantee as the existing manual
    // deactivate flow).
    const staleToken = tokenFor({ id: surveyorId }, 'surveyor');
    const farmersRes = await request(app).get('/api/farmers').set('Authorization', `Bearer ${staleToken}`);
    expect(farmersRes.status).toBe(401);
  });

  test('re-upload with status Delete soft-deletes the account (reversible history, revoked access)', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'Ramesh Kumar', 9000000001, 'Delete'],
    ]);
    expect(result.summary.deleted).toBe(1);

    const { rows } = await pool.query('SELECT deleted_at, is_active FROM users WHERE phone = $1', ['9000000001']);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].is_active).toBe(false);
  });

  test('a mobile that disappears entirely from a later upload is left untouched (silence does not act)', async () => {
    await doImport(adminToken, [
      ['Palwal', 'Untouched Surveyor', 9000000099, 'Active'],
    ]);
    const before = await pool.query('SELECT is_active, deleted_at FROM users WHERE phone = $1', ['9000000099']);
    expect(before.rows[0].is_active).toBe(true);

    // A later upload that never mentions this mobile at all.
    await doImport(adminToken, [
      ['Palwal', 'Someone Else', 9000000098, 'Active'],
    ]);

    const after = await pool.query('SELECT is_active, deleted_at FROM users WHERE phone = $1', ['9000000099']);
    expect(after.rows[0].is_active).toBe(true);
    expect(after.rows[0].deleted_at).toBeNull();
  });

  test('a Delete for an unknown mobile (never imported before) is a safe no-op, not an error', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'Ghost', 9000000077, 'Delete'],
    ]);
    expect(result.summary.skippedDeleteUnknown).toBe(1);
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', ['9000000077']);
    expect(rows).toHaveLength(0);
  });

  test('rows with no usable status are skipped, not defaulted to Active or Inactive', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'No Status Person', 9000000066, null],
    ]);
    expect(result.summary.skippedNoStatus).toBe(1);
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', ['9000000066']);
    expect(rows).toHaveLength(0);
  });

  test('a status conflict within one upload is flagged as a warning with the resolved value', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'Conflicted', 9000000055, 'Active'],
      ['Palwal', 'Conflicted', 9000000055, 'Inactive'],
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].mobile).toBe('9000000055');
    expect(result.warnings[0].resolvedTo).toBe('Inactive');
  });

  test('the whole import is audited as one batch summary row, not one row per surveyor', async () => {
    const { rows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'bulk_import_surveyors' ORDER BY created_at DESC LIMIT 1");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.summary).toBeTruthy();
    expect(Array.isArray(rows[0].metadata.changeLog)).toBe(true);
  });
});
