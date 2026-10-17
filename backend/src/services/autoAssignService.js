// Village-based auto-assignment algorithm (pure functions, no DB access, unit-testable
// with synthetic data) plus a thin DB-facing wrapper (runAutoAssign) used by the route.
//
// Rules (per spec):
//  - days_remaining = (assigned_on + tatDays) - reportDate. **Confirmed against real
//    production usage**: "TAT day is 10 days from ASSIGNMENT", not from intimation.
//    assigned_on is survey_cases.survey_assigned_on for a case that already has one
//    (an existing agency assignment from the imported source data); for a case with no
//    assigned_on yet (never assigned), the moment this auto-assign run executes
//    (reportDate) IS the assignment, so assigned_on falls back to reportDate — see
//    routes/autoAssign.js's loadCasesAndSurveyors, which does this COALESCE. An earlier
//    version of this function used farmer_intimation_date, which was wrong; fixed after
//    the user explicitly clarified the TAT basis.
//  - priority: P1 if days_remaining <= p1CutoffDays, P2 if <= p2CutoffDays, else P3
//  - group cases by district, then by village within district; ONE village = ONE
//    surveyor, never split
//  - within a district, assign whole villages to that district's eligible surveyors via
//    greedy "give to whoever currently has fewest cases"
//  - after initial assignment, reorder (not reassign) each surveyor's list to roughly
//    50/25/25 P1/P2/P3, nearest-deadline first within each bucket
//  - manually-overridden cases are never touched by the algorithm
const { haversineKm } = require('./villageLookupService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function computePriority(assignedOnDate, tatDays, reportDate, p1CutoffDays, p2CutoffDays) {
  const deadline = new Date(assignedOnDate);
  deadline.setDate(deadline.getDate() + tatDays);
  const daysRemaining = daysBetween(reportDate, deadline);
  let priority;
  if (daysRemaining <= p1CutoffDays) priority = 'P1';
  else if (daysRemaining <= p2CutoffDays) priority = 'P2';
  else priority = 'P3';
  return { daysRemaining, priority, deadline };
}

// cases: array of { id, districtId, villageId, villageName, assignedOn, manualOverride, manualSurveyorId }
// surveyorsByDistrict: Map<districtId, array of surveyorId>
// Returns { placements: Map<caseId, surveyorId>, perSurveyor: Map<surveyorId, {cases:[]}>, unassignedCases: [] }
function assignVillagesToSurveyors(cases, surveyorsByDistrict) {
  const perSurveyor = new Map(); // surveyorId -> { cases: [] }
  const placements = new Map();
  const unassignedCases = [];

  // Pre-seed manual overrides.
  for (const c of cases) {
    if (c.manualOverride && c.manualSurveyorId) {
      placements.set(c.id, c.manualSurveyorId);
      if (!perSurveyor.has(c.manualSurveyorId)) perSurveyor.set(c.manualSurveyorId, { cases: [] });
      perSurveyor.get(c.manualSurveyorId).cases.push(c);
    }
  }
  for (const surveyorId of [...surveyorsByDistrict.values()].flat()) {
    if (!perSurveyor.has(surveyorId)) perSurveyor.set(surveyorId, { cases: [] });
  }

  // Group remaining (non-overridden) cases by district -> village.
  const byDistrict = new Map();
  for (const c of cases) {
    if (c.manualOverride && c.manualSurveyorId) continue;
    if (!byDistrict.has(c.districtId)) byDistrict.set(c.districtId, new Map());
    const villages = byDistrict.get(c.districtId);
    const vKey = c.villageId || c.villageName || 'UNKNOWN_VILLAGE';
    if (!villages.has(vKey)) villages.set(vKey, []);
    villages.get(vKey).push(c);
  }

  for (const [districtId, villageMap] of byDistrict.entries()) {
    const surveyors = surveyorsByDistrict.get(districtId) || [];
    if (surveyors.length === 0) {
      for (const vCases of villageMap.values()) unassignedCases.push(...vCases);
      continue;
    }
    // Largest villages first so big villages don't land awkwardly late in the balance.
    const villageEntries = [...villageMap.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [, vCases] of villageEntries) {
      // Give the whole village to whoever currently has the fewest cases (ties broken by
      // surveyor order for determinism).
      let best = surveyors[0];
      let bestCount = perSurveyor.get(best).cases.length;
      for (const s of surveyors) {
        const count = perSurveyor.get(s).cases.length;
        if (count < bestCount) { best = s; bestCount = count; }
      }
      for (const c of vCases) {
        placements.set(c.id, best);
        perSurveyor.get(best).cases.push(c);
      }
    }
  }

  return { placements, perSurveyor, unassignedCases };
}

// Reorders (does not reassign) each surveyor's case list to target ~50% P1 / 25% P2 /
// 25% P3 composition ordering — in practice this means: sort by priority bucket (P1
// first, then P2, then P3), and within each bucket by soonest deadline first. The
// "50/25/25" target is informational (reported, not enforced by moving cases between
// surveyors — that would violate the one-village-one-surveyor rule).
function orderSurveyorCaseList(casesWithPriority) {
  const order = { P1: 0, P2: 1, P3: 2 };
  return [...casesWithPriority].sort((a, b) => {
    if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
    return a.daysRemaining - b.daysRemaining;
  });
}

function summarizeSurveyor(surveyorId, casesWithPriority, minCases) {
  const p1 = casesWithPriority.filter((c) => c.priority === 'P1').length;
  const p2 = casesWithPriority.filter((c) => c.priority === 'P2').length;
  const p3 = casesWithPriority.filter((c) => c.priority === 'P3').length;
  const districts = [...new Set(casesWithPriority.map((c) => c.districtId))];
  const villages = new Set(casesWithPriority.map((c) => c.villageId || c.villageName));
  return {
    surveyorId,
    totalCases: casesWithPriority.length,
    districtCount: districts.length,
    districts,
    villageCount: villages.size,
    p1,
    p2,
    p3,
    underMinimum: casesWithPriority.length < minCases,
    orderedCaseIds: orderSurveyorCaseList(casesWithPriority).map((c) => c.id),
  };
}

// Haversine-based fallback: when a district can't fill a surveyor's minimum caseload
// from its own unassigned villages, suggest nearby villages (possibly cross-district)
// using centroid data. Pure function: villagePool is an array of
// { villageId, villageName, districtId, lat, lon, caseCount } not yet claimed by anyone.
function findFallbackVillages(originLat, originLon, villagePool, neededCaseCount, excludeDistrictId) {
  const candidates = villagePool
    .filter((v) => v.districtId !== excludeDistrictId)
    .map((v) => ({ ...v, distanceKm: haversineKm(originLat, originLon, v.lat, v.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const picked = [];
  let total = 0;
  for (const v of candidates) {
    if (total >= neededCaseCount) break;
    picked.push(v);
    total += v.caseCount;
  }
  return picked;
}

// Full pipeline over plain-object cases/surveyors (no DB). Used directly by unit tests
// and by the DB-facing wrapper below after it has loaded rows from Postgres.
function runAutoAssignPure({ cases, surveyorsByDistrict, reportDate, tatDays, minCases = 40, p1CutoffDays = 5, p2CutoffDays = 7 }) {
  const withPriority = cases.map((c) => {
    // A case with no assigned_on yet (never assigned by anyone) is, by definition,
    // assigned AT this run — so TAT counts from reportDate for it, not from some
    // earlier/undefined date. See the module-level comment above.
    const assignedOnDate = c.assignedOn ? new Date(c.assignedOn) : new Date(reportDate);
    return {
      ...c,
      ...computePriority(assignedOnDate, tatDays, new Date(reportDate), p1CutoffDays, p2CutoffDays),
    };
  });
  const { placements, perSurveyor, unassignedCases } = assignVillagesToSurveyors(withPriority, surveyorsByDistrict);

  const perSurveyorSummary = [];
  for (const [surveyorId, { cases: sCases }] of perSurveyor.entries()) {
    perSurveyorSummary.push(summarizeSurveyor(surveyorId, sCases, minCases));
  }

  return {
    totalCases: cases.length,
    totalAssigned: cases.length - unassignedCases.length,
    totalUnassigned: unassignedCases.length,
    unassignedCaseIds: unassignedCases.map((c) => c.id),
    perSurveyor: perSurveyorSummary,
    placements, // Map<caseId, surveyorId> — used by commit mode to write farmer_assignments
    underMinimumSurveyors: perSurveyorSummary.filter((s) => s.underMinimum).map((s) => s.surveyorId),
    // Every input case plus its computed priority/daysRemaining/deadline — the detail
    // row set the Excel export (and anything else wanting per-case detail) is built
    // from, so that logic isn't recomputing the priority math a second time.
    casesWithPriority: withPriority,
  };
}

module.exports = {
  computePriority,
  assignVillagesToSurveyors,
  orderSurveyorCaseList,
  summarizeSurveyor,
  findFallbackVillages,
  runAutoAssignPure,
};
