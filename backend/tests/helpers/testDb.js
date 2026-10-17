process.env.NODE_ENV = 'test';
require('dotenv').config();
const { pool } = require('../../src/db/pool');
const { hashPassword } = require('../../src/utils/auth');

// Truncates all app tables (keeps roles/message_templates seed data, since migrations
// don't seed them — tests seed roles/templates themselves via ensureRolesAndTemplates).
async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE assignment_runs, audit_logs, import_batches, zip_archives, evidence_files,
      emergency_incidents, discrepancy_flags, integrity_concerns, message_events,
      call_recordings, call_events, farmer_assignments, survey_cases, farmer_records,
      message_templates, users, roles RESTART IDENTITY CASCADE
  `);
}

async function ensureRolesAndTemplates() {
  const roles = [
    { key: 'super_admin', name: 'Super Admin' },
    { key: 'manager', name: 'Manager' },
    { key: 'surveyor', name: 'Surveyor' },
  ];
  for (const r of roles) {
    await pool.query('INSERT INTO roles (key, name) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [r.key, r.name]);
  }
  await pool.query(
    `INSERT INTO message_templates (code, name, channel, body_template) VALUES
     ('FORMAT_1_DENIED', 'Denied', 'sms', 'Farmer: {Farmer_Name} Attempt: {Attempt_No} Village: {Village_Name}'),
     ('FORMAT_4_INCIDENT', 'Incident', 'internal', 'Incident for {Farmer_Name}')
     ON CONFLICT (code) DO NOTHING`
  );
}

async function createUser({ name, email, roleKey, scopeStateId, scopeDistrictId }) {
  const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE key = $1', [roleKey]);
  const passwordHash = await hashPassword('TestPass123!');
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role_id, scope_state_id, scope_district_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, email, passwordHash, roleRows[0].id, scopeStateId || null, scopeDistrictId || null]
  );
  return rows[0];
}

async function createFarmerWithCase({ farmerName = 'Test Farmer', village = 'TestVillage', villageId = 'V1',
  stateId = 'HR', districtId = 'HR-01', docketId2 = `D-${Date.now()}-${Math.random()}`, applicationNo = `A-${Date.now()}`,
  intimationDate = null, assignedOn = null } = {}) {
  const { rows: farmerRows } = await pool.query(
    `INSERT INTO farmer_records (farmer_name, village_name, village_id, district_id, state_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [farmerName, village, villageId, districtId, stateId, `${farmerName}|${villageId}|`.toLowerCase()]
  );
  const farmer = farmerRows[0];
  const { rows: caseRows } = await pool.query(
    `INSERT INTO survey_cases (farmer_id, docket_id2, application_no, state_id, district_id, level7_name, level7_id, survey_status, farmer_intimation_date, survey_assigned_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9) RETURNING *`,
    [farmer.id, docketId2, applicationNo, stateId, districtId, village, villageId, intimationDate, assignedOn]
  );
  return { farmer, surveyCase: caseRows[0] };
}

async function assignFarmerDirect(farmerId, userId) {
  await pool.query(
    `INSERT INTO farmer_assignments (farmer_id, user_id, active) VALUES ($1,$2,true)`,
    [farmerId, userId]
  );
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool, resetDb, ensureRolesAndTemplates, createUser, createFarmerWithCase, assignFarmerDirect, closePool,
};
