// Global hooks — loaded before any component, available on window

function useMobile(breakpoint) {
  breakpoint = breakpoint || 768;
  const [mobile, setMobile] = React.useState(
    typeof window !== 'undefined' && window.innerWidth <= breakpoint
  );
  React.useEffect(() => {
    const check = () => setMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return mobile;
}

// Auth-aware fetch wrapper. Reads the session token from sessionStorage
// (App.jsx writes it there alongside the user object) and adds it as a
// Bearer header on every request. Use this everywhere instead of bare fetch
// when calling /api/* endpoints that require authentication.
function apiFetch(url, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  try {
    const raw = sessionStorage.getItem('sdgmart_user');
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.token) headers.set('Authorization', 'Bearer ' + obj.token);
    }
  } catch (_) {}
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, Object.assign({}, opts, { headers }));
}

Object.assign(window, { useMobile, apiFetch });
