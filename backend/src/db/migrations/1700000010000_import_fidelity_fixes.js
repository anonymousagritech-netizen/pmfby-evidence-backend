// Data-fidelity fixes found by running a real production Excel sample (Haryana PMFBY
// data) through the import pipeline: real source files carry case-level GPS and a
// source-system witness/contact capture that the original spec's column set didn't
// have columns for. See ROADMAP.md for why these are stored as source/reference data
// rather than feeding call_events' own person-contacted fields directly.
exports.up = (pgm) => {
  pgm.addColumns('survey_cases', {
    // Case-level GPS from the source system (e.g. farm/incident location) — distinct
    // from call_events.geo_lat/geo_lon, which is the surveyor's own live geotag taken
    // at the moment of an actual contact attempt.
    case_latitude: { type: 'numeric' },
    case_longitude: { type: 'numeric' },
    // Source-system witness/contact capture, as it existed in the source system at
    // import time — a reference for the surveyor, not an app-verified "person
    // contacted" record (that's call_events.person_contacted_*, populated only by an
    // actual contact attempt made through this app).
    source_is_farmer_present: { type: 'text' },
    source_villager_relation: { type: 'text' },
    source_villager_name: { type: 'text' },
    source_villager_mobile: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('survey_cases', [
    'case_latitude', 'case_longitude',
    'source_is_farmer_present', 'source_villager_relation', 'source_villager_name', 'source_villager_mobile',
  ]);
};
