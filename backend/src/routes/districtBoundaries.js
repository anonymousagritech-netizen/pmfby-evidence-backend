const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const GEOJSON_PATH = path.join(__dirname, '../data/district_boundaries.geojson');
let cachedGeo = null;

function loadGeo() {
  if (cachedGeo) return cachedGeo;
  if (!fs.existsSync(GEOJSON_PATH)) return null;
  cachedGeo = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  return cachedGeo;
}

// GET /api/districts/boundaries?ids=D1,D2
// Returns GeoJSON FeatureCollection filtered to the requested district IDs.
// If no ids param, returns all districts (for the map overlay).
router.get('/boundaries', (req, res) => {
  const geo = loadGeo();
  if (!geo) return res.status(404).json({ error: 'district_boundaries.geojson not found on server' });

  const idsParam = req.query.ids;
  if (!idsParam) return res.json(geo);

  const requested = idsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const features = geo.features.filter((f) => {
    const distId = (f.properties?.district_id || f.properties?.District_ID || '').toString().toUpperCase();
    const distName = (f.properties?.district || f.properties?.District || f.properties?.DISTRICT || '').toString().toUpperCase();
    return requested.some((r) => distId === r || distName === r || distName.includes(r) || r.includes(distName));
  });

  res.json({ type: 'FeatureCollection', features });
});

// GET /api/districts/boundaries/status — so the UI can show if GeoJSON is loaded
router.get('/boundaries/status', (req, res) => {
  const exists = fs.existsSync(GEOJSON_PATH);
  const size = exists ? fs.statSync(GEOJSON_PATH).size : 0;
  res.json({ loaded: exists, sizeBytes: size });
});

module.exports = router;
