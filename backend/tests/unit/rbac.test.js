const { requireRole, managerScopeFilter, ROLES } = require('../../src/middleware/rbac');

function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('requireRole middleware', () => {
  test('401s when no user on request', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();
    requireRole(ROLES.SUPER_ADMIN)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('403s when user role is not in the allowed list', () => {
    const req = { user: { role_key: ROLES.SURVEYOR } };
    const res = mockRes();
    const next = jest.fn();
    requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER)(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when role is allowed', () => {
    const req = { user: { role_key: ROLES.MANAGER } };
    const res = mockRes();
    const next = jest.fn();
    requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });
});

describe('managerScopeFilter', () => {
  test('super_admin gets an unrestricted (empty) filter', () => {
    expect(managerScopeFilter({ role_key: ROLES.SUPER_ADMIN, scope_state_id: 'HR' })).toEqual({});
  });

  test('manager gets their own state/district scope', () => {
    expect(managerScopeFilter({ role_key: ROLES.MANAGER, scope_state_id: 'HR', scope_district_id: 'HR-01' }))
      .toEqual({ stateId: 'HR', districtId: 'HR-01' });
  });

  test('manager with no scope configured fails closed (nulls, not wildcard)', () => {
    expect(managerScopeFilter({ role_key: ROLES.MANAGER, scope_state_id: null, scope_district_id: null }))
      .toEqual({ stateId: null, districtId: null });
  });
});
