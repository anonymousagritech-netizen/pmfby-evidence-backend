// AI/auto column mapping for Excel import: exact + fuzzy/alias header matching against
// the known app fields, so the admin never has to blind-import (a wrong mapping, e.g.
// Surveyor_Mobile -> Farmer_Mobile, is a real data-integrity bug per spec).

// Canonical app fields and header aliases (lowercased, non-alphanumeric stripped for
// comparison). Order doesn't matter; exact spec column names are listed as the first
// alias so an exact-header file maps with full confidence.
const FIELD_DEFS = [
  { field: 'Docket_ID2', aliases: ['docket_id2', 'docketid2', 'docketid'] },
  { field: 'Season_Name', aliases: ['season_name', 'season'] },
  { field: 'Scheme_Name', aliases: ['scheme_name', 'scheme'] },
  { field: 'Application_No', aliases: ['application_no', 'applicationno', 'appno'] },
  { field: 'Farmer_Name', aliases: ['farmer_name', 'farmername', 'name_of_farmer'] },
  { field: 'Type_Of_Incidence', aliases: ['type_of_incidence', 'incidencetype'] },
  { field: 'Date_Of_Incidence', aliases: ['date_of_incidence', 'incidencedate'] },
  { field: 'Crop_Status_At_Incidence', aliases: ['crop_status_at_incidence', 'cropstatus'] },
  { field: 'Farmer_Intimation_Date', aliases: ['farmer_intimation_date', 'intimationdate'] },
  { field: 'Sowing_Date', aliases: ['sowing_date', 'sowingdate'] },
  { field: 'Farm_Area', aliases: ['farm_area', 'area', 'farmarea'] },
  { field: 'Crop_Name', aliases: ['crop_name', 'cropname', 'crop'] },
  { field: 'Land_Survey_Number', aliases: ['land_survey_number', 'surveynumber', 'landsurveyno'] },
  { field: 'Land_Division_Number', aliases: ['land_division_number', 'divisionnumber'] },
  { field: 'Insurance_Company', aliases: ['insurance_company', 'insurer'] },
  { field: 'Application_Source', aliases: ['application_source', 'appsource'] },
  { field: 'State_Name', aliases: ['state_name', 'state'] },
  { field: 'State_ID', aliases: ['state_id', 'stateid'] },
  { field: 'District_Name', aliases: ['district_name', 'district'] },
  { field: 'District_ID', aliases: ['district_id', 'districtid'] },
  { field: 'Level4_Name', aliases: ['level4_name', 'level4name', 'tehsil_name', 'tehsil'] },
  { field: 'Level4_ID', aliases: ['level4_id', 'level4id'] },
  { field: 'Level5_Name', aliases: ['level5_name', 'level5name'] },
  { field: 'Level5_ID', aliases: ['level5_id', 'level5id'] },
  { field: 'Level6_Name', aliases: ['level6_name', 'level6name'] },
  { field: 'Level6_ID', aliases: ['level6_id', 'level6id'] },
  { field: 'Level7_Name', aliases: ['level7_name', 'level7name', 'village_name', 'village'] },
  { field: 'Level7_ID', aliases: ['level7_id', 'level7id', 'village_id', 'villageid'] },
  { field: 'Survey_Status', aliases: ['survey_status', 'surveystatus', 'status'] },
  { field: 'Intimation_Assign_Deadline', aliases: ['intimation_assign_deadline', 'assigndeadline', 'deadline'] },
  { field: 'Survey_Agency_Name', aliases: ['survey_agency_name', 'agencyname', 'agency'] },
  { field: 'Survey_Assigned_On', aliases: ['survey_assigned_on', 'assignedon'] },
  { field: 'Surveyor_Name', aliases: ['surveyor_name', 'surveyorname'] },
  { field: 'Surveyor_Mobile', aliases: ['surveyor_mobile', 'surveyormobile', 'surveyorphone'] },
];

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Levenshtein distance for fuzzy fallback when no exact alias match is found.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const NORMALIZED_ALIAS_INDEX = FIELD_DEFS.map((def) => ({
  field: def.field,
  normalizedAliases: def.aliases.map(normalizeHeader),
}));

// Returns { sourceHeader -> { field, confidence } } proposed mapping. confidence is
// 'exact' | 'fuzzy' | 'none'. The admin must confirm (and may override) before commit.
function proposeColumnMapping(sourceHeaders) {
  const mapping = {};
  const usedFields = new Set();
  for (const header of sourceHeaders) {
    const normalized = normalizeHeader(header);
    let best = null;

    for (const entry of NORMALIZED_ALIAS_INDEX) {
      if (usedFields.has(entry.field)) continue;
      if (entry.normalizedAliases.includes(normalized)) {
        best = { field: entry.field, confidence: 'exact' };
        break;
      }
    }

    if (!best) {
      let bestDistance = Infinity;
      let bestField = null;
      for (const entry of NORMALIZED_ALIAS_INDEX) {
        if (usedFields.has(entry.field)) continue;
        for (const alias of entry.normalizedAliases) {
          const distance = levenshtein(normalized, alias);
          const threshold = Math.max(2, Math.floor(alias.length * 0.25));
          if (distance <= threshold && distance < bestDistance) {
            bestDistance = distance;
            bestField = entry.field;
          }
        }
      }
      if (bestField) best = { field: bestField, confidence: 'fuzzy' };
    }

    if (best) {
      mapping[header] = best;
      usedFields.add(best.field);
    } else {
      mapping[header] = { field: null, confidence: 'none' };
    }
  }
  return mapping;
}

function knownFields() {
  return FIELD_DEFS.map((d) => d.field);
}

module.exports = { proposeColumnMapping, knownFields, normalizeHeader };
