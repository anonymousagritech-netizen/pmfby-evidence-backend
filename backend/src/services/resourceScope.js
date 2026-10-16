const { pool } = require('../db/pool');
const { ROLES } = require('../middleware/rbac');

// Returns the survey_cases row (plus joined farmer_id) a surveyor is allowed to act on,
// or null if the case doesn't exist OR the farmer isn't currently assigned to them.
// Server-side enforcement — never trust a frontend's own filtering.
async function getCaseIfSurveyorAssigned(caseId, userId) {
  const { rows } = await pool.query(
    `SELECT sc.* FROM survey_cases sc
     JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id AND fa.active = true
     WHERE sc.id = $1 AND sc.deleted_at IS NULL AND fa.user_id = $2`,
    [caseId, userId]
  );
  return rows[0] || null;
}

function managerCanAccessCase(user, caseRow) {
  if (user.role_key === ROLES.SUPER_ADMIN) return true;
  if (user.role_key !== ROLES.MANAGER) return false;
  if (user.scope_district_id) return caseRow.district_id === user.scope_district_id;
  if (user.scope_state_id) return caseRow.state_id === user.scope_state_id;
  return false;
}

// Unified access check used by evidence/zip/emergency routes: super_admin always;
// manager if case is in their geographic scope; surveyor only if actively assigned.
async function getCaseForUserOrNull(caseId, user) {
  const { rows } = await pool.query('SELECT * FROM survey_cases WHERE id = $1 AND deleted_at IS NULL', [caseId]);
  const caseRow = rows[0];
  if (!caseRow) return null;

  if (user.role_key === ROLES.SUPER_ADMIN) return caseRow;
  if (user.role_key === ROLES.MANAGER) return managerCanAccessCase(user, caseRow) ? caseRow : null;
  if (user.role_key === ROLES.SURVEYOR) {
    const assigned = await getCaseIfSurveyorAssigned(caseId, user.id);
    return assigned ? caseRow : null;
  }
  return null;
}

module.exports = { getCaseIfSurveyorAssigned, managerCanAccessCase, getCaseForUserOrNull };
