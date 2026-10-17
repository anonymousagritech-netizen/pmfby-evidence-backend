// Lazy, in-memory lookup over the village centroid NDJSON extracted from the all-India
// village boundary shapefile (see scripts/extract_village_centroids.js). Loaded once per
// process on first use. The file lives outside git if it's too large (see
// data/README.md / ROADMAP.md) — in that case this service degrades gracefully by
// returning empty results rather than crashing the app.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const NDJSON_PATH = path.join(__dirname, '..', '..', 'data', 'village_centroids.ndjson');

let villages = null; // array of records
let byDistrict = null; // Map<normDistrict, array of records>
let loadPromise = null;

function norm(s) {
  return (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Levenshtein distance, used for fuzzy district/village name matching against Excel
// import variants (OCR/typo/transliteration differences).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

async function load() {
  if (villages) return villages;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!fs.existsSync(NDJSON_PATH)) {
      villages = [];
      byDistrict = new Map();
      return villages;
    }
    const list = [];
    const dMap = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(NDJSON_PATH, { encoding: 'utf8' }) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (e) { continue; }
      list.push(rec);
      const key = norm(rec.district_h || rec.district);
      if (!dMap.has(key)) dMap.set(key, []);
      dMap.get(key).push(rec);
    }
    villages = list;
    byDistrict = dMap;
    return villages;
  })();
  return loadPromise;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Exact match first, then best fuzzy match (similarity threshold configurable) within
// the given district if provided, else across all villages.
async function findVillage(villageName, districtName, { threshold = 0.82 } = {}) {
  await load();
  let candidates = villages;
  if (districtName) {
    const key = norm(districtName);
    candidates = byDistrict.get(key);
    if (!candidates) {
      // fuzzy-match the district itself
      let bestKey = null, bestScore = 0;
      for (const k of byDistrict.keys()) {
        const s = similarity(k, key);
        if (s > bestScore) { bestScore = s; bestKey = k; }
      }
      candidates = bestScore >= threshold ? byDistrict.get(bestKey) : villages;
    }
  }
  const exact = candidates.find((v) => norm(v.village) === norm(villageName));
  if (exact) return { match: exact, confidence: 1, method: 'exact' };

  let best = null, bestScore = 0;
  for (const v of candidates) {
    const s = similarity(v.village, villageName);
    if (s > bestScore) { bestScore = s; best = v; }
  }
  if (best && bestScore >= threshold) return { match: best, confidence: bestScore, method: 'fuzzy' };
  return { match: null, confidence: bestScore, method: 'none' };
}

// Nearest villages to a given village (by name+district) or raw lat/lon, optionally
// restricted to a set of allowed districts (e.g. "adjacent districts only").
async function findNearby({ lat, lon, village, districtName, limit = 20, excludeDistrict = null }) {
  await load();
  let origin = { lat, lon };
  if ((lat === undefined || lon === undefined) && village) {
    const found = await findVillage(village, districtName);
    if (!found.match) return [];
    origin = { lat: found.match.lat, lon: found.match.lon };
  }
  const scored = villages
    .filter((v) => !excludeDistrict || norm(v.district_h || v.district) !== norm(excludeDistrict))
    .map((v) => ({ village: v, distanceKm: haversineKm(origin.lat, origin.lon, v.lat, v.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
  return scored;
}

async function isLoaded() {
  await load();
  return villages.length > 0;
}

// Drops the in-memory cache so the next lookup re-reads the file from disk — used after
// an admin uploads a replacement NDJSON (see routes/villageData.js).
function resetCache() {
  villages = null;
  byDistrict = null;
  loadPromise = null;
}

module.exports = { load, findVillage, findNearby, haversineKm, similarity, isLoaded, resetCache, NDJSON_PATH };
