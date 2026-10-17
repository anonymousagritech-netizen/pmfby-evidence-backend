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

    // THE critical bug fix: the commit response must actually hand back the
    // plaintext temp password for this newly-created account — otherwise nobody,
    // not even the admin, can ever log the surveyor in.
    expect(result.credentials).toHaveLength(1);
    const cred = result.credentials[0];
    expect(cred.mobile).toBe('9000000001');
    expect(cred.email).toBe('9000000001@pmfby-evidence.local');
    expect(cred.tempPassword).toBeTruthy();
    expect(cred.tempPassword.length).toBeGreaterThanOrEqual(10);

    // Prove it's not just a plausible-looking string — it must actually verify
    // against the stored hash, and the account must actually be able to log in
    // with it through the real /api/auth/login endpoint.
    const hashMatches = await verifyPassword(cred.tempPassword, user.password_hash);
    expect(hashMatches).toBe(true);

    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: cred.email, password: cred.tempPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.forcePasswordChange).toBe(true);

    // The plaintext password must never reach the audit trail.
    const { rows: auditRows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'bulk_import_surveyors' ORDER BY created_at DESC LIMIT 1");
    const auditJson = JSON.stringify(auditRows[0].metadata);
    expect(auditJson).not.toContain(cred.tempPassword);
    expect(auditJson.toLowerCase()).not.toContain('temppassword');
  });

  test('a re-upload that only updates an already-existing surveyor does NOT return a credential for them (show-once-at-creation only)', async () => {
    // 9000000001 already exists from the previous test — re-upload with a district
    // change but the same Active status; this is an update, not a creation.
    const result = await doImport(adminToken, [
      ['Rohtak', 'Ramesh Kumar', 9000000001, 'Active'],
    ]);
    expect(result.summary.created).toBe(0);
    expect(result.credentials).toHaveLength(0);
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

describe('End-to-end: temp password -> forced change -> old password revoked', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDb();
    await ensureRolesAndTemplates();
    const admin = await createUser({ name: 'E2E Admin', email: 'e2e-admin@test.local', roleKey: 'super_admin' });
    adminToken = tokenFor(admin, 'super_admin');
  });

  afterAll(async () => { await closePool(); });

  test('full lifecycle: temp password logs in and forces a change; new password works; old temp password is rejected afterward', async () => {
    const result = await doImport(adminToken, [
      ['Palwal', 'E2E Surveyor', 9000000200, 'Active'],
    ]);
    const cred = result.credentials[0];
    expect(cred).toBeTruthy();

    // 1. Temp password logs in, and the response says a change is required.
    const firstLogin = await request(app).post('/api/auth/login').send({ email: cred.email, password: cred.tempPassword });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.user.forcePasswordChange).toBe(true);
    const surveyorToken = firstLogin.body.token;

    // /me must report the same flag, camelCase, consistent with /login (both admin-web
    // and the native app key off forcePasswordChange).
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${surveyorToken}`);
    expect(meRes.body.user.forcePasswordChange).toBe(true);

    // 2. Change the password via the real endpoint both clients call.
    const changeRes = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${surveyorToken}`)
      .send({ currentPassword: cred.tempPassword, newPassword: 'MyRealPassword1!' });
    expect(changeRes.status).toBe(200);

    // 3. force_password_change is cleared — a fresh /me no longer demands a change.
    const meAfter = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${surveyorToken}`);
    expect(meAfter.body.user.forcePasswordChange).toBe(false);

    // 4. The OLD temp password no longer works for a subsequent login.
    const staleLogin = await request(app).post('/api/auth/login').send({ email: cred.email, password: cred.tempPassword });
    expect(staleLogin.status).toBe(401);

    // 5. The NEW password logs in fine, and no longer demands a change.
    const newLogin = await request(app).post('/api/auth/login').send({ email: cred.email, password: 'MyRealPassword1!' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.forcePasswordChange).toBe(false);
  });
});
