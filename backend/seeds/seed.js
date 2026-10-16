// Seeds roles, a default admin/manager/surveyor user each, and the 4 Hindi message
// templates (verbatim from spec). Idempotent: safe to re-run (upserts on unique keys).
require('dotenv').config();
const { pool } = require('../src/db/pool');
const { hashPassword } = require('../src/utils/auth');

const TEMPLATES = [
  {
    code: 'FORMAT_1_DENIED',
    name: 'Farmer Denied',
    channel: 'sms',
    body: `किसान सर्वे की सूचना: किसान ने मना किया
किसान का नाम: {Farmer_Name}
किसान का मोबाइल नंबर: {Farmer_Mobile}
प्रयास संख्या (Attempt No.): {Attempt_No}
गाँव का नाम: {Village_Name}
मूल सर्वे तिथि: {Original_Survey_Date}
सर्वे की स्थिति: DENIED
मना करने का कारण: {Denial_Reason}
सर्वे टीम सदस्य का नाम: {Surveyor_Name}
सर्वे टीम सदस्य का मोबाइल नंबर: {Surveyor_Mobile}
धन्यवाद।`,
  },
  {
    code: 'FORMAT_2_POSTPONED',
    name: 'Survey Postponed',
    channel: 'sms',
    body: `किसान सर्वे स्थगित होने की सूचना
किसान का नाम: {Farmer_Name}
किसान का मोबाइल नंबर: {Farmer_Mobile}
प्रयास संख्या (Attempt No.): {Attempt_No}
गाँव का नाम: {Village_Name}
मूल सर्वे तिथि: {Original_Survey_Date}
स्थगित सर्वे तिथि: {Postponed_Survey_Date}
सर्वे की स्थिति: POSTPONED
स्थगित करने का कारण: {Postpone_Reason}
सर्वे टीम सदस्य का नाम: {Surveyor_Name}
सर्वे टीम सदस्य का मोबाइल नंबर: {Surveyor_Mobile}
कृपया निर्धारित समय-सीमा के भीतर सर्वे पूरा करने हेतु सर्वे टीम के संपर्क में रहें।
धन्यवाद।`,
  },
  {
    code: 'FORMAT_3_WRONG_NUMBER',
    name: 'Wrong Number / Not Connected',
    channel: 'sms',
    body: `किसान सर्वे संपर्क सूचना
किसान का नाम: {Farmer_Name}
किसान का मोबाइल नंबर: {Farmer_Mobile}
प्रयास संख्या (Attempt No.): {Attempt_No}
गाँव का नाम: {Village_Name}
मूल सर्वे तिथि: {Original_Survey_Date}
सर्वे की स्थिति: WRONG NUMBER / CALL NOT CONNECTED
संपर्क संबंधी समस्या: {Contact_Issue}
सर्वे टीम सदस्य का नाम: {Surveyor_Name}
सर्वे टीम सदस्य का मोबाइल नंबर: {Surveyor_Mobile}
धन्यवाद।`,
  },
  {
    code: 'FORMAT_4_INCIDENT',
    name: 'Incident Report (internal only — never sent as SMS)',
    channel: 'internal',
    body: `किसान सर्वे में घटना की सूचना
किसान का नाम: {Farmer_Name}
किसान का मोबाइल नंबर: {Farmer_Mobile}
प्रयास संख्या (Attempt No.): {Attempt_No}
गाँव का नाम: {Village_Name}
सर्वे की तारीख: {Survey_Date}
घटना की स्थिति: THREAT / ASSAULT / FORCED FORM FILLING
घटना का विवरण: {Incident_Description}
सर्वे टीम सदस्य का नाम: {Surveyor_Name}
सर्वे टीम सदस्य का मोबाइल नंबर: {Surveyor_Mobile}
साक्ष्य का प्रकार: PHOTO / VIDEO / OTHER
साक्ष्य की तारीख एवं समय: {Evidence_DateTime}
WhatsApp ग्रुप में रिपोर्ट की स्थिति: REPORTED / NOT REPORTED
सर्वे ऐप में अपडेट की स्थिति: UPDATED / NOT UPDATED
धन्यवाद।`,
  },
];

async function seedRoles() {
  const roles = [
    { key: 'super_admin', name: 'Super Admin' },
    { key: 'manager', name: 'State/District Manager' },
    { key: 'surveyor', name: 'Surveyor / Field User' },
  ];
  for (const role of roles) {
    await pool.query(
      `INSERT INTO roles (key, name) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
      [role.key, role.name]
    );
  }
}

async function seedTemplates() {
  for (const t of TEMPLATES) {
    await pool.query(
      `INSERT INTO message_templates (code, name, channel, body_template)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, channel = EXCLUDED.channel,
         body_template = EXCLUDED.body_template, updated_at = now()`,
      [t.code, t.name, t.channel, t.body]
    );
  }
}

async function seedUsers() {
  const { rows: roleRows } = await pool.query('SELECT id, key FROM roles');
  const roleIdByKey = Object.fromEntries(roleRows.map((r) => [r.key, r.id]));

  const users = [
    { name: 'Super Admin', email: 'admin@pmfby-evidence.local', password: 'ChangeMe123!', roleKey: 'super_admin' },
    { name: 'Haryana Manager', email: 'manager@pmfby-evidence.local', password: 'ChangeMe123!', roleKey: 'manager', scopeStateId: 'HR' },
    { name: 'Field Surveyor One', email: 'surveyor1@pmfby-evidence.local', password: 'ChangeMe123!', roleKey: 'surveyor' },
    { name: 'Field Surveyor Two', email: 'surveyor2@pmfby-evidence.local', password: 'ChangeMe123!', roleKey: 'surveyor' },
  ];

  for (const u of users) {
    const passwordHash = await hashPassword(u.password);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, scope_state_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
      [u.name, u.email, passwordHash, roleIdByKey[u.roleKey], u.scopeStateId || null]
    );
  }
}

async function main() {
  await seedRoles();
  await seedTemplates();
  await seedUsers();
  console.log('Seed complete. Default login: admin@pmfby-evidence.local / ChangeMe123! (CHANGE IN PRODUCTION)');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
