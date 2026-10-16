const { signToken } = require('../../src/utils/auth');

function tokenFor(user, roleKey) {
  return signToken({
    id: user.id,
    role_key: roleKey,
    scope_state_id: user.scope_state_id,
    scope_district_id: user.scope_district_id,
  });
}

module.exports = { tokenFor };
