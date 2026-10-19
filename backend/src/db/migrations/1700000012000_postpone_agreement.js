// Small additive migration: a "postponed" outcome used to only capture the new date, not
// whether the farmer actually AGREED to it (a case can be marked postponed procedurally
// without true farmer agreement — that is a distinct fact the field needs for accountability
// / the Excel activity export). These live on call_events (the per-attempt record) rather
// than survey_cases, since the export needs one row per contact attempt, not per case.
exports.up = (pgm) => {
  pgm.addColumns('call_events', {
    resolved_outcome: { type: 'text' }, // denied|postponed|wrong_number|dispute_incident|completed, set when this attempt's outcome is resolved
    farmer_agreed_to_postpone: { type: 'boolean' }, // null = not applicable (outcome wasn't 'postponed'); true/false otherwise
    postponed_until: { type: 'timestamptz' }, // the new survey date, only meaningful when farmer_agreed_to_postpone = true
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('call_events', ['resolved_outcome', 'farmer_agreed_to_postpone', 'postponed_until']);
};
