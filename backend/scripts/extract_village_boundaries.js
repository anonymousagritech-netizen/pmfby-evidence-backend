// Streams the trimmed all-India village BOUNDARY shapefile (same geometries/objectid
// order as merged_villages, just fewer attribute columns), reprojects every ring vertex
// LCC meters -> WGS84 lon/lat (reusing the exact proj4 definition verified against
// Chittoor, AP in extract_village_centroids.js), simplifies each polygon for web
// rendering, and writes one NDJSON record per village to
// backend/data/village_boundaries.ndjson. Never buffers the whole 492MB .dbf / 573MB
// .shp in memory — shapefile.open()/.read() streams record-by-record, and each record
// is reprojected+simplified+written immediately, same discipline as the centroid script.
const fs = require('fs');
const path = require('path');
const shapefile = require('shapefile');
const proj4 = require('proj4');
const simplify = require('@turf/simplify').default;

const SHP = 'C:/Users/akshay/Downloads/national_boundary_extracted/National_Boundary.shp';
const DBF = 'C:/Users/akshay/Downloads/national_boundary_extracted/National_Boundary.dbf';
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'village_boundaries.ndjson');
const SUMMARY_FILE = path.join(OUT_DIR, 'village_boundaries_summary.json');

const LCC_DEF = '+proj=lcc +lat_1=12.472955 +lat_2=35.1728044444444 +lat_0=24.0 +lon_0=80.0 +x_0=4000000.0 +y_0=4000000.0 +datum=WGS84 +units=m +no_defs';

// Tolerance in degrees (~0.001 deg ~= 110m at this latitude) — keeps a village outline
// visually recognizable (villages are km-scale) while cutting vertex count
// substantially. A smaller tolerance (0.0005, ~55m) and 5-decimal coordinate precision
// were tried first on a 2000-record sample and projected to ~387MB for all of India;
// this setting (0.001 deg tolerance + 4-decimal/~11m coordinate precision) projected to
// ~190-210MB on the same sample. Note most of that size floor is intrinsic (every
// polygon needs a minimum ~4 vertices plus per-record JSON overhead across 650k+
// records) rather than something a larger tolerance meaningfully shrinks further —
// pushed much past this, villages start losing recognizable shape, which isn't worth it
// since this file isn't going into git either way (see upload-endpoint pattern below).
const SIMPLIFY_TOLERANCE_DEG = 0.001;
const COORD_PRECISION = 4; // ~11m at the equator — fine for a web map outline

function round(n) {
  return Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

function reprojectRing(ring) {
  return ring.map(([x, y]) => {
    const [lon, lat] = proj4(LCC_DEF, 'EPSG:4326', [x, y]);
    return [round(lon), round(lat)];
  });
}

function reprojectGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(reprojectRing) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(reprojectRing)) };
  }
  return null;
}

function simplifyGeometry(geometry) {
  const feature = { type: 'Feature', properties: {}, geometry };
  try {
    const simplified = simplify(feature, { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false, mutate: true });
    return simplified.geometry;
  } catch (e) {
    return geometry; // fall back to the (already reprojected) unsimplified geometry
  }
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = fs.createWriteStream(OUT_FILE, { flags: 'w' });

  const source = await shapefile.open(SHP, DBF);
  let total = 0, written = 0, skipped = 0;
  const perState = {};
  const errors = [];
  let totalVertsBefore = 0, totalVertsAfter = 0;

  while (true) {
    let result;
    try {
      result = await source.read();
    } catch (e) {
      errors.push('read error at record ' + total + ': ' + e.message);
      break;
    }
    if (result.done) break;
    total++;
    const f = result.value;
    try {
      const props = f.properties;
      if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
        skipped++;
        if (errors.length < 200) errors.push(`record ${total} (${props.village}): unsupported geometry type ${f.geometry && f.geometry.type}`);
        continue;
      }
      const reprojected = reprojectGeometry(f.geometry);
      const vertsBefore = JSON.stringify(reprojected).split('],[').length;
      const simplified = simplifyGeometry(reprojected);
      const vertsAfter = JSON.stringify(simplified).split('],[').length;
      totalVertsBefore += vertsBefore;
      totalVertsAfter += vertsAfter;

      const rec = {
        village: props.village || null,
        objectid: props.objectid ?? null,
        gram_panchayat: props.gram_panch || null,
        block: props.block || null,
        subdistrict: props.subdistric || null,
        district: props.district || null,
        state: props.state || null,
        geometry: simplified,
      };
      out.write(JSON.stringify(rec) + '\n');
      written++;
      const stateKey = rec.state || 'UNKNOWN';
      perState[stateKey] = (perState[stateKey] || 0) + 1;
    } catch (e) {
      skipped++;
      if (errors.length < 200) errors.push(`record ${total}: ${e.message}`);
    }
    if (total % 50000 === 0) {
      console.log(`processed ${total}, written ${written}, skipped ${skipped}`);
    }
  }

  await new Promise((resolve) => out.end(resolve));

  const summary = {
    total_records: total,
    written,
    skipped,
    per_state: perState,
    avg_vertices_before_simplify: written ? Math.round(totalVertsBefore / written) : 0,
    avg_vertices_after_simplify: written ? Math.round(totalVertsAfter / written) : 0,
    simplify_tolerance_deg: SIMPLIFY_TOLERANCE_DEG,
    error_sample: errors.slice(0, 200),
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  console.log('DONE. total=', total, 'written=', written, 'skipped=', skipped);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
