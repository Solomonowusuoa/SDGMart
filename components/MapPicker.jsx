// ── Map provider helpers ─────────────────────────────────────────────────
// Uses LocationIQ when window.LOCATIONIQ_KEY is set (more generous limits,
// OSM-based data so results stay familiar), otherwise falls back to the free
// public OpenStreetMap tiles + Nominatim. This makes the switch a no-op until
// a key is added — no breakage if it's missing.
function sdgMapTileLayer(L) {
  // Always use OpenStreetMap raster tiles for the visible map — they render
  // reliably and are fine for our low tile volume. LocationIQ is used only for
  // geocoding/search (see sdgGeocoder), which is the part with quota concerns.
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  });
}
// Returns { reverse(lat,lng), search(q, paramStr) } URL builders for the active provider
function sdgGeocoder() {
  const key = (typeof window !== 'undefined' && window.LOCATIONIQ_KEY) || '';
  if (key) {
    return {
      reverse: (lat, lng) => `https://us1.locationiq.com/v1/reverse?key=${key}&lat=${lat}&lon=${lng}&format=json`,
      search: (q, params) => `https://us1.locationiq.com/v1/search?key=${key}&q=${encodeURIComponent(q)}&format=json&${params}`,
    };
  }
  return {
    reverse: (lat, lng) => `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
    search: (q, params) => `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&${params}`,
  };
}

// ── Leaflet loader ────────────────────────────────────────────────────────
// ONE loader, shared by every map on the site.
//
// This used to be copy-pasted per component, and the copies were not in the
// same places as the maps. The tracking page's map only ever checked
// `window.L` and gave up if it was missing — it never injected anything — so it
// drew only for someone who had already opened the checkout picker earlier in
// the same page session. Arriving cold, which is how that page is actually
// reached (a push notification, a shared tracking link), left `window.L`
// undefined and the customer got an empty bordered box. The map was removed
// rather than fixed.
//
// So: any map component calls this and waits on the promise. Nothing assumes
// Leaflet is already there, and there is no second copy to drift.
let _leafletPromise = null;
function ensureLeafletReady({ timeoutMs = 12000 } = {}) {
  if (typeof window !== 'undefined' && window.L) return Promise.resolve(true);
  if (_leafletPromise) return _leafletPromise;

  _leafletPromise = new Promise((resolve) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js');
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.head.appendChild(script);
    }

    // Resolve on the real load event, but keep polling too: the tag may already
    // have been in the document from an earlier mount, in which case its load
    // event has been and gone and a listener added now would never fire.
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(bail);
      // A failed load must not be cached as a permanent "no". Tamale mobile
      // connections drop; the next mount should get a fresh attempt.
      if (!ok) _leafletPromise = null;
      resolve(ok);
    };
    const poll = setInterval(() => { if (window.L) finish(true); }, 60);
    const bail = setTimeout(() => finish(!!window.L), timeoutMs);
    script.addEventListener('load', () => finish(!!window.L));
    script.addEventListener('error', () => finish(false));
    if (window.L) finish(true);
  });
  return _leafletPromise;
}

// MapPicker — Leaflet location picker (LocationIQ or OpenStreetMap).
// Props: value={lat,lng}|null, onChange({lat,lng,address}), height=240, allowGeolocate=true
const MapPicker = ({ value, onChange, height = 240, allowGeolocate = true, defaultCenter }) => {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markerRef = React.useRef(null);
  const [resolving, setResolving] = React.useState(false);
  const [geoErr, setGeoErr] = React.useState('');

  // Tamale, Ghana as default center
  const TAMALE = { lat: 9.4034, lng: -0.8424 };
  const center = value || defaultCenter || TAMALE;
  // Roughly bounds Tamale metro for biased searches (lon_min, lat_min, lon_max, lat_max)
  const TAMALE_VIEWBOX = '-0.95,9.30,-0.70,9.55';

  // Place search
  const [search, setSearch] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [searching, setSearching] = React.useState(false);
  const [showResults, setShowResults] = React.useState(false);
  const searchTimerRef = React.useRef(null);

  // Debounced search on the user's query — biased to Tamale, restricted to Ghana
  React.useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!search.trim() || search.trim().length < 2) { setResults([]); setShowResults(false); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const geo = sdgGeocoder();
        const r = await fetch(geo.search(search, `limit=8&countrycodes=gh&viewbox=${TAMALE_VIEWBOX}&bounded=1&addressdetails=1`));
        const d = await r.json();
        // If Tamale-only returns nothing, fall back to all-Ghana so common landmarks still resolve
        let list = Array.isArray(d) ? d : [];
        if (list.length === 0) {
          const r2 = await fetch(geo.search(search + ' Tamale', `limit=8&countrycodes=gh&addressdetails=1`));
          const d2 = await r2.json();
          list = Array.isArray(d2) ? d2 : [];
        }
        setResults(list);
        setShowResults(true);
      } catch (_) { setResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => searchTimerRef.current && clearTimeout(searchTimerRef.current);
  }, [search]);

  const pickResult = (r) => {
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    setSearch(r.display_name.split(',').slice(0, 2).join(','));
    setShowResults(false);
    // Skip a fresh reverse-geocode round-trip — Nominatim already gave us a name
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else if (mapRef.current && window.L) {
      markerRef.current = window.L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', e => { const ll = e.target.getLatLng(); setLocation(ll.lat, ll.lng, { source: 'manual' }); });
    }
    if (mapRef.current) mapRef.current.setView([lat, lng], 17);
    onChange && onChange({ lat, lng, address: r.display_name });
  };

  // Reverse geocode lat/lng → human address via the active provider.
  const reverseGeocode = async (lat, lng) => {
    try {
      const r = await fetch(sdgGeocoder().reverse(lat, lng));
      const d = await r.json();
      return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch (_) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  };

  // metres, from the device; null when the pin was placed by hand or by search.
  const [accuracy, setAccuracy] = React.useState(null);
  const [source, setSource] = React.useState(null); // 'gps' | 'network' | 'manual' | 'search'
  const setLocation = async (lat, lng, meta) => {
    const acc = meta && meta.accuracy != null ? Math.round(meta.accuracy) : null;
    const src = (meta && meta.source) || 'manual';
    setAccuracy(acc);
    setSource(src);
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else if (mapRef.current && window.L) {
      markerRef.current = window.L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', e => {
        const ll = e.target.getLatLng();
        setLocation(ll.lat, ll.lng, { source: 'manual' });
      });
    }
    if (mapRef.current) mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    setResolving(true);
    const address = await reverseGeocode(lat, lng);
    setResolving(false);
    onChange && onChange({ lat, lng, address, accuracy: acc, source: src });
  };

  // Lazy-load Leaflet (CSS + JS) the first time a map is actually shown.
  // Keeps it out of the initial page load for the ~majority who never open it.
  // The injection itself lives in ensureLeafletReady above — this component
  // keeps its existing poll-until-ready init below, so behaviour is unchanged.
  const ensureLeaflet = () => { ensureLeafletReady(); };

  // Init map once Leaflet is ready
  React.useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    ensureLeaflet();
    const init = () => {
      if (cancelled) return;
      if (!window.L) { setTimeout(init, 100); return; }
      if (mapRef.current) return;
      mapRef.current = window.L.map(containerRef.current).setView([center.lat, center.lng], value ? 16 : 13);
      sdgMapTileLayer(window.L).addTo(mapRef.current);
      mapRef.current.on('click', e => setLocation(e.latlng.lat, e.latlng.lng, { source: 'manual' }));
      if (value) {
        markerRef.current = window.L.marker([value.lat, value.lng], { draggable: true }).addTo(mapRef.current);
        markerRef.current.on('dragend', e => {
          const ll = e.target.getLatLng();
          setLocation(ll.lat, ll.lng, { source: 'search' });
        });
      }
    };
    init();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; } };
  }, []);

  const useMyLocation = () => {
    setGeoErr('');
    if (!navigator.geolocation) {
      setGeoErr("Your browser can't share location. Search a landmark above, or drag the pin on the map.");
      return;
    }
    setResolving(true);

    const onOk = (src) => (pos) => {
      setResolving(false);
      setLocation(pos.coords.latitude, pos.coords.longitude, { accuracy: pos.coords.accuracy, source: src });
    };
    // Actionable messages: each tells the customer how to fix it, and that they
    // can always fall back to the search box or dragging the pin.
    const DENIED = "Location is blocked. Tap the 🔒 (or ⓘ) icon next to the web address, allow Location, then try again — or search a landmark above / drag the pin.";
    const OFF = "Couldn't get your location — Location/GPS may be off. Turn it on in your phone settings (and disable battery-saver), then try again — or search a landmark above / drag the pin.";

    // Two-step: first ask for a precise GPS fix (good for delivery), but if that
    // times out or is unavailable (common indoors), immediately retry with the
    // faster network/Wi-Fi method so the customer still gets a pin to drag.
    navigator.geolocation.getCurrentPosition(
      onOk('gps'),
      (err1) => {
        if (err1.code === 1) { setResolving(false); setGeoErr(DENIED); return; } // permission — retry won't help
        navigator.geolocation.getCurrentPosition(
          onOk('network'),
          (err2) => { setResolving(false); setGeoErr(err2.code === 1 ? DENIED : OFF); },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  return (
    <div>
      {/* Search box for landmarks (e.g. "Tamale Teaching Hospital") */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => results.length && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          placeholder="🔎 Search a place (e.g. Tamale Teaching Hospital, Aliu Mahama Stadium)"
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 13, outline: 'none', background: 'var(--white)' }} />
        {searching && <span style={{ position: 'absolute', right: 12, top: 11, fontSize: 11, color: 'var(--warm-gray)' }}>searching…</span>}
        {showResults && results.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--cream-dark)', borderRadius: 10, marginTop: 4, maxHeight: 260, overflowY: 'auto', zIndex: 1000, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
            {results.map((r, i) => (
              <button key={r.place_id || i} type="button" onMouseDown={() => pickResult(r)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--cream)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ fontWeight: 600 }}>{r.display_name.split(',').slice(0, 2).join(',')}</div>
                <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: 2 }}>{r.display_name.split(',').slice(2).join(',').trim() || (r.type || '')}</div>
              </button>
            ))}
          </div>
        )}
        {showResults && !searching && search.trim().length >= 2 && results.length === 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--cream-dark)', borderRadius: 10, marginTop: 4, padding: 12, fontSize: 12, color: 'var(--warm-gray)', zIndex: 1000 }}>
            No matches. Try a different spelling, or click the map to drop a pin.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {allowGeolocate && (
          <button type="button" onClick={useMyLocation} disabled={resolving}
            style={{
              background: 'var(--sage)', color: '#fff', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: resolving ? 'wait' : 'pointer',
              opacity: resolving ? .6 : 1, border: 'none',
            }}>
            📍 Use my current location
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--warm-gray)' }}>or click/drag the pin on the map</span>
      </div>
      {geoErr && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginBottom: 6 }}>{geoErr}</div>}
      {!geoErr && accuracy != null && accuracy > 100 && (
        <div style={{ fontSize: 11, color: '#7A5A00', background: '#FFF4E0', padding: '6px 9px', marginBottom: 6, lineHeight: 1.45 }}>
          This pin is only accurate to about {accuracy >= 1000 ? (accuracy / 1000).toFixed(1) + ' km' : accuracy + ' m'} — your phone
          used the network rather than GPS. <strong>Drag the pin</strong> to your exact gate so the rider isn't left guessing,
          or <strong>step outside</strong> and tap “Use my current location” again — GPS needs a clear view of the sky, so it
          rarely gets a good fix indoors.
        </div>
      )}
      {!geoErr && accuracy != null && accuracy <= 100 && source === 'gps' && (
        <div style={{ fontSize: 11, color: 'var(--rd-muted)', marginBottom: 6 }}>
          Pin accurate to about {accuracy} m. Drag it if it isn't quite right.
        </div>
      )}
      <div ref={containerRef} style={{ height, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--cream-dark)' }} />
      {value && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warm-gray)' }}>
          <div style={{ fontWeight: 600, color: 'var(--warm-black)' }}>📌 {value.address || 'Pinned'}</div>
          <div style={{ marginTop: 2, fontSize: 11 }}>{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</div>
        </div>
      )}
    </div>
  );
};

// DestinationMap — read-only mini map with a single pin. Used by riders to see
// where a delivery is. Lazy-loads Leaflet like MapPicker.
const DestinationMap = ({ location, height = 180 }) => {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || !location || location.lat == null) return;
    let cancelled = false;
    ensureLeafletReady();
    const init = () => {
      if (cancelled) return;
      if (!window.L) { setTimeout(init, 100); return; }
      if (mapRef.current) return;
      mapRef.current = window.L.map(ref.current, { zoomControl: true, attributionControl: false })
        .setView([location.lat, location.lng], 16);
      sdgMapTileLayer(window.L).addTo(mapRef.current);
      window.L.marker([location.lat, location.lng]).addTo(mapRef.current);
      setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 200);
    };
    init();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [location && location.lat, location && location.lng]);
  if (!location || location.lat == null) return null;
  return <div ref={ref} style={{ height, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--cream-dark)' }} />;
};

// ── Live rider tracking map ───────────────────────────────────────────────
// The customer's view while an order is on its way: their destination, and the
// rider moving towards it.
//
// Three things this gets right that the removed version did not:
//
//   1. COLD LOAD. It waits on ensureLeafletReady() rather than testing
//      `window.L` and giving up. This page is normally reached from a push
//      notification or a shared link, with no map ever opened before it.
//   2. IT DOES NOT RE-CREATE ITSELF. The map is built once; later polls only
//      move the rider marker. Rebuilding every 25s would throw away the
//      customer's pan and zoom and flash the tiles each time.
//   3. IT NEVER RENDERS AN EMPTY BOX. If Leaflet cannot load, or there is
//      nothing to plot, it renders nothing at all and the page falls back to
//      the order summary — which is what made the old empty bordered box such
//      a bad failure.
const LiveTrackMap = ({ rider, destination, height = 220, caption = '', statusLabel = '' }) => {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const riderMarkerRef = React.useRef(null);
  const [failed, setFailed] = React.useState(false);

  const hasRider = !!(rider && rider.lat != null && rider.lng != null);
  const hasDest = !!(destination && destination.lat != null && destination.lng != null);

  // The async loader resolves a tick or two after mount, by which time props
  // may have moved on. Read them through a ref so the map is built from what is
  // current, not from the render that happened to kick the load off.
  const latest = React.useRef({ rider, destination });
  latest.current = { rider, destination };

  React.useEffect(() => {
    if (!ref.current || (!hasRider && !hasDest)) return;
    let cancelled = false;
    ensureLeafletReady().then((ok) => {
      if (cancelled) return;
      if (!ok) { setFailed(true); return; }
      if (mapRef.current || !ref.current) return;
      const L = window.L;
      const { rider: r, destination: d } = latest.current;
      const map = L.map(ref.current, { zoomControl: true, attributionControl: false });
      mapRef.current = map;
      sdgMapTileLayer(L).addTo(map);

      const pts = [];
      if (d && d.lat != null) {
        L.marker([d.lat, d.lng], {
          icon: L.divIcon({
            className: '', iconSize: [18, 18], iconAnchor: [9, 9],
            html: '<div style="width:14px;height:14px;background:#1a1a1a;border:3px solid #fff;box-shadow:0 0 0 1px #1a1a1a"></div>',
          }),
        }).addTo(map);
        pts.push([d.lat, d.lng]);
      }
      if (r && r.lat != null) {
        riderMarkerRef.current = L.marker([r.lat, r.lng], {
          icon: L.divIcon({
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: '<div style="width:16px;height:16px;border-radius:50%;background:#c9591f;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>',
          }),
        }).addTo(map);
        pts.push([r.lat, r.lng]);
      }

      // Frame both on the FIRST draw only. Re-fitting on every poll would yank
      // the view back each time the customer tried to look around.
      if (pts.length > 1) map.fitBounds(pts, { padding: [34, 34], maxZoom: 16 });
      else if (pts.length === 1) map.setView(pts[0], 15);

      // Leaflet measures its container on creation; inside a panel that is
      // still settling that measurement is wrong and the tiles come out grey.
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 200);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; riderMarkerRef.current = null; }
    };
    // Built once. Movement is handled by the effect below.
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Move the rider, do not rebuild the map.
  React.useEffect(() => {
    if (!mapRef.current || !riderMarkerRef.current || !hasRider) return;
    try { riderMarkerRef.current.setLatLng([rider.lat, rider.lng]); } catch (_) {}
  }, [hasRider, rider && rider.lat, rider && rider.lng]);

  // Caption included, deliberately. Held by the page instead, it outlived a
  // failed load and labelled a map that had not rendered — "Yakubu's position,
  // updated as they travel. LIVE" sitting above no map at all.
  if ((!hasRider && !hasDest) || failed) return null;
  return (
    <div>
      <div ref={ref} style={{ height, width: '100%', border: '1px solid var(--rule-2)', background: 'var(--surface-warm)' }} />
      {(caption || statusLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '8px 2px 0' }}>
          <span style={{ fontSize: 11.5, color: 'var(--rd-muted)' }}>{caption}</span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: statusLabel === 'Live' ? 'var(--accent)' : 'var(--rd-faint)' }}>{statusLabel}</span>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { MapPicker, DestinationMap, LiveTrackMap, ensureLeafletReady });
