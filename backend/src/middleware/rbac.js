// Backend-enforced RBAC. Every route that touches farmer/case/evidence data must use
// requireRole and, where relevant, a resource-scoping check (see routes/* for
// per-resource ownership/scope checks) — the frontend is never trusted to filter data.
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  SURVEYOR: 'surveyor',
};

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role_key)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// A manager's geographic scope: null scope_state_id/district_id = org-wide (used for
// super_admin; a manager should always have at least a state scope assigned).
function managerScopeFilter(user) {
  if (user.role_key === ROLES.SUPER_ADMIN) return {};
  return {
    stateId: user.scope_state_id || null,
    districtId: user.scope_district_id || null,
  };
}

module.exports = { ROLES, requireRole, managerScopeFilter };
