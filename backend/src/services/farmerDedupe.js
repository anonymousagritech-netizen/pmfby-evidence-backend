// Farmer identity dedupe heuristic. Docket_ID2/Application_No are SOURCE/case
// identifiers, not a safe assumption of unique farmer identity (spec requirement) —
// so farmer identity is derived from name + village + mobile instead.
//
// Key = normalized(farmer_name) + '|' + normalized(village_id or village_name) + '|' +
//       normalized(farmer_mobile or '')
// Two import rows with the same key are treated as the same farmer (new survey_cases
// row each, same farmer_records row). This is a heuristic, not a guarantee — documented
// as such; a future pass could add phonetic/fuzzy name matching (see ROADMAP.md).
function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildDedupeKey({ farmerName, villageId, villageName, farmerMobile }) {
  const namePart = normalize(farmerName);
  const villagePart = normalize(villageId) || normalize(villageName);
  const mobilePart = normalize(farmerMobile);
  return `${namePart}|${villagePart}|${mobilePart}`;
}

module.exports = { buildDedupeKey };
