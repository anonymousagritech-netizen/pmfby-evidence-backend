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
  // Farmer's own contact number. Deliberately NO bare 'mobile'/'phone' alias and no
  // surveyor/villager aliases: mapping Surveyor_Mobile or Villagers_Mobile here would be
  // the data-integrity bug described at the top of this file.
  { field: 'Farmer_Mobile', aliases: ['farmer_mobile', 'farmermobile', 'farmerphone', 'farmercontact', 'farmerphoneno', 'farmermobileno'] },
  { field: 'Type_Of_Incidence', aliases: ['type_of_incidence', 'incidencetype'] },
  { field: 'Date_Of_Incidence', aliases: ['date_of_incidence', 'incidencedate'] },
  { field: 'Crop_Status_At_Incidence', aliases: ['crop_status_at_incidence', 'cropstatus'] },
  { field: 'Farmer_Intimation_Date', aliases: ['farmer_intimation_date', 'intimationdate'] },
  { field: 'Sowing_Date', aliases: ['sowing_date', 'sowingdate'] },
  { field: 'Farm_Area', aliases: ['farm_area', 'area', 'farmarea'] },
  { field: 'Crop_Name', aliases: ['crop_name', 'cropname', 'crop'] },
  { field: 'Land_Survey_Number', aliases: ['land_survey_number', 'surveynumber', 'landsurveyno'] },
  { field: 'Land_Division_Number', aliases: ['land_division_number', 'divisionnumber'] },
  { field: 'Insurance_Company', aliases: ['insurance_company', 'insurer', 'insurancecompanyname'] },
  { field: 'Application_Source', aliases: ['application_source', 'appsource', 'applicationsourceorigin'] },
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
  // Case-level GPS from the source system (e.g. farm/incident location) — distinct
  // from the surveyor's own geotag-on-visit (call_events.geo_lat/geo_lon), which is
  // captured live by the app itself, not imported.
  { field: 'Case_Latitude', aliases: ['latitude', 'case_latitude'] },
  { field: 'Case_Longitude', aliases: ['longitude', 'case_longitude'] },
  // Source-system witness/contact fields, captured at the time the case was created in
  // the source system — see importService.js for why these are stored as a reference
  // on survey_cases rather than auto-populating call_events' own person-contacted
  // fields (which must reflect the surveyor's actual attempt, not stale import data).
  { field: 'Source_Is_Farmer_Present', aliases: ['isfarmerpresent', 'is_farmer_present'] },
  { field: 'Source_Villager_Relation', aliases: ['villagersrelation', 'villager_relation'] },
  { field: 'Source_Villager_Name', aliases: ['villagersname', 'villager_name'] },
  { field: 'Source_Villager_Mobile', aliases: ['villagersmobile', 'villager_mobile'] },
  // ASSIGN column: admin puts the district surveyor's phone number here to auto-assign
  // the case to that user on import. Blank = leave unassigned (admin assigns manually).
  { field: 'Assign_To', aliases: ['assign', 'assignto', 'assign_to', 'assignedto'] },
  // Additional PMFBY portal export columns
  { field: 'Cropping_Pattern', aliases: ['croppingpattern', 'cropping_pattern'] },
  { field: 'Surveyor_Remark', aliases: ['surveyorremark', 'surveyor_remark'] },
  { field: 'Affected_Area_Percentage', aliases: ['affectedareapercentage', 'affected_area_pct'] },
  { field: 'Crop_Loss_Percentage', aliases: ['croplosspercentage', 'crop_loss_pct'] },
  { field: 'Total_Damage_Percentage', aliases: ['totaldamagepercentage', 'total_damage_pct'] },
  { field: 'Survey_Crop_Loss_Type_Code', aliases: ['surveycroplosst ypecode', 'surveycroplosstypecode', 'survey_crop_loss_type_code'] },
  { field: 'Survey_Completed_On', aliases: ['surveycompletedon', 'survey_completed_on'] },
  { field: 'Survey_Cause_Of_Loss', aliases: ['surveycauseofloss', 'survey_cause_of_loss'] },
  { field: 'Survey_Crop_Condition', aliases: ['surveycropcondition', 'survey_crop_condition'] },
  { field: 'Incidence_Loss_Level', aliases: ['incidencelosslevel', 'incidence_loss_level'] },
  { field: 'Crop_Status_At_Survey', aliases: ['cropstatusatsurvey', 'crop_status_at_survey'] },
  { field: 'Survey_Schedule_Date', aliases: ['surveyscheduledate', 'survey_schedule_date'] },
  { field: 'Harvest_Date', aliases: ['harvestdate', 'harvest_date'] },
  { field: 'IC_Calamity_Cover', aliases: ['iccalamitycover', 'ic_calamity_cover'] },
  { field: 'WSL_Event_From_Date', aliases: ['wsleventfromdate', 'wsl_event_from_date'] },
  { field: 'WSL_Event_To_Date', aliases: ['wsleventtodate', 'wsl_event_to_date'] },
  { field: 'Portal_Flag', aliases: ['flag', 'portal_flag'] },
  { field: 'WSL_Loss_Percentage', aliases: ['wsllosspercentage', 'wsl_loss_percentage', 'wsl_loss_pct'] },
  { field: 'Calamity_IC_Remarks', aliases: ['calamityicremarks', 'calamity_ic_remarks'] },
  { field: 'IC_Approval_At', aliases: ['icapprovalat', 'ic_approval_at'] },
  { field: 'IC_Approval_Comment', aliases: ['icapprovalcomment', 'ic_approval_comment'] },
  { field: 'Deputy_Director_Approval_At', aliases: ['deputydirectorapprovalat', 'deputy_director_approval_at'] },
  { field: 'Deputy_Director_Comment', aliases: ['deputydirectorcomment', 'deputy_director_comment'] },
  { field: 'Survey_Mode', aliases: ['mode', 'survey_mode', 'surveymode'] },
  { field: 'Other_Crop_Name', aliases: ['othercropname', 'other_crop_name'] },
  { field: 'Survey_Affected_Crop_Name', aliases: ['surveyaffectedcropname', 'survey_affected_crop_name'] },
  { field: 'IC_Signed_Copy_Uploaded', aliases: ['icsignedcopyuploaded', 'ic_signed_copy_uploaded'] },
  { field: 'Is_Survey_Officer_Present', aliases: ['issurveyofficerpresent', 'is_survey_officer_present'] },
  { field: 'Survey_Officer_Name', aliases: ['surveyofficername', 'survey_officer_name'] },
  { field: 'Survey_Officer_Mobile', aliases: ['surveyofficermobile', 'survey_officer_mobile'] },
  { field: 'Survey_Officer_Designation', aliases: ['surveyofficerdesignation', 'survey_officer_designation'] },
  { field: 'Spoc_Intimation_Assign_Expire', aliases: ['spocintimationassignexpire', 'spoc_intimation_assign_expire'] },
  { field: 'Action_Status', aliases: ['actionstatus', 'action_status', 'bystatus'] },
  { field: 'Crop_Loss_Report_ID', aliases: ['croplossreportid', 'crop_loss_report_id'] },
  { field: 'Picture_Affected_Area', aliases: ['pictureaffectedarea', 'picture_affected_area'] },
  { field: 'Level4_Code', aliases: ['level4code', 'level4_code'] },
  { field: 'Level5_Code', aliases: ['level5code', 'level5_code'] },
  { field: 'Level6_Code', aliases: ['level6code', 'level6_code'] },
  { field: 'Level7_Code', aliases: ['level7code', 'level7_code'] },
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
