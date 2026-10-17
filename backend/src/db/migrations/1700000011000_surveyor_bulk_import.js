// Support for bulk surveyor import from Excel (districtName/surveyorName/
// surveyorMobile/Status). Bulk-created accounts get a synthetic login email and a
// system-generated password the surveyor never chose — force_password_change makes
// that gap visible to the login flow so it can route them to a reset screen on first
// login, instead of silently leaving a password only the import process ever knew.
exports.up = (pgm) => {
  pgm.addColumns('users', {
    force_password_change: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['force_password_change']);
};
