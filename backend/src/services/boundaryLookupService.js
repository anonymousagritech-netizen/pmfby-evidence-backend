// Lazy, in-memory lookup over the simplified village BOUNDARY NDJSON extracted from
// the trimmed national boundary shapefile (see scripts/extract_village_boundaries.js).
// Mirrors villageLookupService.js's load/index pattern deliberately (same lazy-load,
// same "file may not be present on this deploy -> degrade to empty" behavior, same
// upload-replaces-file mechanism) so the two datasets behave consistently.
//
// Indexed by district AND by (district, village) so two call shapes are cheap:
//  - "give me every boundary in district X" (district-scoped map load)
//  - "give me boundaries for exactly these (district, village) pairs" (the villages
//    actually touched by one auto-assign preview/commit run — the common case, and the
//    one that keeps the browser from ever downloading more than it needs)
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const NDJSON_PATH = path.join(__dirname, '..', '..', 'data', 'village_boundaries.ndjson');

let byDistrict = null; // Map<normDistrict, array of records>
let byDistrictVillage = null; // Map<`${normDistrict}|${normVillage}`, record>
let loadPromise = null;

function norm(s) {
  return (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function load() {
  if (byDistrict) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const dMap = new Map();
    const dvMap = new Map();
    if (!fs.existsSync(NDJSON_PATH)) {
      byDistrict = dMap;
      byDistrictVillage = dvMap;
      return;
    }
    const rl = readline.createInterface({ input: fs.createReadStream(NDJSON_PATH, { encoding: 'utf8' }) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (e) { continue; }
      const dKey = norm(rec.district);
      if (!dMap.has(dKey)) dMap.set(dKey, []);
      dMap.get(dKey).push(rec);
      dvMap.set(`${dKey}|${norm(rec.village)}`, rec);
    }
    byDistrict = dMap;
    byDistrictVillage = dvMap;
  })();
  return loadPromise;
}

async function getByDistrict(districtName) {
  await load();
  return byDistrict.get(norm(districtName)) || [];
}

// villageRefs: array of {village, district} — returns a boundary record per match
// found (silently skips any that aren't in the dataset, since not every imported
// village name is guaranteed to exist in this reference set).
//
// Same district_id-vs-district-name caveat as autoAssign.js's village markers: callers
// coming from survey_cases only have a district ID, not the district NAME this file
// indexes by, so `ref.district` is frequently absent/wrong here. When the
// district-qualified lookup misses, falls back to a village-name-only scan (linear over
// all districts) — fine for the handful of villages in one auto-assign run, not
// something to do for a whole-district bulk request.
async function getByVillageRefs(villageRefs) {
  await load();
  const out = [];
  for (const ref of villageRefs) {
    let rec = ref.district ? byDistrictVillage.get(`${norm(ref.district)}|${norm(ref.village)}`) : null;
    if (!rec) {
      const targetVillage = norm(ref.village);
      for (const candidate of byDistrictVillage.values()) {
        if (norm(candidate.village) === targetVillage) { rec = candidate; break; }
      }
    }
    if (rec) out.push(rec);
  }
  return out;
}

async function isLoaded() {
  await load();
  return byDistrict.size > 0;
}

function resetCache() {
  byDistrict = null;
  byDistrictVillage = null;
  loadPromise = null;
}

module.exports = { load, getByDistrict, getByVillageRefs, isLoaded, resetCache, NDJSON_PATH };
