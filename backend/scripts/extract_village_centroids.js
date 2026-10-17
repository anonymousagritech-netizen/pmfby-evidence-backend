// Streams the all-India village boundary shapefile, computes centroids,
// reprojects from WGS_1984_India_NSF_LCC to WGS84 lon/lat, and writes NDJSON.
const fs = require('fs');
const path = require('path');
const shapefile = require('shapefile');
const proj4 = require('proj4');

const SHP = 'C:/Users/akshay/Downloads/merged_villages_extracted/merged_villages.shp';
const DBF = 'C:/Users/akshay/Downloads/merged_villages_extracted/merged_villages.dbf';
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'village_centroids.ndjson');
const SUMMARY_FILE = path.join(OUT_DIR, 'village_centroids_summary.json');

const LCC_DEF = '+proj=lcc +lat_1=12.472955 +lat_2=35.1728044444444 +lat_0=24.0 +lon_0=80.0 +x_0=4000000.0 +y_0=4000000.0 +datum=WGS84 +units=m +no_defs';

function ringCentroid(ring) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) { sx += x; sy += y; n++; }
  return [sx / n, sy / n];
}

function geometryCentroidMeters(geometry) {
  // Use the exterior ring of the largest polygon (by vertex count) for Polygon/MultiPolygon.
  let rings = [];
  if (geometry.type === 'Polygon') {
    rings = [geometry.coordinates[0]];
  } else if (geometry.type === 'MultiPolygon') {
    rings = geometry.coordinates.map(poly => poly[0]);
  } else {
    return null;
  }
  let best = rings[0];
  for (const r of rings) if (r.length > best.length) best = r;
  return ringCentroid(best);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = fs.createWriteStream(OUT_FILE, { flags: 'w' });

  const source = await shapefile.open(SHP, DBF);
  let total = 0, written = 0, skipped = 0;
  const perState = {};
  const errors = [];
  const inIndiaBounds = (lat, lon) => lat >= 6 && lat <= 37 && lon >= 68 && lon <= 97;

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
      const centroidM = geometryCentroidMeters(f.geometry);
      if (!centroidM) { skipped++; errors.push('record ' + total + ' (' + props.village + '): unsupported geometry type ' + (f.geometry && f.geometry.type)); continue; }
      const [lon, lat] = proj4(LCC_DEF, 'EPSG:4326', centroidM);
      if (!inIndiaBounds(lat, lon)) {
        skipped++;
        if (errors.length < 200) errors.push('record ' + total + ' (' + props.village + '): out-of-bounds lat/lon ' + lat + ',' + lon);
        continue;
      }
      const rec = {
        village: props.village || null,
        vlcode: props.vlcode || null,
        gram_panchayat: props.gram_panch || null,
        block: props.block || null,
        subdistrict: props.subdistric || null,
        district: props.district || null,
        district_h: props.district_h || null,
        state: props.state || null,
        state_name: props.state_name || null,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
      };
      out.write(JSON.stringify(rec) + '\n');
      written++;
      const stateKey = rec.state_name || rec.state || 'UNKNOWN';
      perState[stateKey] = (perState[stateKey] || 0) + 1;
    } catch (e) {
      skipped++;
      if (errors.length < 200) errors.push('record ' + total + ': ' + e.message);
    }
    if (total % 100000 === 0) {
      console.log(`processed ${total}, written ${written}, skipped ${skipped}`);
    }
  }

  await new Promise((resolve) => out.end(resolve));

  const summary = {
    total_records: total,
    written,
    skipped,
    per_state: perState,
    error_sample: errors.slice(0, 200),
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  console.log('DONE. total=', total, 'written=', written, 'skipped=', skipped);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
