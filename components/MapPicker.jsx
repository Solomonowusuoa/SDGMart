// MapPicker — Leaflet/OpenStreetMap location picker.
// Props: value={lat,lng}|null, onChange({lat,lng,address}), height=240, allowGeolocate=true
// Uses OpenStreetMap tiles (free, no API key) and Nominatim for reverse geocoding.
const MapPicker = ({ value, onChange, height = 240, allowGeolocate = true, defaultCenter }) => {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markerRef = React.useRef(null);
  const [resolving, setResolving] = React.useState(false);
  const [geoErr, setGeoErr] = React.useState('');

  // Tamale, Ghana as default center
  const TAMALE = { lat: 9.4034, lng: -0.8424 };
  const center = value || defaultCenter || TAMALE;

  // Reverse geocode lat/lng → human address (Nominatim is free, no key, but
  // please respect their fair-use policy — we only call on user action).
  const reverseGeocode = async (lat, lng) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`);
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

  // Init map once Leaflet is ready
  React.useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const init = () => {
      if (cancelled) return;
      if (!window.L) { setTimeout(init, 100); return; }
      if (mapRef.current) return;
      mapRef.current = window.L.map(containerRef.current).setView([center.lat, center.lng], value ? 16 : 13);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
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

Object.assign(window, { MapPicker });
