const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');
const { runAutoAssignPure } = require('../services/autoAssignService');
const villageLookup = require('../services/villageLookupService');
const boundaryLookup = require('../services/boundaryLookupService');
const { buildAutoAssignWorkbook } = require('../services/autoAssignExportService');

const router = express.Router();
router.use(authenticate);

// Pulls active, non-manually-overridden cases for the given district(s) plus each
// eligible surveyor's home districts, in the shape autoAssignService expects.
async function loadCasesAndSurveyors(districtIds) {
  // TAT counts from ASSIGNMENT, not intimation (confirmed against real production
  // usage — see autoAssignService.js's module comment): survey_assigned_on is the
  // basis, not farmer_intimation_date. A case therefore no longer needs
  // farmer_intimation_date to be eligible for auto-assign (only contact_status
  // matters) — survey_assigned_on may itself be NULL for a never-assigned case, which
  // autoAssignService.runAutoAssignPure treats as "this run IS the assignment".
  const { rows: caseRows } = await pool.query(
    `SELECT sc.id, sc.district_id, sc.district_name, sc.level7_id AS village_id, sc.level7_name AS village_name,
            sc.survey_assigned_on AS assigned_on, sc.farmer_id, sc.docket_id2, fr.farmer_name,
            fa.user_id AS manual_surveyor_id, fa.manual_override
     FROM survey_cases sc
     JOIN farmer_records fr ON fr.id = sc.farmer_id
     LEFT JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id AND fa.active = true
     WHERE sc.deleted_at IS NULL
       AND sc.district_id = ANY($1)
       AND sc.contact_status NOT IN ('completed', 'denied')`,
    [districtIds]
  );
  const cases = caseRows.map((r) => ({
    id: r.id,
    districtId: r.district_id,
    districtName: r.district_name,
    villageId: r.village_id,
    villageName: r.village_name,
    assignedOn: r.assigned_on,
    farmerId: r.farmer_id,
    farmerName: r.farmer_name,
    docketId2: r.docket_id2,
    manualOverride: !!r.manual_override,
    manualSurveyorId: r.manual_surveyor_id,
  }));

  const { rows: surveyorRows } = await pool.query(
    `SELECT u.id, u.home_district_ids FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE r.key = $1 AND u.is_active = true AND u.deleted_at IS NULL`,
    [ROLES.SURVEYOR]
  );
  const surveyorsByDistrict = new Map();
  for (const d of districtIds) surveyorsByDistrict.set(d, []);
  for (const s of surveyorRows) {
    for (const d of s.home_district_ids || []) {
      if (surveyorsByDistrict.has(d)) surveyorsByDistrict.get(d).push(s.id);
    }
  }
  return { cases, surveyorsByDistrict };
}

function validateParams(body) {
  const { districtIds, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays } = body;
  if (!Array.isArray(districtIds) || districtIds.length === 0) return 'districtIds (non-empty array) required';
  if (!reportDate || isNaN(new Date(reportDate).getTime())) return 'valid reportDate required';
  if (!Number.isFinite(tatDays) || tatDays <= 0) return 'tatDays (positive number) required';
  return null;
}

// Shared by preview and commit so results are guaranteed identical between the two.
async function computeRun(req) {
  const { districtIds, reportDate, tatDays, minCases = 40, p1CutoffDays = 5, p2CutoffDays = 7 } = req.body;
  const { cases, surveyorsByDistrict } = await loadCasesAndSurveyors(districtIds);
  const result = runAutoAssignPure({
    cases, surveyorsByDistrict, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays,
  });
  const params = { districtIds, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays };
  return { result, params, cases };
}

// Builds a small list of {villageName, districtId, surveyorId, caseCount, lat, lon} for
// only the villages actually touched by this run (never all 653k villages — the map on
// the admin-web side renders this list directly, no clustering needed at this size).
async function buildVillageMarkers(cases, placements) {
  const byVillage = new Map(); // `${districtId}|${villageId||villageName}` -> {villageName, districtId, surveyorId, caseCount}
  for (const c of cases) {
    const surveyorId = placements.get(c.id);
    if (!surveyorId) continue;
    const key = `${c.districtId}|${c.villageId || c.villageName}`;
    if (!byVillage.has(key)) {
      byVillage.set(key, { villageName: c.villageName, districtId: c.districtId, surveyorId, caseCount: 0 });
    }
    byVillage.get(key).caseCount += 1;
  }
  // Note: survey_cases.district_id is a source-system ID, not the district NAME the
  // centroid lookup matches against (district_h) — we don't yet have an ID->name
  // mapping table, so district is intentionally omitted here and matching is by
  // village name alone (best-effort; can occasionally match the wrong same-named
  // village in another state). See ROADMAP.md.
  const markers = [];
  for (const v of byVillage.values()) {
    const found = await villageLookup.findVillage(v.villageName);
    if (found.match) markers.push({ ...v, lat: found.match.lat, lon: found.match.lon });
  }
  return markers;
}

// surveyorId -> array of farmerIds assigned in this run. Used by the admin-web page's
// bulk-transfer UI ("select all of surveyor X's cases from this run, move them to
// surveyor Y") — bulk transfer operates on farmerId (same unit assignFarmer/
// farmer_assignments already use), not caseId.
function buildAssignedFarmerIdsBySurveyor(cases, placements) {
  const bySurveyor = new Map();
  for (const c of cases) {
    const surveyorId = placements.get(c.id);
    if (!surveyorId) continue;
    if (!bySurveyor.has(surveyorId)) bySurveyor.set(surveyorId, new Set());
    bySurveyor.get(surveyorId).add(c.farmerId);
  }
  const out = {};
  for (const [surveyorId, farmerIdSet] of bySurveyor.entries()) out[surveyorId] = [...farmerIdSet];
  return out;
}

// Same village set as buildVillageMarkers, but returns full simplified polygon
// geometry instead of a single centroid point — only for the villages in this run, per
// the brief ("don't make a user's browser download all-India boundaries to see one
// district's auto-assign run"). Mirrors the same village-name-only matching caveat.
async function buildVillagePolygons(cases, placements) {
  const byVillage = new Map();
  for (const c of cases) {
    const surveyorId = placements.get(c.id);
    if (!surveyorId) continue;
    const key = `${c.districtId}|${c.villageId || c.villageName}`;
    if (!byVillage.has(key)) {
      byVillage.set(key, { villageName: c.villageName, districtId: c.districtId, surveyorId, caseCount: 0 });
    }
    byVillage.get(key).caseCount += 1;
  }
  const refs = [...byVillage.values()];
  const boundaryRecs = await boundaryLookup.getByVillageRefs(refs.map((v) => ({ village: v.villageName })));
  const byName = new Map(boundaryRecs.map((r) => [r.village, r]));
  const polygons = [];
  for (const v of refs) {
    const rec = byName.get(v.villageName);
    if (rec) polygons.push({ ...v, geometry: rec.geometry });
  }
  return polygons;
}

// Dry run: compute the assignment, persist it as a 'preview' run for traceability, but
// write nothing to farmer_assignments.
router.post('/preview', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const err = validateParams(req.body);
    if (err) return res.status(400).json({ error: err });
    const { result, params, cases } = await computeRun(req);
    const summary = {
      totalCases: result.totalCases,
      totalAssigned: result.totalAssigned,
      totalUnassigned: result.totalUnassigned,
      perSurveyor: result.perSurveyor,
      underMinimumSurveyors: result.underMinimumSurveyors,
    };
    const { rows } = await pool.query(
      `INSERT INTO assignment_runs (run_by, mode, params, summary) VALUES ($1,'preview',$2,$3) RETURNING id, created_at`,
      [req.user.id, JSON.stringify(params), JSON.stringify(summary)]
    );
    await recordAudit(null, {
      userId: req.user.id, action: 'auto_assign_preview', resourceType: 'assignment_runs', resourceId: rows[0].id, metadata: params,
    });
    const villageMarkers = await buildVillageMarkers(cases, result.placements);
    const villagePolygons = await buildVillagePolygons(cases, result.placements);
    const assignedFarmerIdsBySurveyor = buildAssignedFarmerIdsBySurveyor(cases, result.placements);
    res.json({
      runId: rows[0].id, createdAt: rows[0].created_at, ...summary,
      unassignedCaseIds: result.unassignedCaseIds, villageMarkers, villagePolygons, assignedFarmerIdsBySurveyor,
    });
  } catch (e) { next(e); }
});

// Commit: same computation, but actually writes farmer_assignments for every case that
// got a placement (reusing the existing one-active-assignment-per-farmer invariant).
router.post('/commit', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const err = validateParams(req.body);
    if (err) return res.status(400).json({ error: err });
    const { result, params, cases } = await computeRun(req);
    const villageMarkers = await buildVillageMarkers(cases, result.placements);
    const villagePolygons = await buildVillagePolygons(cases, result.placements);
    const assignedFarmerIdsBySurveyor = buildAssignedFarmerIdsBySurveyor(cases, result.placements);

    const response = await withTransaction(async (client) => {
      // placements: Map<caseId, surveyorId> keyed by survey_case id; resolve to farmer_id.
      for (const [caseId, surveyorId] of result.placements.entries()) {
        const { rows: caseRows } = await client.query('SELECT farmer_id FROM survey_cases WHERE id = $1', [caseId]);
        if (!caseRows[0]) continue;
        const farmerId = caseRows[0].farmer_id;
        await client.query(
          `UPDATE farmer_assignments SET active = false, unassigned_at = now()
           WHERE farmer_id = $1 AND active = true AND manual_override = false`,
          [farmerId]
        );
        // Skip if an active manual-override assignment already covers this farmer.
        const { rows: activeRows } = await client.query(
          `SELECT id FROM farmer_assignments WHERE farmer_id = $1 AND active = true LIMIT 1`,
          [farmerId]
        );
        if (activeRows[0]) continue;
        await client.query(
          `INSERT INTO farmer_assignments (farmer_id, user_id, assigned_by, manual_override)
           VALUES ($1,$2,$3,false)`,
          [farmerId, surveyorId, req.user.id]
        );
      }
      const summary = {
        totalCases: result.totalCases,
        totalAssigned: result.totalAssigned,
        totalUnassigned: result.totalUnassigned,
        perSurveyor: result.perSurveyor,
        underMinimumSurveyors: result.underMinimumSurveyors,
      };
      const { rows } = await client.query(
        `INSERT INTO assignment_runs (run_by, mode, params, summary) VALUES ($1,'commit',$2,$3) RETURNING id, created_at`,
        [req.user.id, JSON.stringify(params), JSON.stringify(summary)]
      );
      await recordAudit(client, {
        userId: req.user.id, action: 'auto_assign_commit', resourceType: 'assignment_runs', resourceId: rows[0].id, metadata: params,
      });
      return { runId: rows[0].id, createdAt: rows[0].created_at, ...summary };
    });
    res.json({ ...response, villageMarkers, villagePolygons, assignedFarmerIdsBySurveyor });
  } catch (e) { next(e); }
});

// Excel download of a run's result — takes the SAME params body as preview/commit
// (the algorithm is deterministic, so re-running it with identical params reproduces
// identical placements; this endpoint never writes anything) and streams back a
// generated .xlsx with an Assigned Cases sheet, a Surveyor Summary sheet, and an
// Unassigned sheet when applicable. Super Admin only, audited.
router.post('/export', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const err = validateParams(req.body);
    if (err) return res.status(400).json({ error: err });
    const { result, params } = await computeRun(req);

    const surveyorIds = result.perSurveyor.map((s) => s.surveyorId);
    const { rows: surveyorRows } = await pool.query(
      'SELECT id, name, phone FROM users WHERE id = ANY($1)', [surveyorIds]
    );
    const surveyorContacts = new Map(surveyorRows.map((u) => [u.id, { name: u.name, mobile: u.phone || '' }]));

    const buffer = await buildAutoAssignWorkbook({
      casesWithPriority: result.casesWithPriority,
      placements: result.placements,
      perSurveyor: result.perSurveyor,
      unassignedCaseIds: result.unassignedCaseIds,
      surveyorContacts,
    });

    await recordAudit(null, {
      userId: req.user.id, action: 'auto_assign_export', resourceType: 'assignment_runs', metadata: params,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="auto-assign-${params.reportDate}.xlsx"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

router.get('/runs', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ar.*, u.name AS run_by_name FROM assignment_runs ar
       LEFT JOIN users u ON u.id = ar.run_by ORDER BY ar.created_at DESC LIMIT 50`
    );
    res.json({ runs: rows });
  } catch (e) { next(e); }
});

// Village centroid/name lookup for validation (exact + fuzzy) during import review.
router.get('/villages/lookup', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { village, district } = req.query;
    if (!village) return res.status(400).json({ error: 'village query param required' });
    const result = await villageLookup.findVillage(village, district);
    res.json(result);
  } catch (e) { next(e); }
});

// Nearby villages for a given village (cross-district fallback sourcing).
router.get('/villages/nearby', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { village, district, limit, excludeDistrict } = req.query;
    if (!village) return res.status(400).json({ error: 'village query param required' });
    const nearby = await villageLookup.findNearby({
      village, districtName: district, limit: limit ? parseInt(limit, 10) : 20, excludeDistrict,
    });
    res.json({ nearby });
  } catch (e) { next(e); }
});

module.exports = router;
