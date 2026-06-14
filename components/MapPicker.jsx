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
      markerRef.current.on('dragend', e => { const ll = e.target.getLatLng(); setLocation(ll.lat, ll.lng); });
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

  const setLocation = async (lat, lng) => {
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else if (mapRef.current && window.L) {
      markerRef.current = window.L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', e => {
        const ll = e.target.getLatLng();
        setLocation(ll.lat, ll.lng);
      });
    }
    if (mapRef.current) mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    setResolving(true);
    const address = await reverseGeocode(lat, lng);
    setResolving(false);
    onChange && onChange({ lat, lng, address });
  };

  // Lazy-load Leaflet (CSS + JS) the first time a map is actually shown.
  // Keeps it out of the initial page load for the ~majority who never open it.
  const ensureLeaflet = () => {
    if (window.L) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      const s = document.createElement('script');
      s.id = 'leaflet-js';
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.head.appendChild(s);
    }
  };

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
      mapRef.current.on('click', e => setLocation(e.latlng.lat, e.latlng.lng));
      if (value) {
        markerRef.current = window.L.marker([value.lat, value.lng], { draggable: true }).addTo(mapRef.current);
        markerRef.current.on('dragend', e => {
          const ll = e.target.getLatLng();
          setLocation(ll.lat, ll.lng);
        });
      }
    };
    init();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; } };
  }, []);

  const useMyLocation = () => {
    setGeoErr('');
    if (!navigator.geolocation) { setGeoErr('Geolocation not supported by this browser.'); return; }
    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setResolving(false); setLocation(pos.coords.latitude, pos.coords.longitude); },
      err => { setResolving(false); setGeoErr(err.code === 1 ? 'Permission denied. Please allow location access.' : 'Could not get your location.'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
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
    // Reuse MapPicker's Leaflet loader by triggering the same CDN injection
    const ensure = () => {
      if (window.L) return;
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css'; link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      if (!document.getElementById('leaflet-js')) {
        const s = document.createElement('script');
        s.id = 'leaflet-js'; s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(s);
      }
    };
    ensure();
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

Object.assign(window, { MapPicker, DestinationMap });
