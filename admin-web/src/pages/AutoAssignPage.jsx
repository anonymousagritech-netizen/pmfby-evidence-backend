import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Workflow, Map as MapIcon, UploadCloud, Database } from 'lucide-react';
import { api } from '../api/client';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';

// A fixed, readable palette cycled across surveyors (not priority/status colors, which
// are reserved for badges elsewhere) — distinct enough at a glance for a few dozen
// surveyors in one district run.
const SURVEYOR_COLORS = ['#0f2a4a', '#0d9488', '#b45309', '#6d28d9', '#b42318', '#1d4ed8', '#be185d', '#15803d'];
function colorForSurveyor(id, index) {
  return SURVEYOR_COLORS[index % SURVEYOR_COLORS.length];
}

function DataUploadCard({ title, description, statusEndpoint, uploadEndpoint, accent }) {
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);

  async function loadStatus() {
    try {
      const res = await api.get(statusEndpoint);
      setStatus(res.data);
    } catch (e) { /* non-fatal */ }
  }
  useEffect(() => { loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(uploadEndpoint, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage(`Uploaded (${Math.round(res.data.sizeBytes / 1024 / 1024)} MB).`);
      await loadStatus();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <Card title={title} icon={UploadCloud} accent={accent}>
      <p className="help-text">{description}</p>
      {status && (
        <p className="help-text">
          Currently loaded: {status.loaded ? 'yes' : 'no'}
          {status.sizeBytes ? ` (${Math.round(status.sizeBytes / 1024 / 1024)} MB on disk)` : ''}
        </p>
      )}
      <input type="file" accept=".ndjson,.json,.txt" onChange={handleUpload} disabled={uploading} />
      {message && <div className="help-text" style={{ marginTop: 6 }}>{message}</div>}
    </Card>
  );
}

export default function AutoAssignPage() {
  const [districtIds, setDistrictIds] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [tatDays, setTatDays] = useState(10);
  const [minCases, setMinCases] = useState(40);
  const [p1CutoffDays, setP1CutoffDays] = useState(5);
  const [p2CutoffDays, setP2CutoffDays] = useState(7);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapView, setMapView] = useState('polygon'); // 'polygon' | 'point'
  const [surveyors, setSurveyors] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]); // selected perSurveyor rows
  const [transferTarget, setTransferTarget] = useState('');
  const [transferMessage, setTransferMessage] = useState(null);
  const [transferring, setTransferring] = useState(false);
  const [districtGeo, setDistrictGeo] = useState(null);

  useEffect(() => {
    api.get('/users').then((res) => setSurveyors(res.data.users.filter((u) => u.role_key === 'surveyor'))).catch(() => {});
  }, []);
  const surveyorName = (id) => surveyors.find((s) => s.id === id)?.name || id;

  function payload() {
    return {
      districtIds: districtIds.split(',').map((s) => s.trim()).filter(Boolean),
      reportDate,
      tatDays: Number(tatDays),
      minCases: Number(minCases),
      p1CutoffDays: Number(p1CutoffDays),
      p2CutoffDays: Number(p2CutoffDays),
    };
  }

  async function fetchDistrictGeo(ids) {
    try {
      const idsStr = ids.join(',');
      const res = await api.get(`/districts/boundaries${idsStr ? `?ids=${encodeURIComponent(idsStr)}` : ''}`);
      setDistrictGeo(res.data);
    } catch {
      // non-fatal — district outlines are optional
    }
  }

  async function run(mode) {
    setError(null);
    setLoading(true);
    try {
      const p = payload();
      const res = await api.post(`/auto-assign/${mode}`, p);
      setResult({ mode, ...res.data });
      if (p.districtIds.length > 0) fetchDistrictGeo(p.districtIds);
    } catch (err) {
      setError(err.response?.data?.error || `Auto-assign ${mode} failed`);
    } finally {
      setLoading(false);
    }
  }

  async function downloadExcel() {
    setError(null);
    try {
      const res = await api.post('/auto-assign/export', payload(), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auto-assign-${reportDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || 'Excel export failed');
    }
  }

  async function handleBulkTransfer() {
    if (!transferTarget || selectedRows.length === 0) return;
    setTransferring(true);
    setTransferMessage(null);
    try {
      const farmerIds = selectedRows.flatMap((s) => result?.assignedFarmerIdsBySurveyor?.[s.surveyorId] || []);
      const res = await api.post('/assignments/bulk-transfer', { farmerIds, toUserId: transferTarget });
      setTransferMessage(`Transferred ${res.data.transferred.length} case(s)${res.data.blocked.length ? `, ${res.data.blocked.length} blocked (unresolved emergency incident)` : ''}.`);
      setSelectedRows([]);
    } catch (err) {
      setTransferMessage(err.response?.data?.error || 'Bulk transfer failed');
    } finally {
      setTransferring(false);
    }
  }

  const surveyorIds = result?.perSurveyor?.map((s) => s.surveyorId) || [];
  const colorFor = (surveyorId) => colorForSurveyor(surveyorId, surveyorIds.indexOf(surveyorId));
  const markers = result?.villageMarkers || [];
  const polygons = result?.villagePolygons || [];
  const haveAnyGeo = markers.length > 0 || polygons.length > 0;
  const mapCenter = markers.length
    ? [markers.reduce((s, m) => s + m.lat, 0) / markers.length, markers.reduce((s, m) => s + m.lon, 0) / markers.length]
    : [22.9, 79.0]; // center of India fallback

  // react-leaflet Polygon expects [lat, lon] pairs; our stored geometry is GeoJSON
  // [lon, lat]. A MultiPolygon's outer array is one ring-set per part; Polygon's own
  // positions prop accepts an array of rings directly (holes as subsequent rings),
  // which is also how react-leaflet renders a MultiPolygon's multiple parts (array of
  // ring-arrays) — same shape, so one conversion covers both.
  function geometryToLeafletPositions(geometry) {
    if (!geometry) return [];
    const toLatLon = (ring) => ring.map(([lon, lat]) => [lat, lon]);
    if (geometry.type === 'Polygon') return geometry.coordinates.map(toLatLon);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map(toLatLon));
    return [];
  }

  return (
    <div>
      <Card title="Auto-Assign (village-based)" icon={Workflow} accent="navy">
        <p className="help-text">
          One village is always given whole to a single surveyor. Preview is a dry run —
          nothing is written until you Commit.
        </p>
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <label>District ID(s), comma-separated
            <input value={districtIds} onChange={(e) => setDistrictIds(e.target.value)} placeholder="D1,D2" />
          </label>
          <label>Report date
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </label>
          <label>TAT days
            <input type="number" value={tatDays} onChange={(e) => setTatDays(e.target.value)} />
          </label>
          <label>Min cases/surveyor
            <input type="number" value={minCases} onChange={(e) => setMinCases(e.target.value)} />
          </label>
          <label>P1 cutoff days
            <input type="number" value={p1CutoffDays} onChange={(e) => setP1CutoffDays(e.target.value)} />
          </label>
          <label>P2 cutoff days
            <input type="number" value={p2CutoffDays} onChange={(e) => setP2CutoffDays(e.target.value)} />
          </label>
        </div>
        <div className="flex-row" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" disabled={loading} onClick={() => run('preview')}>Preview</button>
          <button type="button" className="primary" disabled={loading || !result || result.mode !== 'preview'}
            onClick={() => run('commit')}>
            Commit Assignment
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={downloadExcel}>Download Excel</button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </Card>

      <DataUploadCard
        title="Village Centroid Data"
        description="Upload the ~150MB village centroid file once per backend deploy for map/fuzzy-match features. District outlines are auto-loaded from git whenever you run Preview."
        statusEndpoint="/village-data/status"
        uploadEndpoint="/village-data/upload"
        accent="teal"
      />
      <DataUploadCard
        title="Village Boundary Polygon Data"
        description="Upload the ~200MB simplified village boundary polygon file once per backend deploy for village-outline map view. District outlines come from git automatically."
        statusEndpoint="/boundaries/status"
        uploadEndpoint="/boundaries/upload"
        accent="sky"
      />

      {result && (
        <>
          <div className="stat-grid">
            <div className="stat-card" style={{ '--accent': 'var(--navy)' }}>
              <span className="stat-icon"><Database size={13} /></span>
              <span className="stat-label">Total Cases</span>
              <span className="stat-value">{result.totalCases}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p3-dot)' }}>
              <span className="stat-icon"><Workflow size={13} /></span>
              <span className="stat-label">Assigned</span>
              <span className="stat-value">{result.totalAssigned}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p1-dot)' }}>
              <span className="stat-label">Unassigned</span>
              <span className="stat-value">{result.totalUnassigned}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--amber)' }}>
              <span className="stat-label">Under Min Caseload</span>
              <span className="stat-value">{result.underMinimumSurveyors?.length || 0}</span>
            </div>
          </div>

          <Card
            title={`${result.mode === 'commit' ? 'Committed' : 'Preview'}: per-surveyor breakdown`}
            icon={Workflow}
            accent="violet"
          >
            <p className="help-text">
              Select one or more surveyors' rows (checkboxes), then use "Transfer
              selected to..." below to move all of their cases from this run to a
              different surveyor in one bulk operation — useful for post-hoc
              rebalancing, surveyor turnover, or leave coverage.
            </p>
            <DataGrid
              selectable
              onSelectionChanged={setSelectedRows}
              searchKeys={['surveyorId']}
              columns={[
                { key: 'surveyorId', label: 'Surveyor', sortable: true, render: (s) => (
                  <span><span className="legend-dot" style={{ background: colorFor(s.surveyorId) }} />{surveyorName(s.surveyorId)}</span>
                ) },
                { key: 'districtCount', label: 'Districts', sortable: true },
                { key: 'villageCount', label: 'Villages', sortable: true },
                { key: 'totalCases', label: 'Total', sortable: true },
                { key: 'p1', label: 'P1', sortable: true, render: (s) => <span className="badge priority-p1">{s.p1}</span> },
                { key: 'p2', label: 'P2', sortable: true, render: (s) => <span className="badge priority-p2">{s.p2}</span> },
                { key: 'p3', label: 'P3', sortable: true, render: (s) => <span className="badge priority-p3">{s.p3}</span> },
                { key: 'underMinimum', label: 'Under min?', sortable: false, render: (s) => (s.underMinimum ? <span className="badge denied">Yes</span> : '') },
              ]}
              rows={result.perSurveyor || []}
              emptyMessage="No surveyors matched."
              height={320}
            />
            <div className="flex-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <span className="help-text">{selectedRows.length} surveyor(s) selected</span>
              <select value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)} style={{ width: 220 }}>
                <option value="">Transfer selected to...</option>
                {surveyors.filter((s) => !selectedRows.some((r) => r.surveyorId === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button type="button" className="primary" disabled={transferring || selectedRows.length === 0 || !transferTarget}
                onClick={handleBulkTransfer}>
                Transfer
              </button>
            </div>
            {transferMessage && <div className="help-text" style={{ marginTop: 6 }}>{transferMessage}</div>}
          </Card>

          <Card
            title="Geographic spread"
            icon={MapIcon}
            accent="teal"
            actions={(
              <div className="flex-row" style={{ gap: 6 }}>
                <button type="button" className={mapView === 'polygon' ? 'primary' : 'secondary'} onClick={() => setMapView('polygon')}>
                  Village outlines
                </button>
                <button type="button" className={mapView === 'point' ? 'primary' : 'secondary'} onClick={() => setMapView('point')}>
                  Points
                </button>
              </div>
            )}
          >
            <p className="help-text">
              Only the villages touched by this run are plotted
              ({mapView === 'polygon' ? polygons.length : markers.length} village{(mapView === 'polygon' ? polygons.length : markers.length) === 1 ? '' : 's'}) —
              colored by assigned surveyor.
              {mapView === 'polygon' && polygons.length === 0 && markers.length > 0 && (
                ' No boundary polygons matched (only centroid points) — try the Points view, or upload the boundary file above.'
              )}
            </p>
            {!haveAnyGeo ? (
              <p className="help-text">
                No village geometry matched for this run (either no cases were assigned,
                or neither the centroid nor boundary dataset is loaded on this backend —
                see ROADMAP.md).
              </p>
            ) : (
              <>
                <div style={{ height: 420, borderRadius: 8, overflow: 'hidden' }}>
                  <MapContainer center={mapCenter} zoom={7} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                      attribution='&copy; OpenStreetMap contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {/* District boundary outlines from git GeoJSON — auto-fetched */}
                    {districtGeo?.features?.map((f, i) => (
                      <Polygon
                        key={`dist-${i}`}
                        positions={geometryToLeafletPositions(f.geometry)}
                        pathOptions={{ color: '#0f2a4a', fillColor: 'transparent', weight: 2, dashArray: '5,4', opacity: 0.6 }}
                      >
                        <Popup><strong>District: {f.properties?.district || f.properties?.District || 'Unknown'}</strong></Popup>
                      </Polygon>
                    ))}
                    {mapView === 'polygon' && polygons.map((p, i) => (
                      <Polygon
                        key={i}
                        positions={geometryToLeafletPositions(p.geometry)}
                        pathOptions={{ color: colorFor(p.surveyorId), fillColor: colorFor(p.surveyorId), fillOpacity: 0.45, weight: 1.5 }}
                      >
                        <Popup>
                          <strong>{p.villageName}</strong><br />
                          Surveyor: {surveyorName(p.surveyorId)}<br />
                          Cases: {p.caseCount}
                        </Popup>
                      </Polygon>
                    ))}
                    {mapView === 'point' && markers.map((m, i) => (
                      <CircleMarker
                        key={i}
                        center={[m.lat, m.lon]}
                        radius={6 + Math.min(10, Math.log2(m.caseCount + 1) * 2)}
                        pathOptions={{ color: colorFor(m.surveyorId), fillColor: colorFor(m.surveyorId), fillOpacity: 0.7 }}
                      >
                        <Popup>
                          <strong>{m.villageName}</strong><br />
                          Surveyor: {surveyorName(m.surveyorId)}<br />
                          Cases: {m.caseCount}
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                <div className="map-legend">
                  {surveyorIds.map((id) => (
                    <span key={id}><span className="legend-dot" style={{ background: colorFor(id) }} />{surveyorName(id)}</span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
