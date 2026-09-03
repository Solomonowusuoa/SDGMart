// Load .env from THIS file's directory (not the cwd), so the server works
// regardless of where it's launched from (e.g. preview tools that run from a
// different working directory). In production (Render) env vars come from the
// platform dashboard, so a missing .env is a harmless no-op.
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (_) {}
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const db = require('./database');

// ── Sentry (optional error monitoring) — only active when SENTRY_DSN is set.
// No-op otherwise, so local/dev runs need nothing. On Render, create a Sentry
// project, set SENTRY_DSN in the dashboard, and the errors below forward there.
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0,
      // Sentry attaches the request URL itself, so scrubbing our own `extra`
      // is not enough — strip query strings on the way out too (audit E-08).
      beforeSend(event) {
        try {
          if (event.request && event.request.url) event.request.url = String(event.request.url).split('?')[0];
          if (event.request && event.request.query_string) delete event.request.query_string;
        } catch (_) {}
        return event;
      },
    });
    console.log('🛡  Sentry error monitoring enabled');
  } catch (e) { console.warn('Sentry init skipped:', e.message); Sentry = null; }
}

// ── Resend (transactional email) ─────────────────────────────────────────
// RESEND_API_KEY = your key from https://resend.com/api-keys
// RESEND_FROM_EMAIL = sender address (default: onboarding@resend.dev for
//   immediate use without a custom domain. Once you verify your own domain
//   in Resend, set this to e.g. 'noreply@sdgmart.com').
// ── Paystack (online card + mobile money) ────────────────────────────────
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
// Node's fetch has no default timeout. A Paystack instance that stops responding
// rather than refusing would hang the request forever, and on a single process
// those accumulate until nothing is served — a slow dependency becoming a full
// outage. 15s is generous for their API and far short of a customer giving up.
const PAYSTACK_TIMEOUT_MS = Number(process.env.PAYSTACK_TIMEOUT_MS || 15000);
async function paystackApi(path, method = 'GET', body) {
  try {
    const r = await fetch('https://api.paystack.co' + path, {
      method,
      headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    });
    return r.json();
  } catch (e) {
    // Surface as a clear failure rather than an undefined that every caller
    // then has to guess about.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new Error(timedOut
      ? 'Payment provider did not respond in time'
      : 'Could not reach the payment provider: ' + (e && e.message ? e.message : 'unknown error'));
  }
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SDGMart <onboarding@resend.dev>';
let _resend = null;
function getResend() {
  if (!RESEND_API_KEY) return null;
  if (_resend) return _resend;
  try {
    const { Resend } = require('resend');
    _resend = new Resend(RESEND_API_KEY);
    return _resend;
  } catch (_) { return null; }
}
// Bound any promise so a hung dependency cannot hold a request open forever.
function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function sendEmail({ to, subject, html, text }) {
  const client = getResend();
  if (!client) return { skipped: true, reason: 'RESEND_API_KEY not set' };
  try {
    const r = await withTimeout(
      client.emails.send({ from: RESEND_FROM_EMAIL, to, subject, html, text }),
      15000, 'email send');
    recordMailResult(true);
    return { ok: true, id: r.data && r.data.id };
  } catch (e) {
    // Every caller used to ignore this. Resend being down, over quota (the
    // free tier is 100/day) or rejecting an address all looked identical to
    // the user — and password reset is the only recovery path for an account
    // without Google sign-in (audit E-09).
    recordMailResult(false);
    console.error('EMAIL SEND FAILED to ' + String(to).replace(/(.).*(@.*)/, '$1***$2') + ':', e.message);
    if (mailDegraded()) {
      alertAdmins('mail-down', 'Email sending is failing',
        'Password resets and confirmations are not going out. Check Resend (quota is 100/day on the free tier).');
    }
    return { error: e.message };
  }
}

// Minimal on-brand wrapper for transactional emails — neutral, no images.
function emailLayout({ title, intro, cta, ctaUrl, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A;line-height:1.5">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px">
      <div style="font-weight:900;font-size:26px;letter-spacing:-.5px;margin-bottom:28px">SDGMart</div>
      <h1 style="font-size:22px;font-weight:700;margin:0 0 14px">${title}</h1>
      <p style="font-size:15px;color:#444;margin:0 0 24px">${intro}</p>
      ${cta && ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;font-size:14px">${cta}</a>
      <p style="font-size:12px;color:#888;margin:20px 0 0;word-break:break-all">Or copy this link: <br/>${ctaUrl}</p>` : ''}
      <hr style="border:none;border-top:1px solid #EEE;margin:36px 0 18px"/>
      <p style="font-size:12px;color:#888;margin:0">${footer || "SDGMart — Tamale's smart grocery service."}</p>
    </div>
  </body></html>`;
}

// Google OAuth client ID — set GOOGLE_CLIENT_ID to enable "Sign in with Google".
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let _googleClient = null;
function getGoogleClient() {
  if (!GOOGLE_CLIENT_ID) return null;
  if (_googleClient) return _googleClient;
  try {
    const { OAuth2Client } = require('google-auth-library');
    _googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
    return _googleClient;
  } catch (_) {
    console.warn('⚠️  google-auth-library not installed — Google sign-in disabled');
    return null;
  }
}

const app = express();
// Compress every response. The app bundle alone goes from 344 KB to ~76 KB
// gzipped. Cloudflare compresses proxied traffic today, but that is a setting
// outside this repo and does not cover the onrender.com origin.
app.use(compression());
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
// CORS locked to our known web origins. Same-origin app calls and
// server-to-server requests (no Origin header — curl, webhooks) are allowed.
const ALLOWED_ORIGINS = ['https://sdg-mart.com', 'https://www.sdg-mart.com', 'https://sdgmart.onrender.com'];
app.use(cors({
  origin(origin, cb) { cb(null, !origin || ALLOWED_ORIGINS.includes(origin)); },
}));

// ── Security headers (audit A-17) ────────────────────────────────────────
// Nothing set these before, so checkout and admin could be framed and driven
// by a clickjacking overlay. Hand-rolled rather than pulling in helmet: it is
// five headers we control exactly, and one less dependency on a 512MB dyno.
//
// The resource policy ships Report-Only first, as the audit recommended —
// the app loads React and Leaflet from unpkg, Paystack's inline checkout,
// Google Identity, Fonts and GTM, and enforcing a wrong list would break the
// shop. `frame-ancestors` is the one directive enforced immediately, because
// it is the actual clickjacking fix and cannot break a first-party page.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://js.paystack.co https://accounts.google.com https://www.googletagmanager.com",
  // accounts.google.com is here for the Google Sign-In button, which pulls its
  // own stylesheet (/gsi/style). It was already allowed in script-src,
  // connect-src and frame-src but not style-src, and it was the ONE thing still
  // reporting a violation on every page load — the last blocker to enforcing
  // this policy instead of merely reporting it.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org https://unpkg.com https://lh3.googleusercontent.com https://www.googletagmanager.com https://www.google.com",
  "connect-src 'self' https://*.supabase.co https://api.paystack.co https://us1.locationiq.com https://nominatim.openstreetmap.org https://accounts.google.com https://www.google-analytics.com",
  "frame-src https://js.paystack.co https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Paystack + Google open popups
  res.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.set('Content-Security-Policy-Report-Only', CSP_DIRECTIVES);
  // Render terminates TLS, so trust the proxy's protocol header.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
// Send the legacy Render host to the custom domain so old bookmarks, shared
// links, and home-screen installs land on sdg-mart.com. GET pages only:
// /healthz stays (UptimeRobot's keep-awake ping must hit Render directly) and
// /api/* stays (Paystack webhooks POST here; the installed-PWA's service
// worker on the onrender origin still needs its API).
app.use((req, res, next) => {
  if (req.hostname === 'sdgmart.onrender.com' && req.method === 'GET'
      && !req.path.startsWith('/api/') && req.path !== '/healthz') {
    return res.redirect(301, 'https://sdg-mart.com' + req.originalUrl);
  }
  next();
});
// Capture the raw body so we can verify the Paystack webhook signature.
app.use(express.json({ limit: '3mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// ── Session-based auth middleware ────────────────────────────────────────
async function authMiddleware(req, res, next) {
  let token = '';
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) token = req.headers['x-session-token'] || '';
  req.token = token;
  req.user = null;
  req.rider = null;
  if (token) {
    try {
      const sess = await db.sessions.get(token);
      if (sess) {
        if (sess.userType === 'rider') {
          const r = await db.riders.get(sess.userId);
          if (r) req.rider = { ...r, role: 'rider' };
          req.user = req.rider; // riders use the same `req.user.role` check pattern
        } else {
          const u = await db.users.get(sess.userId);
          if (u) req.user = u;
        }
      }
    } catch (e) {
      console.warn('auth lookup failed:', e.message);
    }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  // must_change_password was set but never enforced anywhere — it only ever
  // drove a prompt in the UI, so an admin left on the bootstrap password kept
  // full access indefinitely (audit A-16). Locking admin routes rather than
  // login leaves /api/auth/change-password reachable, which is how they fix it.
  if (req.user.mustChangePassword) {
    return res.status(403).json({ error: 'Change your password before using admin.', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
}
function riderOnly(req, res, next) {
  if (!req.user || req.user.role !== 'rider') return res.status(403).json({ error: 'Rider only' });
  next();
}
// Customer endpoints under /api/me/* must never run for riders — riders live in
// a separate table with their own ids, so a rider hitting /api/me/* would
// read or overwrite an unrelated customer's row.
function customerOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role === 'rider') return res.status(403).json({ error: 'Not available for riders' });
  next();
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Per-IP throttle for endpoints that accept anonymous writes (audit A-15).
// Ghanaian mobile networks put many real customers behind one carrier NAT
// address, so these ceilings are deliberately generous: they are sized to stop
// a script in a loop, not to police normal use. Anything stricter would lock
// out a whole neighbourhood on the same gateway.
function rateLimitIp(name, opts) {
  return (req, res, next) => {
    const rl = db.rateCheck(`${name}:${clientIp(req)}`, opts);
    if (!rl.allowed) {
      res.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Too many requests from this connection. Please wait a moment and try again.' });
    }
    next();
  };
}
const LIMIT_ORDERS   = { windowMs: 10 * 60 * 1000, max: 30,  blockMs: 10 * 60 * 1000 };
const LIMIT_PAYMENT  = { windowMs: 10 * 60 * 1000, max: 30,  blockMs: 10 * 60 * 1000 };
const LIMIT_SIGNUP   = { windowMs: 60 * 60 * 1000, max: 20,  blockMs: 30 * 60 * 1000 };
const LIMIT_TELEMETRY= { windowMs:  5 * 60 * 1000, max: 200, blockMs:  5 * 60 * 1000 };
const LIMIT_REQUESTS = { windowMs: 60 * 60 * 1000, max: 20,  blockMs: 30 * 60 * 1000 };

app.use(authMiddleware);
app.use('/api/me', customerOnly);

// ── PNG icon generator (no external deps) ────────────────────────────────
function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
}
const CRC_TABLE = makeCRCTable();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]; return ((c ^ 0xFFFFFFFF) >>> 0); }
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}
// ── 5×7 bitmap font for S, D, G (each cell is a square pixel) ────────────
// Used to draw the SDGMart wordmark onto the PWA home-screen icon.
const GLYPHS = {
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  G: ['.XXXX', 'X....', 'X....', 'X..XX', 'X...X', 'X...X', '.XXX.'],
};

// Build a 24-bit RGB PNG buffer at the given size, with a black background
// and the text "SDG" centred in white.
function createIconPNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  // Pre-fill black (filter byte 0 + RGB stays 0)
  // — buffers are zero-initialised in Node, so this is already #000000.
  //   We still need to leave the filter byte (col 0) at 0 for each row.

  const letters = ['S', 'D', 'G'];
  const glyphW = 5, glyphH = 7;
  const spacing = 1; // 1 glyph-cell of space between letters
  const totalGlyphW = letters.length * glyphW + (letters.length - 1) * spacing;
  // Fit text to 60% of icon width, scaled to nearest integer pixel
  const scale = Math.max(1, Math.floor((size * 0.62) / totalGlyphW));
  const textPxW = totalGlyphW * scale;
  const textPxH = glyphH * scale;
  const startX = Math.floor((size - textPxW) / 2);
  const startY = Math.floor((size - textPxH) / 2);

  // Write white pixels for each ON cell of each glyph
  for (let i = 0; i < letters.length; i++) {
    const g = GLYPHS[letters[i]];
    const offsetX = startX + i * (glyphW + spacing) * scale;
    for (let row = 0; row < glyphH; row++) {
      for (let col = 0; col < glyphW; col++) {
        if (g[row][col] !== 'X') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const y = startY + row * scale + dy;
            const x = offsetX + col * scale + dx;
            const idx = y * rowSize + 1 + x * 3;
            raw[idx] = 255; raw[idx + 1] = 255; raw[idx + 2] = 255;
          }
        }
      }
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// Crisp SVG icon — scales to any size. Used as the manifest's primary icon
// on browsers that support SVG home-screen icons (Android Chrome, Edge, etc.)
function createIconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000"/>
  <text x="50%" y="50%" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="200" font-weight="900" fill="#fff"
        text-anchor="middle" dominant-baseline="central" letter-spacing="-4">SDG</text>
</svg>`;
}

function ensureIcons() {
  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);
  // Only generate icons that are missing — avoid rewriting 3 files on every boot.
  const gen = [['icon-192.png', () => createIconPNG(192)], ['icon-512.png', () => createIconPNG(512)],
    // Dedicated iOS home-screen icon (180×180). Separate filename so refreshing
    // the design forces iOS to re-fetch instead of reusing a hard-cached old one.
    ['apple-touch-icon.png', () => createIconPNG(180)], ['icon.svg', createIconSVG]];
  for (const [name, make] of gen) {
    const fp = path.join(iconsDir, name);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, make());
  }
}
ensureIcons();

// ── Pre-bundled app (esbuild) ────────────────────────────────────────────
// Replaces in-browser Babel: we concatenate all source files in load order
// and transform JSX → JS once (minified) on the server. The browser then runs
// a single fast bundle instead of compiling 22 files on every visit.
// In dev we rebuild on each request; in production we build once and cache.
// Every customer downloaded the full admin console — 130 KB of source they can
// never open, 38% of the bundle — plus the rider PWA and a design-prototyping
// panel left over from the refresh (G-07). Those now live in a second bundle
// fetched only when an admin or rider actually signs in (D-05).
const BUNDLE_FILES = [
  'hooks.js',
  'components/receipt.js',
  'components/Header.jsx',
  'components/HomePage.jsx',
  'components/CategoryPage.jsx',
  'components/ProductPage.jsx',
  'components/CartDrawer.jsx',
  'components/CheckoutPage.jsx',
  'components/SquadPage.jsx',
  'components/LoginPage.jsx',
  'components/MapPicker.jsx',
  'components/MyOrdersPage.jsx',
  'components/AccountPage.jsx',
  'components/ReviewPromptModal.jsx',
  'components/FeedbackBox.jsx',
  'components/RequestProductButton.jsx',
  'components/OrderTrackingPage.jsx',
  // tweaks-panel.jsx stays in the customer bundle: App.jsx calls useTweaks() for
  // the active theme and renders <TweaksPanel>, so it is NOT dead code. My
  // earlier reading (audit G-07) was wrong. Its unvalidated postMessage listener
  // is still worth removing, but that is a surgical change to the file, not a
  // matter of dropping it from the build.
  'tweaks-panel.jsx',
  'App.jsx',
];

// Staff-only. Loaded on demand by App.jsx; never sent to a shopper.
const STAFF_BUNDLE_FILES = [
  'components/AdminPage.jsx',
  'components/RiderPage.jsx',
];
let _esbuild = null;
let _bundleCache = null;
let _bundleBuiltAt = 0;   // newest source mtime captured when we last built

// Newest modification time across all bundle source files. Cheap (~20 stats).
function newestSourceMtime(files = BUNDLE_FILES) {
  let newest = 0;
  for (const rel of files) {
    try { const m = fs.statSync(path.join(__dirname, rel)).mtimeMs; if (m > newest) newest = m; }
    catch (_) {}
  }
  return newest;
}

// ── Build id for the service worker (audit G-05) ────────────────────────
// Every release used to require hand-editing CACHE_NAME in sw.js. Forget it
// and phones keep serving the PREVIOUS bundle from cache while the server
// happily serves the new one — with nothing to say so. That is exactly what
// happened during v81 testing (HANDOFF). A release step that depends on
// remembering will eventually run without it, and this one fails silently.
//
// So the server fills the version in, from three sources in order of how
// trustworthy they are:
//   1. RENDER_GIT_COMMIT — set by Render on every deploy. Exact.
//   2. .git/HEAD, read directly (no subprocess, git need not be installed).
//   3. Newest mtime across everything we serve. Always available; on a fresh
//      clone this is checkout time, so it changes each deploy regardless.
// A redundant cache bust costs one download. A missed one strands every
// installed phone on stale code, so the fallbacks err towards busting.
let _buildId = null;
function buildId() {
  if (_buildId) return _buildId;
  const short = (v) => String(v).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

  const fromEnv = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '';
  if (fromEnv) return (_buildId = short(fromEnv));

  try {
    const head = fs.readFileSync(path.join(__dirname, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*(.+)$/);
    const sha = m
      ? fs.readFileSync(path.join(__dirname, '.git', m[1]), 'utf8').trim()
      : head;                                   // detached HEAD holds the sha itself
    if (sha) return (_buildId = short(sha));
  } catch (_) { /* no .git — a deployed tarball, say */ }

  const newest = Math.max(
    newestSourceMtime(BUNDLE_FILES),
    newestSourceMtime(STAFF_BUNDLE_FILES),
    newestSourceMtime(['SDGMart.html', 'responsive.css', 'sw.js']),
  );
  return (_buildId = 't' + short(Math.round(newest).toString(36)));
}

function buildAppBundle(files = BUNDLE_FILES) {
  if (!_esbuild) _esbuild = require('esbuild');
  // Concatenate sources with a banner per file (helps stack traces).
  const parts = files.map(rel => {
    const full = path.join(__dirname, rel);
    const src = fs.readFileSync(full, 'utf8');
    return `\n/* ==== ${rel} ==== */\n${src}\n`;
  });
  const combined = parts.join('\n');
  const result = _esbuild.transformSync(combined, {
    loader: 'jsx',
    jsx: 'transform',          // classic React.createElement (React is global)
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,  // keep top-level names so window-global pattern is safe
    target: 'es2018',
    legalComments: 'none',
  });
  return result.code;
}

let _staffCache = null;
let _staffBuiltAt = 0;
app.get('/app.staff.js', (req, res) => {
  try {
    const newest = newestSourceMtime(STAFF_BUNDLE_FILES);
    if (!_staffCache || newest > _staffBuiltAt) {
      _staffCache = buildAppBundle(STAFF_BUNDLE_FILES);
      _staffBuiltAt = newest;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(_staffCache);
  } catch (e) {
    console.error('staff bundle build failed:', e.message);
    res.status(500).type('application/javascript').send('console.error("SDGMart staff bundle error");');
  }
});

app.get('/app.bundle.js', (req, res) => {
  try {
    // Rebuild only when a source file changed since the last build. On Render
    // (immutable after deploy) this always serves the cache; locally, editing a
    // file bumps its mtime and triggers a fresh build on the next request.
    const newest = newestSourceMtime();
    if (!_bundleCache || newest > _bundleBuiltAt) {
      _bundleCache = buildAppBundle();
      _bundleBuiltAt = newest;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Short browser cache; the SW already network-firsts JS so updates land fast.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(_bundleCache);
  } catch (e) {
    console.error('bundle build failed:', e.message);
    res.status(500).type('application/javascript').send(`console.error(${JSON.stringify('SDGMart bundle build error: ' + e.message)});`);
  }
});

// Build the bundle once at startup so the very first visitor doesn't pay for it.
// Fail loudly on schema drift rather than discovering it from a customer (B-07).
db.checkSchema().catch((e) => console.warn('schema check skipped:', e.message));
try { _bundleCache = buildAppBundle(); _bundleBuiltAt = newestSourceMtime(); console.log('📦 App bundle pre-built'); }
catch (e) { console.warn('⚠️  initial bundle build failed (will retry on first request):', e.message); }

// Cached top-seller counts. Scanning the whole orders table is expensive and
// /data/products.js runs on every page load — cache it for 5 minutes.
let _orderCountsCache = { counts: null, at: 0 };
async function getOrderItemCounts() {
  if (_orderCountsCache.counts && Date.now() - _orderCountsCache.at < 5 * 60 * 1000) return _orderCountsCache.counts;
  // Was db.orders.list(): every column of every order ever placed, loaded into
  // memory to count line items — on a path every anonymous page view triggers.
  // Now one column over a bounded recent window, which is also a better answer:
  // "popular right now" should not be dominated by last year's baskets.
  const itemArrays = await db.orders.recentItemsForCounts({ days: 90, limit: 5000 });
  const counts = {};
  itemArrays.forEach(raw => {
    let items = raw;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    (items || []).forEach(i => { counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); });
  });
  _orderCountsCache = { counts, at: Date.now() };
  return counts;
}

// ── Dynamic products.js (served from DB) ─────────────────────────────────
// Every visitor loads this file on every page load, and regenerating it hits
// Supabase (products + app_config) each time — the #1 hot path under traffic.
// Cache the generated JS in memory for CATALOG_TTL_MS; admin product/settings
// mutations call invalidateCatalog() so edits still appear immediately.
// Shared by the success and the failure path of /data/products.js, so a
// degraded catalogue still offers the same categories and delivery areas — and
// so the two lists cannot drift apart.
const CATALOG_CATEGORIES = ["Rice & Grains","Cooking Oil","Canned & Sauces","Spices & Seasoning","Dairy & Eggs","Drinks","Snacks & Biscuits","Breakfast & Cereals","Baking & Sugar","Coffee, Tea & Cocoa","Fruits & Vegetables","Staples (Tubers & Fufu)","Meat, Poultry & Seafood","Toiletries & Personal Care"];
const CATALOG_ESSENTIALS = [46, 45, 37, 132, 79, 140, 141, 78, 99];
const CATALOG_NEIGHBORHOODS = ["Tamale Central","Kalpohin","Lamashegu","Sagnarigu","Nyohini","Choggu","Vittin","Tishigu","Gumbihini","Jisonayili"];

const CATALOG_TTL_MS = 60 * 1000;
let _catalogCache = { js: null, at: 0 };
let _catalogJsonCache = { data: null, at: 0 };
function invalidateCatalog() { _catalogCache = { js: null, at: 0 }; _catalogJsonCache = { data: null, at: 0 }; }
app.get('/data/products.js', async (req, res) => {
  try {
    if (_catalogCache.js && Date.now() - _catalogCache.at < CATALOG_TTL_MS) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(_catalogCache.js);
    }
    const productsList = (await db.products.listForCatalog()).map(p => ({ ...p, bestseller: !!p.bestseller, img: p.img || null }));
    const counts = await getOrderItemCounts();
    const TOP_IDS_BY_ORDERS = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => Number(id));
    const categories = CATALOG_CATEGORIES;
    const essentials = CATALOG_ESSENTIALS;
    const neighborhoods = CATALOG_NEIGHBORHOODS;
    // Customer-facing freshness/expiry display is off by default; admin can flip it on.
    const showFreshness = !!(await db.appConfig.get('show_freshness'));
    // Own-stock mode (admin toggle 'deduct_stock'): when ON we hold our own
    // inventory, so product pages also show exact stock quantities.
    const showStock = !!(await db.appConfig.get('deduct_stock'));
    // LocationIQ publishable key for maps + geocoding (falls back to OSM when blank).
    // Safe to expose client-side; restrict it by domain in the LocationIQ dashboard.
    const locationiqKey = process.env.LOCATIONIQ_KEY || '';
    const js = `
const PRODUCTS = ${JSON.stringify(productsList)};
const CATEGORIES = ${JSON.stringify(categories)};
const ESSENTIALS = ${JSON.stringify(essentials)};
const NEIGHBORHOODS = ${JSON.stringify(neighborhoods)};
const TOP_IDS_BY_ORDERS = ${JSON.stringify(TOP_IDS_BY_ORDERS)};
const SHOW_FRESHNESS = ${showFreshness ? 'true' : 'false'};
const TERMS_VERSION = ${JSON.stringify(TERMS_VERSION)};
const SHOW_STOCK = ${showStock ? 'true' : 'false'};
if (typeof window !== 'undefined') {
  window.PRODUCTS = PRODUCTS;
  window.CATEGORIES = CATEGORIES;
  window.ESSENTIALS = ESSENTIALS;
  window.NEIGHBORHOODS = NEIGHBORHOODS;
  window.TOP_IDS_BY_ORDERS = TOP_IDS_BY_ORDERS;
  window.SHOW_FRESHNESS = SHOW_FRESHNESS;
  window.TERMS_VERSION = TERMS_VERSION;
  window.SHOW_STOCK = SHOW_STOCK;
  window.LOCATIONIQ_KEY = ${JSON.stringify(locationiqKey)};
  window.PAYSTACK_PUBLIC_KEY = ${JSON.stringify(PAYSTACK_PUBLIC_KEY)};
}`;
    _catalogCache = { js, at: Date.now() };
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(js);
  } catch (e) {
    console.error('products.js failed:', e);
    // This used to answer `// error loading products` — a script that parses
    // cleanly and defines NOTHING. Every screen then read window.PRODUCTS as
    // undefined and died on .map/.filter, so one bad catalogue query took the
    // entire app down rather than one section of it. Emit the same globals with
    // empty values plus a flag the client can show a retry banner for, and mark
    // it no-store so neither the browser nor the service worker can keep it.
    try { await db.errorLog.record({ message: 'products.js failed: ' + (e && e.message), path: '/data/products.js', method: 'GET', status: 500 }); } catch (_) {}
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`
if (typeof window !== 'undefined') {
  window.PRODUCTS = [];
  window.CATEGORIES = ${JSON.stringify(CATALOG_CATEGORIES)};
  window.ESSENTIALS = ${JSON.stringify(CATALOG_ESSENTIALS)};
  window.NEIGHBORHOODS = ${JSON.stringify(CATALOG_NEIGHBORHOODS)};
  window.TOP_IDS_BY_ORDERS = [];
  window.SHOW_FRESHNESS = false;
  window.TERMS_VERSION = ${JSON.stringify(TERMS_VERSION)};
  window.SHOW_STOCK = false;
  window.LOCATIONIQ_KEY = '';
  window.PAYSTACK_PUBLIC_KEY = '';
  window.CATALOG_LOAD_FAILED = true;
}`);
  }
});

// Audit F-06/C-09: /data/products.js is a <script>, so the client cannot
// re-read it without eval — which the A-17 CSP rightly does not allow. This
// serves the same shopper catalogue as JSON so a PWA returning from the
// background can refresh prices and stock. Shares the 5-minute cache and is
// invalidated by the same admin writes.
app.get('/api/catalog', async (req, res) => {
  try {
    if (_catalogJsonCache.data && Date.now() - _catalogJsonCache.at < CATALOG_TTL_MS) {
      return res.json(_catalogJsonCache.data);
    }
    const products = (await db.products.listForCatalog())
      .map(p => ({ ...p, bestseller: !!p.bestseller, img: p.img || null }));
    // This is the recovery path for a device whose /data/products.js never
    // loaded, so it has to carry EVERYTHING that script defines — not just the
    // products. Returning products alone left such a device with a full
    // catalogue and an empty window.CATEGORIES: the category strip in the
    // header and the "Shop by category" tiles both vanished while every product
    // still rendered, which is exactly what the owner reported. Whatever
    // /data/products.js sets, this must be able to set too.
    // Bestseller ranking is a nicety; this endpoint is a lifeline. Never let
    // the orders query take down the one route a device with no catalogue has
    // left — it is not worth a 500 here.
    let topIds = [];
    try {
      const counts = await getOrderItemCounts();
      topIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => Number(id));
    } catch (e) { console.warn('/api/catalog: order counts unavailable, serving without them:', e.message); }
    const payload = {
      products,
      categories: CATALOG_CATEGORIES,
      neighborhoods: CATALOG_NEIGHBORHOODS,
      essentials: CATALOG_ESSENTIALS,
      topIdsByOrders: topIds,
      termsVersion: TERMS_VERSION,
      showFreshness: !!(await db.appConfig.get('show_freshness')),
      showStock: !!(await db.appConfig.get('deduct_stock')),
    };
    _catalogJsonCache = { data: payload, at: Date.now() };
    res.json(payload);
  } catch (e) { fail(res, e, req); }
});

// ── Products API ─────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try { res.json((await db.products.list()).map(p => ({ ...p, bestseller: !!p.bestseller, img: p.img || null }))); }
  catch (e) { fail(res, e, req); }
});

app.get('/api/products/top', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit) || 8));
    const productsList = (await db.products.list()).map(p => ({ ...p, bestseller: !!p.bestseller }));
    const counts = await getOrderItemCounts();
    const ranked = productsList.map(p => ({ ...p, _orderCount: counts[p.id] || 0 })).sort((a, b) => b._orderCount - a._orderCount);
    const realTop = ranked.filter(p => p._orderCount > 0).slice(0, limit);
    if (realTop.length < limit) {
      const remaining = ranked.filter(p => p._orderCount === 0);
      for (let i = remaining.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
      realTop.push(...remaining.slice(0, limit - realTop.length));
    }
    res.json(realTop);
  } catch (e) { fail(res, e, req); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await db.products.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ ...p, bestseller: !!p.bestseller });
  } catch (e) { fail(res, e, req); }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, unit, bestBefore, stock, description, bestseller, lowStockThreshold } = req.body;
    const vErr = validateProductFields({ price, stock, lowStockThreshold, bestBefore });
    if (vErr) return res.status(400).json({ error: vErr });
    const created = await db.products.create({ name, category, price: parseFloat(price), unit, bestBefore: normalizeBestBefore(bestBefore), stock: parseInt(stock) || 0, description: description || '', bestseller: !!bestseller, lowStockThreshold: lowStockThreshold != null ? parseInt(lowStockThreshold) : undefined });
    invalidateCatalog();
    res.status(201).json({ ...created, bestseller: !!created.bestseller });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, unit, bestBefore, stock, description, bestseller, lowStockThreshold } = req.body;
    const vErr = validateProductFields({ price, stock, lowStockThreshold, bestBefore });
    if (vErr) return res.status(400).json({ error: vErr });
    const updated = await db.products.update(req.params.id, { name, category, price: parseFloat(price), unit, bestBefore: normalizeBestBefore(bestBefore), stock: parseInt(stock) || 0, description: description || '', bestseller: !!bestseller, ...(lowStockThreshold != null ? { lowStockThreshold: parseInt(lowStockThreshold) } : {}) });
    invalidateCatalog();
    res.json({ ...updated, bestseller: !!updated.bestseller });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try { await db.products.delete(req.params.id); invalidateCatalog(); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// Admin: low-stock products (uses per-product threshold, default 5)
app.get('/api/admin/inventory/low', requireAdmin, async (req, res) => {
  try { res.json(await db.products.lowStock()); }
  catch (e) { fail(res, e, req); }
});

// ── Orders API ───────────────────────────────────────────────────────────
app.get('/api/orders', requireAdmin, async (req, res) => {
  try { res.json(await db.orders.list({ limit: Math.min(2000, parseInt(req.query.limit, 10) || 500) })); }
  catch (e) { fail(res, e, req); }
});

// Birthday gift eligibility — valid in the user's birth MONTH, once per year,
// only when the admin has enabled it and configured gift products.
async function birthdayGiftStatus(user) {
  const cfg = (await db.appConfig.get('birthday_gifts')) || { enabled: false, productIds: [] };
  const year = new Date().getFullYear();
  const inBirthMonth = !!(user && user.birthMonth) && (new Date().getMonth() + 1) === Number(user.birthMonth);
  const eligible = !!cfg.enabled
    && Array.isArray(cfg.productIds) && cfg.productIds.length > 0
    && inBirthMonth
    && Number(user.birthdayGiftClaimedYear || 0) !== year;
  return { cfg, eligible, year };
}

// ── Server-authoritative pricing ─────────────────────────────────────────
// NEVER trust client prices / subtotal / total / amount. Recompute everything
// from DB product prices + active promos + the signed-in user's discount &
// loyalty. Used by both order creation and Paystack init so the charge and the
// stored order always match reality.
const STANDARD_DELIVERY = 10;
const FREE_DELIVERY_MIN = 150;
// Bump this whenever the privacy notice or terms change materially — stored
// per user so it is answerable which text each customer agreed to (audit H-03).
const TERMS_VERSION = '2026-08-29';

const FIRST_ORDER_FREE_MIN = 50; // first-order free delivery only when the order is ≥ this (GHS)

// Audit B-14: product writes took parseFloat(price) with no floor and no CHECK
// behind them. computeOrderPricing already clamps a line to >= 0, so a
// negative price could not drive a cart total down, but it would still show
// as a negative price in the catalogue and in every admin figure.
function validateProductFields({ price, stock, lowStockThreshold, bestBefore }) {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || p < 0) return 'Price must be a number of 0 or more.';
  if (p > 100000) return 'Price looks wrong — over GHS 100,000.';
  if (stock != null && stock !== '') {
    const st = parseInt(stock, 10);
    if (!Number.isFinite(st) || st < 0) return 'Stock cannot be negative.';
  }
  if (lowStockThreshold != null && lowStockThreshold !== '') {
    const t = parseInt(lowStockThreshold, 10);
    if (!Number.isFinite(t) || t < 0) return 'Low-stock threshold cannot be negative.';
  }
  if (normalizeBestBefore(bestBefore) === BAD_DATE) {
    return 'Best Before must be a date like 2026-12-31, or left empty.';
  }
  return null;
}
// best_before is a Postgres `date`, which takes 'YYYY-MM-DD' or NULL — never
// ''. An <input type="date"> that has never been filled in submits '', so every
// Save on a product without a Best Before date reached Postgres as
// `invalid input syntax for type date: ""`, came back as a 404 {error: ...},
// and AdminPage wrote that error object into the row (blank name, GHS NaN, and
// a low-stock alert for the stock field it did not have). Empty means "no
// date": store NULL. Anything else that is not a plain date is a 400 with a
// reason, not a database error dressed up as "not found".
const BAD_DATE = Symbol('bad-date');
function normalizeBestBefore(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return BAD_DATE;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return BAD_DATE;
  return s;
}
// A cart cannot legitimately contain more distinct products than this; the cap
// exists so one request cannot be turned into an unbounded amount of work.
const MAX_ORDER_LINES = 100;

// Last successfully loaded promotions, so a momentary Supabase failure cannot
// quietly turn a sale off for everyone. Beyond this age we would rather refuse
// to price than guess.
let _promoCache = { map: null, at: 0 };
const PROMO_STALE_MS = 10 * 60 * 1000;

// Lets pricing reject a basket with a real status code instead of a 500.
// ── Kill switches ────────────────────────────────────────────────────────
// Admin-flippable stops for the paths that can lose money. Without these the
// only way to halt an exploit in progress is a code change and a deploy — with
// no staging to verify it against. Default ON, so an unset key changes nothing.
// Own-stock mode. Deliberately NOT switchOn(): that fails open so a config
// read cannot stop the shop trading, which is right for the emergency
// switches and exactly wrong here — failing open would start subtracting
// stock on a shop that does not track any (audit C-10).
async function ownStockMode() {
  try { return !!(await db.appConfig.get('deduct_stock')); }
  catch (_) { return false; }
}

// Turn shortfall rows into something a customer can read.
async function namesForShortfalls(shortfalls) {
  const ids = (shortfalls || []).map((s) => s.id).filter((v) => v != null);
  if (!ids.length) return 'one of your items';
  try {
    const found = await db.products.listByIds(ids);
    const names = found.map((p) => p.name).filter(Boolean);
    if (!names.length) return 'one of your items';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  } catch (_) { return 'one of your items'; }
}

async function switchOn(key) {
  try {
    const v = await db.appConfig.get(key);
    return v === undefined || v === null ? true : !!v;
  } catch (_) { return true; }   // never let a config read block trading
}

// Every route used to end in `catch (e) { res.status(500).json({ error: e.message }) }`:
// the error was never recorded anywhere searchable, and because the handler dealt
// with it itself it never reached the global middleware that would have logged it.
// So the incidents most worth diagnosing were the ones least likely to be captured
// (E-04) — and raw Postgres text went to the browser, naming columns and
// constraints (E-07). This does both jobs in one call.
// ── Scrubbing credentials out of logs (audit E-08) ──────────────────────
// The global handler recorded req.originalUrl, query string included, into
// error_logs AND Sentry. Guest order tracking authenticates with ?t=<token>,
// so any 500 on that route wrote a live credential into a table the admin
// panel renders and into a third-party service. Same for the email
// verification and password-reset links, which carry ?token=.
// Every parameter this app has ever used to carry a credential. `reset` and
// `verify` are the email-link tokens, `t`/`track`/`trackToken` the guest
// tracking pair, `reference` the Paystack ref. Redacting a harmless one costs
// nothing; missing one writes a live credential into a table the admin panel
// renders and into a third-party service.
const SENSITIVE_PARAMS = new Set([
  't', 'track', 'trackToken', 'token', 'reset', 'verify',
  'reference', 'ref', 'code', 'key', 'secret', 'password', 'pw', 'auth',
]);
function scrubUrl(url) {
  const raw = String(url || '');
  const qi = raw.indexOf('?');
  if (qi === -1) return raw;
  const path = raw.slice(0, qi);
  try {
    const params = new URLSearchParams(raw.slice(qi + 1));
    const kept = [];
    for (const [k, v] of params) {
      kept.push(k + '=' + (SENSITIVE_PARAMS.has(k) ? '[redacted]' : v));
    }
    return kept.length ? path + '?' + kept.join('&') : path;
  } catch (_) {
    return path + '?[unparseable]';   // never fall back to the raw string
  }
}

function fail(res, e, req, where) {
  if (e && e.status) {
    return res.status(e.status).json({ error: e.message, ...(e.unavailable ? { unavailable: e.unavailable } : {}) });
  }
  const path = where || (req && req.path) || 'unknown';
  console.error('[' + path + ']', e && e.message ? e.message : e);
  db.errorLog.record({
    message: path + ': ' + (e && e.message ? e.message : String(e)),
    stack: (e && e.stack) || '', path,
    method: (req && req.method) || null, status: 500,
    userId: req && req.user ? req.user.id : null,
  }).catch(() => {});
  if (Sentry) { try { Sentry.captureException(e); } catch (_) {} }
  return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
}

// The checkout form validates carefully; the server accepted almost anything
// (F-04). A direct POST could create an order with no name, no phone and no
// address — undeliverable, and impossible to follow up because there is no
// contact detail on it. This mirrors CheckoutPage's validate1 so the rule lives
// where it cannot be bypassed, and caps every free-text field so one request
// cannot push megabytes into unbounded text columns (B-09).
const NEIGHBOURHOODS = ['Tamale Central', 'Kalpohin', 'Lamashegu', 'Sagnarigu', 'Nyohini',
  'Choggu', 'Vittin', 'Tishigu', 'Gumbihini', 'Jisonayili'];
const PHONE_RE = /^\+?[\d\s-]{9,20}$/;
const cap = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function validateDelivery(body, extra = {}) {
  const familyMode = !!body.familyMode;
  const out = {
    customer: cap(body.customer, 80),
    phone: cap(body.phone, 20),
    address: cap(body.address, 300),
    neighborhood: cap(body.neighborhood, 60),
    recipientName: cap(body.recipientName, 80),
    recipientPhone: cap(body.recipientPhone, 20),
    recipientAddress: cap(body.recipientAddress, 300),
    giftMessage: cap(body.giftMessage, 300),
    momoNumber: cap(body.momoNumber, 20),
  };
  const bad = [];
  if (!out.customer) bad.push('a name');
  if (!out.phone || !PHONE_RE.test(out.phone)) bad.push('a valid phone number');
  if (!out.neighborhood) bad.push('a neighbourhood');

  // Either a typed landmark or a map pin — the same rule the form applies,
  // because Tamale addressing is informal and the pin often carries it.
  const loc = body.location;
  const hasPin = !!(loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180);
  if (!out.address && !hasPin) bad.push('a landmark or a map pin');

  if (familyMode) {
    if (!out.recipientName) bad.push("the recipient's name");
    if (!out.recipientPhone || !PHONE_RE.test(out.recipientPhone)) bad.push("a valid recipient phone number");
  }
  if (bad.length) {
    throw new HttpError(400, 'Your order is missing ' + bad.join(', ') + '.', { missing: bad });
  }

  // A delivery slot must be one the shop actually offers, and a neighbourhood
  // outside the known list is allowed (customers do type their own area) but is
  // flagged so a typo does not quietly fragment the admin route grouping.
  out.unknownNeighborhood = !NEIGHBOURHOODS.some((n) => n.toLowerCase() === out.neighborhood.toLowerCase());
  out.hasPin = hasPin;
  return out;
}

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

async function computeOrderPricing(reqUser, body) {
  const clientItems = Array.isArray(body.items) ? body.items : [];
  let deductStock = false;
  try { deductStock = !!(await db.appConfig.get('deduct_stock')); } catch (_) {}
  // A swallowed failure here silently priced every basket at FULL price with no
  // error, no log and no alert — and it would bite hardest during a flash sale,
  // when a promo push has just gone out and load is at its peak. Now: serve the
  // last known good set on a blip, and refuse to price at all if we have never
  // loaded one, because overcharging is worse than asking the customer to retry.
  let promoMap = {};
  try {
    const promos = await db.promotions.listActive();
    (promos || []).forEach(p => (p.productIds || []).forEach(id => {
      if (!promoMap[id] || p.discountPercent > promoMap[id]) promoMap[id] = p.discountPercent;
    }));
    _promoCache = { map: promoMap, at: Date.now() };
  } catch (e) {
    console.error('promotions lookup failed:', e.message);
    db.errorLog.record({ message: 'promotions lookup failed during pricing: ' + e.message, path: '/pricing', status: 500 }).catch(() => {});
    if (_promoCache.map && Date.now() - _promoCache.at < PROMO_STALE_MS) {
      promoMap = _promoCache.map;
      console.warn('pricing with promotions cached ' + Math.round((Date.now() - _promoCache.at) / 1000) + 's ago');
    } else {
      throw new HttpError(503, 'We could not confirm current prices just now. Please try again in a moment.');
    }
  }
  // Collapse duplicate ids into one line before clamping (C-04). The 99 cap was
  // per LINE, so 200 lines of the same product meant 19,800 units — and each
  // line cost its own sequential products.get, letting one 3 MB request tie the
  // single Node process up in tens of thousands of round-trips.
  const wanted = new Map();
  for (const ci of clientItems) {
    if (!ci || ci.birthdayGift) continue; // gift is appended separately, always free
    const id = parseInt(ci.id, 10);
    if (!Number.isFinite(id)) continue;
    // `parseInt(x) || 1` would turn an explicit qty of 0 — "remove this line" —
    // into 1, quietly adding an item the customer took out.
    const raw = parseInt(ci.qty, 10);
    const qty = Number.isFinite(raw) ? Math.max(0, Math.min(99, raw)) : 1;
    if (!qty) continue;
    wanted.set(id, Math.min(99, (wanted.get(id) || 0) + qty));
    if (wanted.size > MAX_ORDER_LINES) throw new HttpError(400, 'That order has too many different items.');
  }
  // One query instead of one per line.
  const found = await db.products.listByIds([...wanted.keys()]);
  const byId = new Map(found.map((p) => [String(p.id), p]));
  // What can actually be sold right now: on the shelf, minus live holds from
  // other checkouts (audit C-10). Falls back to the raw shelf count if the
  // reservation functions are unreachable — no worse than before they existed.
  let availableById = null;
  if (deductStock) {
    try { availableById = await db.stock.available([...wanted.keys()]); }
    catch (e) { console.error('stock availability lookup failed, using shelf count:', e.message); }
  }
  const items = [];
  const unavailable = [];
  for (const [id, qty] of wanted) {
    const p = byId.get(String(id));
    if (!p) { unavailable.push({ id, reason: 'gone' }); continue; }
    // Availability was enforced only by hiding "Sold out" products in the UI,
    // so a direct POST could order any quantity of something with no stock
    // (B-03). Only meaningful while the deduct_stock toggle is on.
    if (deductStock) {
      const avail = availableById && availableById[p.id]
        ? Number(availableById[p.id].available)
        : Number(p.stock || 0);
      if (avail < qty) {
        unavailable.push({ id, name: p.name, reason: avail ? 'partial' : 'out', have: avail });
        continue;
      }
    }
    const pct = Number(promoMap[p.id] || 0);
    const price = Math.max(0, +(Number(p.price) * (1 - pct / 100)).toFixed(2));
    items.push({ id: p.id, name: p.name, category: p.category, unit: p.unit, price, qty, ...(pct ? { originalPrice: Number(p.price), promoPercent: pct } : {}) });
  }
  if (!items.length) {
    // An empty or all-invalid basket used to produce a real queued order for the
    // delivery fee alone, and a rider dispatched to deliver nothing (C-03).
    throw new HttpError(400, unavailable.length
      ? 'Those items are no longer available.'
      : 'Your cart is empty.', { unavailable });
  }
  const subtotal = +items.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);
  const loyaltyAllowed = await switchOn('loyalty_redemption_enabled');
  const discountApplied = !!(reqUser && reqUser.discountPending);
  const discount = discountApplied ? +(subtotal * 0.05).toFixed(2) : 0;
  const afterDiscount = +(subtotal - discount).toFixed(2);
  let loyaltyUsed = 0;
  if (loyaltyAllowed && reqUser && Number(body.loyaltyUsed || 0) > 0) {
    loyaltyUsed = +Math.min(Number(body.loyaltyUsed), Number(reqUser.loyaltyBalance || 0), afterDiscount).toFixed(2);
  }
  const afterLoyalty = +(afterDiscount - loyaltyUsed).toFixed(2);
  const firstOrderFree = !!(reqUser && reqUser.id && reqUser.role !== 'guest' && reqUser.firstOrderDone === false
    && afterLoyalty >= FIRST_ORDER_FREE_MIN);
  const delivery = (firstOrderFree || afterLoyalty >= FREE_DELIVERY_MIN) ? 0 : STANDARD_DELIVERY;
  const total = +(afterLoyalty + delivery).toFixed(2);
  return { items, subtotal, discount, discountApplied, loyaltyUsed, delivery, total, firstOrderFree, unavailable };
}

// Shared order-creation logic. Used by Cash-on-Delivery (/api/orders) and the
// Paystack verify/webhook paths. `reqUser` may be null (guest). `extra` carries
// payment status (paid, paystackRef).
// ── Checkout reservations (Paystack) ─────────────────────────────────────
// Online payment prices the order at `init` but only creates it at `verify`,
// minutes later, after the customer approves on their phone. Recomputing the
// price at `verify` meant the stored total could drift from the amount actually
// charged (audit C-07), and taking the loyalty at `verify` meant a second
// checkout could spend the same credit in between.
//
// So: take the value at `init`, when the price is locked, and carry both the
// resolved pricing and a ledger of what was taken on the pending_payments draft.
// `verify` then just creates the order from that — no second pricing pass, no
// second consumption. If the customer never pays, releaseReservation() hands it
// all back.
async function reserveForCheckout(reqUser, pricing, giftClaimYear) {
  const userId = reqUser ? reqUser.id : null;
  const ledger = { userId, loyalty: 0, discount: false, firstOrder: false, giftYear: null };
  if (!userId) return ledger;
  if (pricing.discountApplied && await db.squads.consumeDiscount(userId)) ledger.discount = true;
  if (pricing.loyaltyUsed) {
    const used = await db.squads.consumeLoyalty(userId, pricing.loyaltyUsed);
    ledger.loyalty = used;
    if (used < pricing.loyaltyUsed) {
      // Nothing is charged yet, so the honest move is to bill what they will
      // actually receive rather than absorbing the difference later.
      pricing.total = +(Number(pricing.total) + (pricing.loyaltyUsed - used)).toFixed(2);
      pricing.loyaltyUsed = used;
    }
  }
  if (!reqUser.firstOrderDone && pricing.firstOrderFree && await db.squads.claimFirstOrder(userId)) ledger.firstOrder = true;
  if (giftClaimYear != null && await db.squads.claimBirthdayGift(userId, giftClaimYear)) ledger.giftYear = giftClaimYear;
  return ledger;
}

async function releaseReservation(ledger) {
  if (!ledger) return;
  // Stock first, and outside the userId guard below: guests hold stock too,
  // but have no loyalty or perks to hand back (audit C-10).
  if (ledger.stockHoldKey) {
    try { await db.stock.release(ledger.stockHoldKey); }
    catch (e) { console.error('STOCK HOLD RELEASE FAILED for ' + ledger.stockHoldKey + ':', e.message); }
  }
  if (!ledger.userId) return;
  const { userId } = ledger;
  try { if (ledger.loyalty > 0) await db.squads.addLoyalty(userId, ledger.loyalty); }
  catch (e) { console.error('RESERVATION RELEASE FAILED (loyalty) for user ' + userId + ':', e.message); }
  try { if (ledger.discount) await db.squads.restoreDiscount(userId); } catch (_) {}
  try { if (ledger.firstOrder) await db.squads.releaseFirstOrder(userId); } catch (_) {}
  try { if (ledger.giftYear != null) await db.squads.releaseBirthdayGift(userId, ledger.giftYear); } catch (_) {}
}

// Hand back anything this customer reserved on a checkout they walked away
// from, so their credit is spendable again the moment they come back. Only
// releases when Paystack confirms the payment did NOT succeed — otherwise the
// webhook or the Reconcile screen may still turn it into an order.
async function releaseStaleReservations(userId) {
  if (!userId) return;
  let stale = [];
  try { stale = await db.pendingPayments.listStaleForUser(userId, 30); } catch (_) { return; }
  for (const row of stale) {
    try {
      if (PAYSTACK_SECRET_KEY) {
        const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(row.reference));
        if (ver && ver.status && ver.data && ver.data.status === 'success') continue; // paid — leave it
      }
      await releaseReservation((row.draft && row.draft._reserved) || null);
      await db.pendingPayments.delete(row.reference);
    } catch (e) { console.warn('stale reservation release failed for ' + row.reference + ':', e.message); }
  }
}

async function createOrderFromBody(reqUser, body, extra = {}) {
  // Never block an order whose payment has already been taken.
  if (!extra.paid && !(await switchOn('ordering_enabled'))) {
    throw new HttpError(503, 'We have paused new orders for a short while. Please try again soon, or message us on WhatsApp.');
  }
  // Duplicate-order protection: the client sends one key per checkout attempt
  // and reuses it when retrying. If that attempt already produced an order —
  // because the response was lost rather than the request failing — return the
  // original instead of creating a second one.
  const idemKey = String(body.clientRequestId || '').slice(0, 64) || null;
  if (idemKey) {
    const prior = await db.orders.findByClientRequestId(idemKey);
    if (prior) {
      return {
        ok: true, id: prior.id, total: prior.total, duplicate: true,
        deliveryDate: prior.deliveryDate, deliverySlot: prior.deliverySlot,
        priority: prior.priority, loyaltyPending: 0, squadGoalHit: false,
        trackToken: orderTrackToken(prior.id),
      };
    }
  }
  const {
    customer, phone, neighborhood, address,
    recipientName, recipientPhone, recipientAddress, payMethod, momoNumber, location,
    deliveryDate: reqDate, deliverySlot: reqSlot,
  } = body || {};
  const userId = reqUser ? reqUser.id : null;
  const now = new Date();
  // Scheduled delivery: customer may choose a future date (within 7 days) + a
  // time slot. Otherwise fall back to same-day / next-day on the 12:00 cutoff.
  // Both the date and the cutoff below come from the business timezone. They
  // used to mix toISOString() (UTC) with getHours() (server-local) and agreed
  // only because Render runs UTC and Ghana has no DST (audit B-11).
  const todayStr = db.businessDate(now);
  const maxStr = db.businessDatePlus(7, now);
  let deliveryDateStr, deliverySlot = null, priority;
  if (reqDate && /^\d{4}-\d{2}-\d{2}$/.test(reqDate) && reqDate > todayStr && reqDate <= maxStr) {
    deliveryDateStr = reqDate;
    deliverySlot = reqSlot ? String(reqSlot).slice(0, 20) : null;
    priority = false;
  } else {
    const afterCutoff = db.businessHour(now) >= 12;
    deliveryDateStr = afterCutoff ? db.businessDatePlus(1, now) : db.businessDate(now);
    priority = afterCutoff;
  }
  // Keep the fix quality alongside the coordinate (audit I-02) — a pin from a
  // coarse network fix should not be treated as though it were surveyed, and
  // markLastUsed's ~50m match threshold has no way to tell without this.
  const loc = location && typeof location.lat === 'number'
    ? {
        lat: location.lat, lng: location.lng,
        ...(location.address ? { address: String(location.address).slice(0, 300) } : {}),
        ...(Number.isFinite(Number(location.accuracy)) ? { accuracy: Math.round(Number(location.accuracy)) } : {}),
        ...(location.source ? { source: String(location.source).slice(0, 12) } : {}),
      }
    : null;

  // Authoritative pricing — recomputed on the server from DB prices + promos +
  // the signed-in user's discount/loyalty. Client prices/subtotal/total ignored.
  // A Paystack order carries the pricing that was locked at `init` and already
  // paid for. Recomputing it here is what let the stored total drift away from
  // the amount charged (C-07), so the locked copy wins whenever it is present.
  const locked = extra.locked || null;
  const pricing = locked ? locked.pricing : await computeOrderPricing(reqUser, body);
  const itemsList = [...pricing.items];

  // Birthday free gift — server-validated, appended at price 0. The claim is
  // recorded only AFTER a successful create (below), so a failed create can't
  // burn the once-a-year gift.
  let giftClaimYear = null;
  if (reqUser && body.birthdayGift && !locked) {
    const { cfg, eligible, year } = await birthdayGiftStatus(reqUser);
    const gid = parseInt(body.birthdayGift, 10);
    if (eligible && (cfg.productIds || []).map(Number).includes(gid)) {
      const gp = await db.products.get(gid);
      if (gp) { itemsList.push({ id: gp.id, name: gp.name, category: gp.category, unit: gp.unit, qty: 1, price: 0, birthdayGift: true }); giftClaimYear = year; }
    }
  }

  // Validate and cap the delivery details before anything is consumed or
  // written. A locked (already-paid) order skips this: it was validated at init,
  // and rejecting it now would take the money without creating the order.
  let clean = null;
  if (!locked) {
    clean = validateDelivery(body, extra);
    if (clean.unknownNeighborhood) {
      console.warn('order uses an unlisted neighbourhood: ' + JSON.stringify(clean.neighborhood));
    }
  }

  // ── Step 1: CONSUME what this order spends, BEFORE the order row exists ──
  // Supabase's REST client has no multi-statement transaction, so the sequence
  // is ordered to fail safe instead. Consumption runs first because it is fully
  // reversible: if anything below throws, `compensate` hands it all back and no
  // order was created. The previous order (create first, consume after) meant a
  // failure at the consume step left the customer with the discount applied to
  // a real order AND their balance intact.
  const compensate = [];
  if (userId && !locked) {
    if (pricing.discountApplied) {
      const took = await db.squads.consumeDiscount(userId);
      if (took) compensate.push(() => db.squads.restoreDiscount(userId));
    }
    if (pricing.loyaltyUsed) {
      // Throws (rather than silently under-charging) if the row is too contended.
      const used = await db.squads.consumeLoyalty(userId, pricing.loyaltyUsed);
      if (used > 0) compensate.push(() => db.squads.addLoyalty(userId, used));
      if (used < pricing.loyaltyUsed) {
        // Someone else spent the credit first. For an UNPAID (cash) order, bill
        // only the credit actually applied. For a Paystack order the money is
        // already collected at the quoted amount, so raising the total would
        // make a paid customer look like they owe the difference — record what
        // was really consumed and absorb the rest.
        if (!extra.paid) pricing.total = +(Number(pricing.total) + (pricing.loyaltyUsed - used)).toFixed(2);
        else console.warn('loyalty short by GHS ' + (pricing.loyaltyUsed - used).toFixed(2) + ' on PAID order for user ' + userId + ' — absorbed');
        pricing.loyaltyUsed = used;
      }
    }
    // The first-order-free-delivery perk: exactly one order can claim it.
    if (!reqUser.firstOrderDone && pricing.firstOrderFree) {
      const won = await db.squads.claimFirstOrder(userId);
      if (won) compensate.push(() => db.squads.releaseFirstOrder(userId));
      // If another concurrent order claimed it first we still honour the price
      // the customer was quoted — charging more than they agreed at checkout
      // would be worse than occasionally absorbing one delivery fee.
      else console.warn('first-order perk already claimed by a concurrent order for user ' + userId);
    }
    if (giftClaimYear != null) {
      const claimed = await db.squads.claimBirthdayGift(userId, giftClaimYear);
      if (!claimed) {
        // Gift already taken this year — drop it rather than give a second one.
        for (let i = itemsList.length - 1; i >= 0; i--) if (itemsList[i].birthdayGift) itemsList.splice(i, 1);
      }
    }
  }

  // ── Step 1b: stock (audit C-10) ──────────────────────────────────────────
  // A Paystack order already holds its stock from checkout — that hold is
  // committed after the order row exists. A cash order commits immediately,
  // so there is no gap to hold across: take the stock atomically here, before
  // the customer is told anything, and undo it if the create then fails.
  const stockHoldKey = extra.paystackRef || null;
  if (!stockHoldKey && await ownStockMode()) {
    try {
      const taken = await db.stock.consume(itemsList);
      if (!taken.ok) {
        const names = await namesForShortfalls(taken.shortfalls);
        for (const undo of compensate.reverse()) { try { await undo(); } catch (_) {} }
        throw new HttpError(409, 'Someone just took the last of ' + names + '. Nothing has been charged.', { unavailable: taken.shortfalls || [] });
      }
      compensate.push(() => db.stock.restock(itemsList));
    } catch (e) {
      if (e && e.status) throw e;
      // Own-stock mode is on but we cannot account for stock. Let the order
      // through rather than refusing a real customer over bookkeeping, and
      // make sure somebody knows the count is now wrong.
      console.error('STOCK CONSUME FAILED, order proceeding unaccounted:', e.message);
      alertAdmins('stock-consume-failed', '⚠️ Stock not deducted',
        'Own-stock mode is on but stock could not be deducted for a cash order. Inventory counts will drift until this is fixed.');
    }
  }

  // ── Step 2: create the order. On failure, undo step 1 completely. ────────
  let created;
  try {
    created = await db.orders.create({
      userId,
      clientRequestId: idemKey,
      customerName: clean ? clean.customer : (customer || ''),
      customerPhone: clean ? clean.phone : (phone || ''),
      recipientName: clean ? clean.recipientName : (recipientName || ''),
      recipientPhone: clean ? clean.recipientPhone : (recipientPhone || ''),
      address: clean ? (clean.address || clean.recipientAddress) : (address || recipientAddress || ''),
      neighborhood: clean ? clean.neighborhood : (neighborhood || ''),
      items: itemsList, subtotal: pricing.subtotal, deliveryFee: pricing.delivery,
      discount: pricing.discount, loyaltyUsed: pricing.loyaltyUsed, total: pricing.total,
      paymentMethod: payMethod || (extra.paid ? 'paystack' : 'cash'),
      momoNumber: clean ? clean.momoNumber : (momoNumber || ''),
      paid: !!extra.paid, paystackRef: extra.paystackRef || null,
      status: 'queued', location: loc, deliveryDate: deliveryDateStr, deliverySlot, priority,
    });
  } catch (e) {
    for (const undo of compensate.reverse()) {
      try { await undo(); } catch (u) { console.error('COMPENSATION FAILED after order insert error:', u.message); }
    }
    // A locked (already-paid) order must NOT release its reservation here: the
    // customer's money has been taken, so the value stays spent and the webhook
    // or the Reconcile screen retries creating the order.

    // Two retries of the same attempt raced each other. The unique index did its
    // job — return the order the winner created rather than surfacing an error.
    // The unique index on paystack_ref (added by supabase-schema-constraints.sql)
    // now settles the verify-vs-webhook race in the database: whichever arrives
    // second gets a duplicate-key error, and the order the winner created is the
    // right answer to return (A-09).
    if (extra.paystackRef && e && /duplicate key|23505/i.test(e.message || '')) {
      const won = await db.orders.findByPaystackRef(extra.paystackRef);
      if (won) return { ok: true, id: won.id, total: won.total, duplicate: true,
        subtotal: won.subtotal, delivery: won.deliveryFee, discount: won.discount, loyaltyUsed: won.loyaltyUsed,
        deliveryDate: won.deliveryDate, deliverySlot: won.deliverySlot, priority: won.priority,
        loyaltyPending: 0, squadGoalHit: false, trackToken: orderTrackToken(won.id) };
    }
    if (idemKey && e && /duplicate key|23505/i.test(e.message || '')) {
      const won = await db.orders.findByClientRequestId(idemKey);
      if (won) return { ok: true, id: won.id, total: won.total, duplicate: true,
        deliveryDate: won.deliveryDate, deliverySlot: won.deliverySlot, priority: won.priority,
        loyaltyPending: 0, squadGoalHit: false, trackToken: orderTrackToken(won.id) };
    }
    throw e;
  }

  // ── Step 3: everything after the commit is BEST EFFORT ───────────────────
  // The order exists and the customer is owed it. None of the bookkeeping below
  // may turn that into a 500, because the client would report failure for a real
  // order and the customer's retry would create a duplicate.
  // Stock (audit C-10). A Paystack order already holds its stock from
  // checkout, so committing that hold is all that is left. A cash order was
  // consumed atomically in step 1 before the commit, so there is nothing to do
  // here. Either way the old best-effort read-modify-write is gone.
  if (stockHoldKey && await ownStockMode()) {
    try {
      const done = await db.stock.commitHold(stockHoldKey);
      if (!done || !Number(done.lines)) {
        // The hold lapsed before this arrived — Paystack retries a webhook for
        // hours, and the hold lives 15 minutes. The order is real and paid, so
        // deduct anyway; it may drive a line to zero, which is honest.
        console.warn('stock hold ' + stockHoldKey + ' had expired by commit time — deducting directly');
        await db.stock.consume(itemsList);
      }
    } catch (e) {
      console.error('STOCK COMMIT FAILED for order ' + created.id + ' (hold ' + stockHoldKey + '):', e.message);
      alertAdmins('stock-commit-failed', '⚠️ Stock not deducted for an order',
        'Order #' + created.id + ' was placed and paid, but its stock could not be deducted. Correct the count by hand.');
    }
  }
  if (userId && loc) {
    try { await db.addresses.markLastUsed(userId, loc, neighborhood); }
    catch (e) { console.warn('markLastUsed failed for order ' + created.id + ':', e.message); }
  }
  try { db.stats.invalidateDelivered(); } catch (_) {}
  // Ping admins so a new order is never missed.
  notifyAdmins({
    title: '🛒 New order #' + created.id,
    body: (customer || 'Customer') + ' · GHS ' + pricing.total + (neighborhood ? ' · ' + neighborhood : ''),
    url: '/admin', tag: 'admin-order-' + created.id,
  }).catch(() => {});
  return {
    ok: true, id: created.id, total: pricing.total,
    // The client renders the receipt and reports revenue from these, so the
    // full breakdown is returned rather than just the total (B-05).
    subtotal: pricing.subtotal, delivery: pricing.delivery,
    discount: pricing.discount, loyaltyUsed: pricing.loyaltyUsed,
    deliveryDate: deliveryDateStr, deliverySlot, priority,
    // Earned on DELIVERY now, not at checkout — see the rewards note above.
    // Projected so the success screen can say what is coming. Only the tier
    // credit is promised: the squad bonus also depends on other members and
    // could change before this order arrives, so it stays a surprise.
    // The GHS 50-per-1,000 tier was retired on 2026-09-03, so no order earns
    // credit at checkout any more. This must stay in lockstep with what
    // squads.recordSpend actually pays on delivery: promising a credit here
    // that never arrives is the same class of lie as B-01.
    loyaltyPending: 0,
    squadGoalHit: false,
    // Lets guests track this order later (stored client-side; see orderTrackToken)
    trackToken: orderTrackToken(created.id),
  };
}

// ── Daily revenue + rider cash reconciliation ────────────────────────────
// Splits a day's takings by how the money arrives, and — because cash is
// collected by hand — breaks the cash side down per rider. "Collected" counts
// only delivered orders, so the figure is what each rider should actually have
// handed in; anything still out is listed separately rather than being counted
// as revenue you hold.
app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? req.query.date : db.businessDate();
    const [dayOrders, riders] = await Promise.all([db.orders.forDay(date), db.riders.list()]);
    const riderName = new Map(riders.map((r) => [String(r.id), r.name]));

    const online = { count: 0, total: 0, orders: [] };
    const collected = { count: 0, total: 0 };
    const outstanding = { count: 0, total: 0 };
    const byRider = new Map();
    const bucket = (key, name) => {
      if (!byRider.has(key)) byRider.set(key, { riderId: key === 'unassigned' ? null : Number(key), name, collected: 0, collectedCount: 0, outstanding: 0, outstandingCount: 0 });
      return byRider.get(key);
    };

    for (const o of dayOrders) {
      const amount = Number(o.total || 0);
      if (o.paid) {
        online.count++; online.total += amount;
        online.orders.push({ id: o.id, total: amount, method: o.paymentMethod || 'paystack', customer: o.customerName || '' });
        continue;
      }
      const key = o.riderId != null ? String(o.riderId) : 'unassigned';
      const b = bucket(key, o.riderId != null ? (riderName.get(key) || 'Rider #' + o.riderId) : 'Not yet assigned');
      if (o.status === 'delivered') {
        collected.count++; collected.total += amount;
        b.collected += amount; b.collectedCount++;
      } else {
        outstanding.count++; outstanding.total += amount;
        b.outstanding += amount; b.outstandingCount++;
      }
    }
    const round = (n) => +Number(n).toFixed(2);
    res.json({
      date,
      online: { count: online.count, total: round(online.total), orders: online.orders.slice(0, 100) },
      cash: {
        collected: { count: collected.count, total: round(collected.total) },
        outstanding: { count: outstanding.count, total: round(outstanding.total) },
        byRider: [...byRider.values()]
          .map((b) => ({ ...b, collected: round(b.collected), outstanding: round(b.outstanding) }))
          .sort((a, b) => b.collected - a.collected),
      },
      totalTakings: round(online.total + collected.total),
      orderCount: dayOrders.length,
    });
  } catch (e) { fail(res, e, req); }
});

// Tracking is polled every few seconds per watching customer, and each response
// costs several sequential queries. A short server-side cache collapses a
// delivery window's worth of watchers onto one set of reads, without making the
// page feel stale — status changes are minutes apart, not seconds (D-03).
const _trackCache = new Map();
const TRACK_CACHE_MS = 5000;
async function getTrackingCached(orderId) {
  const key = String(orderId);
  const hit = _trackCache.get(key);
  if (hit && Date.now() - hit.at < TRACK_CACHE_MS) return hit.value;
  const value = await db.orders.getWithTracking(orderId);
  _trackCache.set(key, { value, at: Date.now() });
  // Bound the map so a long day of tracking cannot grow it without limit.
  if (_trackCache.size > 500) {
    const cutoff = Date.now() - TRACK_CACHE_MS;
    for (const [k, v] of _trackCache) if (v.at < cutoff) _trackCache.delete(k);
  }
  return value;
}

// ── Payment reconciliation ───────────────────────────────────────────────
// Answers "did Paystack take money we never turned into an order?" — the
// recovery path for a webhook or verify that failed. Each orphan is checked
// against Paystack itself so PAID (needs action) is separated from ABANDONED
// (customer never completed; safe to dismiss).
app.get('/api/admin/payments/orphans', requireAdmin, async (req, res) => {
  try {
    const orphans = await db.pendingPayments.listOrphans({
      olderThanMinutes: Math.max(1, parseInt(req.query.minutes, 10) || 15),
      limit: Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25)),
    });
    const out = [];
    for (const o of orphans) {
      let paid = null, paystackAmount = null, channel = null;
      if (PAYSTACK_SECRET_KEY) {
        try {
          const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(o.reference));
          if (ver && ver.status && ver.data) {
            paid = ver.data.status === 'success';
            paystackAmount = ver.data.amount != null ? ver.data.amount / 100 : null;
            channel = ver.data.channel || null;
          }
        } catch (_) { /* unknown — shown as such, never guessed */ }
      }
      const d = o.draft || {};
      out.push({
        reference: o.reference, createdAt: o.createdAt, userId: o.userId,
        amount: o.amount, paid, paystackAmount, channel,
        customer: d.customer || '', phone: d.phone || '',
        neighborhood: d.neighborhood || '', address: d.address || '',
        itemCount: Array.isArray(d.items) ? d.items.length : 0,
        items: Array.isArray(d.items) ? d.items.slice(0, 40).map((i) => ({ id: i.id, name: i.name || ('#' + i.id), qty: i.qty || 1 })) : [],
      });
    }
    res.json(out);
  } catch (e) { fail(res, e, req); }
});

// Turn a stranded draft into a real order — but ONLY after Paystack confirms
// the money was actually collected. Never create a free order by hand.
app.post('/api/admin/payments/orphans/:reference/recover', requireAdmin, async (req, res) => {
  const reference = req.params.reference;
  try {
    const existing = await db.orders.findByPaystackRef(reference);
    if (existing) return res.status(409).json({ error: 'An order already exists for this payment', id: existing.id });
    const pending = await db.pendingPayments.get(reference);
    if (!pending || !pending.draft) return res.status(404).json({ error: 'No stored draft for this reference' });
    if (!PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Paystack is not configured — cannot confirm payment' });
    const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(reference));
    if (!ver || !ver.status || !ver.data || ver.data.status !== 'success') {
      return res.status(400).json({ error: 'Paystack does not report this payment as successful — not recovering' });
    }
    const reqUser = pending.userId ? await db.users.get(pending.userId) : null;
    const result = await createOrderFromBody(reqUser, pending.draft, {
      paid: true, paystackRef: reference, locked: pending.draft._locked || null,
    });
    await db.pendingPayments.delete(reference);
    res.json({ ok: true, id: result.id, total: result.total });
  } catch (e) {
    // Admin-only diagnostic: the detail is what makes a stuck payment fixable,
    // so it is kept here rather than genericised — but it is now recorded too.
    console.error('orphan recovery failed for ' + reference + ':', e.message);
    db.errorLog.record({ message: 'orphan recovery failed for ' + reference + ': ' + e.message, stack: e.stack || '', path: '/api/admin/payments/orphans/recover', method: 'POST', status: 500, userId: req.user ? req.user.id : null }).catch(() => {});
    if (Sentry) { try { Sentry.captureException(e); } catch (_) {} }
    res.status(500).json({ error: e.message });
  }
});

// Discard an abandoned checkout. Refuses while Paystack still reports the
// payment as successful, so money that was taken cannot be tidied away.
app.delete('/api/admin/payments/orphans/:reference', requireAdmin, async (req, res) => {
  const reference = req.params.reference;
  try {
    if (PAYSTACK_SECRET_KEY) {
      const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(reference));
      if (ver && ver.status && ver.data && ver.data.status === 'success') {
        return res.status(409).json({ error: 'This payment succeeded — recover it into an order instead of dismissing it.' });
      }
    }
    const row = await db.pendingPayments.get(reference);
    if (row && row.draft && row.draft._reserved) await releaseReservation(row.draft._reserved);
    await db.pendingPayments.delete(reference);
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});

// ── Recurring orders (auto-reorder) ──────────────────────────────────────
// Places any recurring order whose next_run_at has arrived, reusing the same
// createOrderFromBody path as a normal Cash-on-Delivery checkout (so pricing,
// promos, loyalty, the 12pm cutoff, and first-order-free all apply exactly
// as they would if the customer checked out by hand). Runs once/day from
// runDailyJobs (see below) — there's no real cron on this host.
function serverOrderCode(id) { return 'SDG-' + String(id).replace(/\D/g, '').padStart(5, '0'); }
// ── Bulk-PII access log (audit H-04) ────────────────────────────────────
// There is one shared admin account, no roles, no 2FA and — until this — no
// record of who read what. Endpoints that return personal data for many
// customers at once now leave a trace. This is not a substitute for 2FA on
// the admin account, which remains the real answer given it can read every
// customer record; it is the minimum that makes an incident investigable.
async function logPiiAccess(req, what, count) {
  try {
    await db.errorLog.record({
      message: 'PII ACCESS: ' + what + ' — ' + count + ' record(s) read by user '
        + (req.user ? req.user.id : '?') + ' from ' + clientIp(req),
      path: 'audit', method: 'READ', status: 200,
      userId: req.user ? req.user.id : null,
    });
  } catch (_) { /* the read itself must not fail because the log did */ }
}

// ── Stuck-order watchdog (audit C-08) ───────────────────────────────────
// Assignment ran only as a side effect of a rider going online or polling,
// and returns immediately before noon. An order placed at 09:00 on a day when
// no rider signs in stayed queued forever: nothing alerted on age, nothing
// escalated, and the customer's tracking page showed the initial state
// indefinitely. This runs assignment from the daily job instead, then alerts
// on whatever is still sitting there.
const ORDER_SLA_HOURS = Number(process.env.ORDER_SLA_HOURS || 4);
async function checkStuckOrders() {
  // Try to place them first — an order that can be assigned should be, not
  // reported.
  try { await db.orders.assignQueuedForToday(); }
  catch (e) { console.warn('watchdog: assignQueuedForToday failed:', e.message); }

  const cutoff = new Date(Date.now() - ORDER_SLA_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await db.sb.from('orders')
    .select('id, created_at, status')
    .in('status', ['queued', 'assigned'])
    .lt('created_at', cutoff)
    .order('created_at')
    .limit(50);
  if (error) throw error;
  const stuck = data || [];
  if (!stuck.length) return { stuck: 0 };

  const oldestHours = Math.round((Date.now() - new Date(stuck[0].created_at).getTime()) / 36e5);
  await alertAdmins('orders-stuck',
    '⚠️ ' + stuck.length + ' order(s) not moving',
    stuck.length + ' order(s) past ' + ORDER_SLA_HOURS + 'h. Oldest: #' + stuck[0].id + ', ' + oldestHours + 'h old. Assign a rider.',
    '/?admin=1');
  return { stuck: stuck.length, oldestId: stuck[0].id, oldestHours };
}

async function runRecurringOrders() {
  const today = db.businessDate();
  let due = [];
  try {
    const { data, error } = await db.sb.from('recurring_orders')
      .select('*').eq('active', true).lte('next_run_at', today);
    if (error) throw error;
    due = db.rowsOut(data || []);
  } catch (e) {
    console.warn('runRecurringOrders: query failed:', e.message);
    return;
  }
  if (!due.length) return;

  let products = [];
  try { products = await db.products.list(); } catch (e) { console.warn('runRecurringOrders: products.list failed:', e.message); return; }
  const byId = new Map(products.map((p) => [p.id, p]));

  // One query for every customer in the batch instead of one per due row
  // (audit D-09). This job already loads the whole catalogue once for the
  // same reason.
  let usersById = new Map();
  try {
    const people = await db.users.listByIds(due.map((r) => r.userId));
    usersById = new Map(people.map((u) => [String(u.id), u]));
  } catch (e) { console.warn('runRecurringOrders: users.listByIds failed:', e.message); return; }

  for (const r of due) {
    try {
      const user = usersById.get(String(r.userId));
      if (!user) { // account deleted — stop retrying this row forever
        await db.recurring.setActive(r.id, r.userId, false).catch(() => {});
        continue;
      }

      // Drop items no longer sold or marked "Sold out" (stock 0 is the
      // deliberate unavailable-flag in BOTH partner-supply and own-stock
      // mode — see the product-page stock-display toggle work).
      const validItems = [];
      const skippedNames = [];
      for (const it of (r.items || [])) {
        const p = byId.get(it.id);
        if (!p || (p.stock || 0) <= 0) { skippedNames.push((p && p.name) || it.name || `#${it.id}`); continue; }
        validItems.push({ id: it.id, qty: it.qty || 1 });
      }

      // Advance the schedule regardless of outcome — a bad run must not
      // retry forever and spam the customer daily.
      const nextRun = db.businessDatePlus(Math.max(1, Number(r.cadenceDays) || 14));
      await db.sb.from('recurring_orders').update({ next_run_at: nextRun }).eq('id', r.id);

      if (!validItems.length) {
        await pushToUser(user.id, {
          title: '⏸ Auto-reorder skipped',
          body: 'None of your saved items are available right now, so we skipped this round. We\'ll try again next time — or reorder manually anytime.',
          url: '/',
        });
        continue;
      }

      const info = r.deliveryInfo || {};
      // Auto-reorder is always Cash on Delivery — there's no saved card/MoMo
      // to charge automatically (Paystack only supports one-off popups), even
      // if the original order was paid online.
      const draft = {
        customer: user.name || '', phone: user.phone || '',
        neighborhood: info.neighborhood || '', address: info.address || '',
        items: validItems, payMethod: 'cash', location: info.location || null,
      };
      const result = await createOrderFromBody(user, draft, {});
      const skippedNote = skippedNames.length ? ` (skipped ${skippedNames.length} unavailable item${skippedNames.length === 1 ? '' : 's'})` : '';
      await pushToUser(user.id, {
        title: '🔁 Auto-reorder placed',
        body: `Your recurring order ${serverOrderCode(result.id)} was placed — pay on delivery${skippedNote}.`,
        url: `/?track=${result.id}`,
        tag: `order-${result.id}`,
      });
    } catch (e) {
      console.warn(`runRecurringOrders: row ${r.id} failed:`, e.message);
      db.errorLog.record({ message: 'recurring order failed: ' + e.message, stack: e.stack || '', path: `recurring_orders/${r.id}`, method: 'CRON', userId: r.userId });
    }
  }
}

app.post('/api/orders', rateLimitIp('orders', LIMIT_ORDERS), async (req, res) => {
  try {
    const result = await createOrderFromBody(req.user, req.body, { paid: false });
    res.status(201).json(result);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, unavailable: e.unavailable || [] });
    console.error('order create failed:', e);
    await db.errorLog.record({ message: 'order create failed: ' + e.message, stack: e.stack || '', path: '/api/orders', method: 'POST', status: 500, userId: req.user ? req.user.id : null });
    res.status(500).json({ error: 'We could not place your order. Please try again.' });
  }
});

app.put('/api/orders/:id', requireAdmin, async (req, res) => {
  try { await db.orders.update(req.params.id, req.body || {}); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

app.get('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const o = await db.orders.get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    res.json(o);
  } catch (e) { fail(res, e, req); }
});

// Admin: delete an order
app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  try { await db.sb.from('orders').delete().eq('id', req.params.id); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// ── Paystack: online payment (card + mobile money) ───────────────────────
// Whether online payment is available (used by the client to show/hide it).
app.get('/api/paystack/config', (req, res) => {
  res.json({ enabled: !!(PAYSTACK_SECRET_KEY && PAYSTACK_PUBLIC_KEY), publicKey: PAYSTACK_PUBLIC_KEY || null });
});

// 1) Initialize a transaction. Server sets the amount + reference (locked in
//    Paystack) and stashes the order draft so the order is only created after
//    payment is confirmed.
app.post('/api/paystack/init', rateLimitIp('payinit', LIMIT_PAYMENT), async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Online payment is not configured' });
  if (!(await switchOn('online_payment_enabled'))) return res.status(503).json({ error: 'Online payment is temporarily unavailable — please choose Cash on Delivery.' });
  if (!(await switchOn('ordering_enabled'))) return res.status(503).json({ error: 'We have paused new orders for a short while. Please try again soon.' });
  const { email, draft } = req.body || {};
  if (!draft || !Array.isArray(draft.items) || !draft.items.length) return res.status(400).json({ error: 'Empty order' });
  // Amount is computed server-side from the cart — never trust the client amount.
  // Give this customer back anything they reserved on a checkout they walked
  // away from, before pricing the new one.
  await releaseStaleReservations(req.user ? req.user.id : null);
  // Validate before charging: taking money for an order that cannot be created
  // is the worst possible ordering of these two steps.
  try { validateDelivery(draft); }
  catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message, missing: e.missing || [] }); throw e; }
  let pricing;
  try { pricing = await computeOrderPricing(req.user, draft); }
  catch (e) { if (e && e.status) return res.status(e.status).json({ error: e.message, unavailable: e.unavailable || [] }); throw e; }
  // Resolve the birthday gift here too, so the locked item list is complete.
  let giftYear = null;
  if (req.user && draft.birthdayGift) {
    const { cfg, eligible, year } = await birthdayGiftStatus(req.user);
    const gid = parseInt(draft.birthdayGift, 10);
    if (eligible && (cfg.productIds || []).map(Number).includes(gid)) {
      const gp = await db.products.get(gid);
      if (gp) { pricing.items.push({ id: gp.id, name: gp.name, category: gp.category, unit: gp.unit, qty: 1, price: 0, birthdayGift: true }); giftYear = year; }
    }
  }
  const ghs = pricing.total;
  if (!(ghs > 0)) return res.status(400).json({ error: 'Invalid amount' });
  const customerEmail = (email && /\S+@\S+\.\S+/.test(email)) ? email
    : (req.user && req.user.email) ? req.user.email
    : `guest_${Date.now()}@guest.sdgmart.app`;
  const reference = 'SDG_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try {
    const init = await paystackApi('/transaction/initialize', 'POST', {
      email: customerEmail,
      amount: Math.round(pricing.total * 100), // pesewas — the reserved-adjusted total
      currency: 'GHS',
      reference,
      channels: ['mobile_money', 'card'],
      // Last-resort recovery copy: if our pending_payments draft is ever lost,
      // the order can still be reconstructed from Paystack's own record.
      metadata: {
        order_for: draft.customer || '', phone: draft.phone || '',
        neighborhood: draft.neighborhood || '',
        items: (pricing.items || []).map((i) => i.id + 'x' + i.qty).join(',').slice(0, 900),
      },
    });
    // 422, not 502. Reaching here means Paystack ANSWERED and refused — an
    // unreachable or slow provider throws out of paystackApi instead and becomes
    // a 500. So this is a caller-fixable rejection ("Invalid Email Address
    // Passed", a bad amount), and it must not be a 5xx: Cloudflare replaces 5xx
    // bodies with its own plain-text page, so the message never reached the
    // customer. Worse, the client does `await initRes.json()` on that page,
    // which throws, dropping it into the generic catch — the shopper was told
    // "Check your connection and try again" for an email typo. A 4xx passes
    // through Cloudflare intact and the client alerts the real reason.
    if (!init || !init.status || !init.data) return res.status(422).json({ error: (init && init.message) || 'Could not start payment' });
    // Take the value NOW, while the price is locked and before the customer is
    // charged, so a second checkout cannot spend the same credit. Released by
    // releaseStaleReservations() / the verify failure path if they never pay.
    let reserved;
    try {
      reserved = await reserveForCheckout(req.user, pricing, giftYear);
    } catch (e) {
      return res.status(409).json({ error: e.message || 'Could not hold your credit — please try again' });
    }
    // Hold the stock too, for as long as the payment window (audit C-10).
    // This is the "hold at checkout, not at cart" line: the customer is on the
    // payment step, not browsing. The hold is keyed on the Paystack reference,
    // so every path that already knows how to abandon or complete this payment
    // knows how to release or commit the stock.
    if (await ownStockMode()) {
      try {
        const held = await db.stock.hold(pricing.items, reference, db.stock.TTL_MIN);
        if (!held.ok) {
          await releaseReservation(reserved);   // hand the credit straight back
          const names = await namesForShortfalls(held.shortfalls);
          return res.status(409).json({
            error: 'Someone just took the last of ' + names + '. Your cart has not been charged.',
            unavailable: held.shortfalls || [],
          });
        }
        reserved.stockHoldKey = reference;
      } catch (e) {
        // Own-stock mode is on but the reservation functions are unreachable.
        // Do not silently sell stock we cannot account for.
        await releaseReservation(reserved);
        console.error('STOCK HOLD FAILED at checkout:', e.message);
        alertAdmins('stock-hold-failed', '⚠️ Stock reservations are failing',
          'Own-stock mode is on but holds could not be taken. Checkout is refusing online payment. Run supabase-schema-stock-holds.sql or turn own-stock mode off.');
        return res.status(503).json({ error: 'We could not confirm stock just now. Please try again in a moment.' });
      }
    }
    const lockedDraft = { ...draft, _reserved: reserved, _locked: { pricing, giftYear } };
    try {
      await db.pendingPayments.create(reference, req.user ? req.user.id : null, lockedDraft, pricing.total);
    } catch (e) {
      await releaseReservation(reserved);   // nothing is charged yet — give it straight back
      throw e;
    }
    res.json({ reference, accessCode: init.data.access_code, publicKey: PAYSTACK_PUBLIC_KEY });
  } catch (e) { console.error('paystack init failed:', e.message); res.status(500).json({ error: 'Payment init failed' }); }
});

// 2) Verify a transaction and create the order (idempotent).
// The charge and the stored order must agree. Shared by BOTH paths that can
// create a paid order, because this check used to live only inside /verify —
// so an order created by the WEBHOOK was never reconciled against what Paystack
// actually took. That is the wrong way round: the webhook is the path that runs
// precisely when the customer closed their tab and nobody is watching a screen.
// Keeping one implementation is what stops the two drifting apart again.
// Never throws: a mismatch is a business alarm, not a delivery failure, and the
// webhook must still be able to ACK so Paystack stops retrying.
async function assertChargeMatchesOrder(reference, amountPesewas, order, path) {
  const charged = amountPesewas != null ? amountPesewas / 100 : null;
  if (charged == null) return;
  const total = Number((order && order.total) || 0);
  if (Math.abs(charged - total) <= 0.005) return;
  const msg = 'PAYMENT MISMATCH — ref ' + reference + ' charged GHS ' + charged.toFixed(2)
    + ' but order ' + (order && order.id) + ' totals GHS ' + total.toFixed(2);
  console.error(msg);
  try { await db.errorLog.record({ message: msg, path, method: 'POST', status: 500 }); } catch (_) {}
  // Money actually changed hands for a different amount than the order says.
  // Never let this sit only in a log (audit G-08).
  alertAdmins('payment-mismatch', '⚠️ Payment amount mismatch',
    'A charge does not match its order total. Check Admin → Errors now.', '/?admin=1');
  if (Sentry) { try { Sentry.captureException(new Error(msg)); } catch (_) {} }
  notifyAdmins({ title: '⚠️ Payment mismatch', body: msg.slice(0, 120), url: '/admin', tag: 'admin-mismatch-' + reference }).catch(() => {});
}

app.post('/api/paystack/verify', async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: 'Missing reference' });
  try {
    // Already created (e.g. webhook beat us to it)? Return it.
    const existing = await db.orders.findByPaystackRef(reference);
    if (existing) return res.json({ ok: true, id: existing.id, already: true });

    const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(reference));
    if (!ver || !ver.status || !ver.data || ver.data.status !== 'success') {
      // Not paid: hand back the loyalty and perks reserved at init straight
      // away, rather than leaving the customer's credit locked up.
      const failed = await db.pendingPayments.get(reference);
      if (failed && failed.draft && failed.draft._reserved) {
        await releaseReservation(failed.draft._reserved);
        await db.pendingPayments.delete(reference);
      }
      return res.status(400).json({ error: 'Payment was not completed' });
    }
    const pending = await db.pendingPayments.get(reference);
    const draft = (pending && pending.draft) || req.body.draft;
    if (!draft) return res.status(400).json({ error: 'Order details not found' });
    const reqUser = pending && pending.userId ? await db.users.get(pending.userId) : req.user;
    // Use the price locked at init — never recompute against a catalogue that
    // may have changed while the customer was approving on their phone (C-07).
    const result = await createOrderFromBody(reqUser, draft, {
      paid: true, paystackRef: reference, locked: draft._locked || null,
    });
    // The charge and the stored order must agree. If they ever diverge, say so
    // loudly rather than letting it settle quietly into the books.
    await assertChargeMatchesOrder(reference, ver.data.amount, result, '/api/paystack/verify');
    await db.pendingPayments.delete(reference);
    res.json(result);
  } catch (e) { fail(res, e, req, '/api/paystack/verify'); }
});

// 3) Webhook safety net — if the customer paid but never hit verify (closed
//    tab / lost connection), Paystack still notifies us and we create the order.
app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const crypto = require('crypto');
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.rawBody || Buffer.from('')).digest('hex');
    if (!signature || hash !== signature) return res.sendStatus(401);
    const event = req.body;
    if (event && event.event === 'charge.success' && event.data && event.data.reference) {
      const ref = event.data.reference;
      const existing = await db.orders.findByPaystackRef(ref);
      if (!existing) {
        const pending = await db.pendingPayments.get(ref);
        if (pending && pending.draft) {
          const reqUser = pending.userId ? await db.users.get(pending.userId) : null;
          const created = await createOrderFromBody(reqUser, pending.draft, {
            paid: true, paystackRef: ref, locked: pending.draft._locked || null,
          });
          // Reconcile the charge here too. This path runs when the customer's
          // tab closed, so a wrong amount would otherwise reach the books with
          // nobody looking at a screen to notice it.
          await assertChargeMatchesOrder(ref, event.data.amount, created, '/api/paystack/webhook');
          await db.pendingPayments.delete(ref);
          // Record that the SAFETY NET caught this one. Nothing else
          // distinguishes an order the webhook rescued from one /verify created
          // normally — the rows are identical — so "did the net actually fire?"
          // was unanswerable without going to Paystack's own delivery log. This
          // is the only trace, and it is the point of E-01: a net you cannot
          // observe is a net you cannot trust. Status 200, not an error: this
          // is the system working, and it should read that way in Admin → Errors.
          db.errorLog.record({
            message: 'WEBHOOK RESCUE — order ' + created.id + ' was created by the Paystack webhook, '
              + 'not by /verify. The customer closed the tab or lost connection before confirming; '
              + 'ref ' + ref + ', GHS ' + Number(created.total || 0).toFixed(2) + '.',
            path: '/api/paystack/webhook', method: 'POST', status: 200,
          }).catch(() => {});
        } else {
          // Paid, but the draft is gone and no order exists — a retry can never
          // fix this, so we still ACK (200 below) to stop Paystack looping on
          // something unrecoverable. This needs a human: the customer has been
          // charged and has no order. Make it impossible to miss.
          const msg = 'PAID BUT NO ORDER — Paystack ref ' + ref + ' has no pending draft and no order. Customer was charged; refund or create the order manually.';
          console.error(msg);
          await db.errorLog.record({ message: msg, path: '/api/paystack/webhook', method: 'POST', status: 500 });
          if (Sentry) { try { Sentry.captureException(new Error(msg)); } catch (_) {} }
          notifyAdmins({ title: '⚠️ Paid but no order', body: 'Ref ' + ref + ' — customer charged, no order created. Check Admin → Errors.', url: '/admin', tag: 'admin-payment-orphan-' + ref }).catch(() => {});
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    // MUST be 500, never 200. A 2xx tells Paystack the event was durably
    // handled and it will never resend it — silently losing a paid order on a
    // transient failure (DB blip, timeout). A 500 makes Paystack retry on its
    // own backoff schedule, which recovers exactly those cases.
    // Safe to retry: the findByPaystackRef guard above means a retry that
    // arrives after the order was created finds it and skips.
    console.error('paystack webhook error:', e.message);
    await db.errorLog.record({
      message: 'paystack webhook failed (Paystack will retry): ' + e.message,
      stack: e.stack || '', path: '/api/paystack/webhook', method: 'POST', status: 500,
    });
    // Paystack retries, so one of these is not an emergency — a run of them
    // means paid orders are not landing (audit G-08).
    alertAdmins('webhook-error', '⚠️ Paystack webhook failing',
      'Payments may not be turning into orders. Check Admin → Reconcile and Errors.', '/?admin=1');
    if (Sentry) { try { Sentry.captureException(e); } catch (_) {} }
    res.sendStatus(500);
  }
});

// Admin: manually assign (or reassign / unassign) an order to a rider
app.post('/api/admin/orders/:id/assign', requireAdmin, async (req, res) => {
  const { riderId } = req.body || {};
  try {
    const o = await db.orders.assignToRider(req.params.id, riderId || null);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    // Notify the customer their order has a rider
    if (riderId && o.userId) {
      pushToUser(o.userId, {
        title: '🛵 Rider assigned',
        body: 'A rider has been assigned to your order and will be on the way soon.',
        url: `/?track=${o.id}`, tag: `order-${o.id}`,
      });
    }
    res.json(o);
  } catch (e) { fail(res, e, req); }
});

// ── Auth: signup / login / logout / me ───────────────────────────────────
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, password_hash, password, ...rest } = u;
  return rest;
}

app.post('/api/auth/signup', rateLimitIp('signup', LIMIT_SIGNUP), async (req, res) => {
  const { name, email, phone, password, refCode, acceptedTerms } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  // Enforced server-side, not only in the form: the record of consent is
  // worthless if a direct POST can skip it (audit H-03).
  if (!acceptedTerms) return res.status(400).json({ error: 'You must accept the Privacy Notice and Terms to create an account.' });
  const pwErr = db.validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    // Reject duplicate email up front for a clean error
    const existing = await db.users.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });
    // The server's own TERMS_VERSION, never the client's claim about what it
    // displayed — otherwise the record says whatever the caller wanted.
    const u = await db.users.create({ name, email, phone, password, refCode, role: 'customer', termsVersion: TERMS_VERSION });
    // Email verification is disabled — accounts are usable immediately. Mark
    // verified so no banner/gate ever appears.
    // This used to swallow the failure and tell the client emailVerified:true
    // regardless, so the account and the response disagreed from the first
    // second (audit E-10). Report what the database actually holds.
    let verified = false;
    try { await db.users.markEmailVerified(u.id); verified = true; }
    catch (e) { console.error('signup: markEmailVerified failed for user ' + u.id + ':', e.message); }
    u.emailVerified = verified;
    const token = await db.sessions.create(u.id);
    res.status(201).json({ user: publicUser(u), token, message: 'Account created — welcome to SDGMart!' });
  } catch (e) { fail(res, e, req, '/api/auth/signup'); }
});

const LOGIN_LIMIT = { windowMs: 5 * 60 * 1000, max: 5, blockMs: 15 * 60 * 1000 };
const LOGIN_IP_LIMIT = { windowMs: 15 * 60 * 1000, max: 50, blockMs: 15 * 60 * 1000 };

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const ip = clientIp(req);
  const key = `login:${ip}:${String(email).toLowerCase()}`;
  // The per-account bucket alone gave spraying — one common password against
  // thousands of accounts — a fresh allowance for every address tried, so it
  // was never throttled at all (audit A-13). The IP bucket is what catches
  // that; it is set well above what a household on one NAT address needs.
  const ipRl = db.rateCheck(`login-ip:${ip}`, LOGIN_IP_LIMIT);
  if (!ipRl.allowed) {
    res.set('Retry-After', String(Math.ceil(ipRl.retryAfterMs / 1000)));
    return res.status(429).json({ error: `Too many sign-in attempts from this connection. Try again in ${Math.ceil(ipRl.retryAfterMs / 60000)} minute(s).` });
  }
  const rl = db.rateCheck(key, LOGIN_LIMIT);
  if (!rl.allowed) {
    res.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} minute(s).` });
  }
  try {
    // Try customer/admin first, then rider
    let u = await db.users.verifyCredentials(email, password);
    let userType = 'user';
    if (!u) {
      const r = await db.riders.verifyCredentials(email, password);
      if (r) { u = { ...r, role: 'rider' }; userType = 'rider'; }
    }
    if (!u) return res.status(401).json({ error: 'Wrong email or password' });
    db.rateClear(key);
    const token = await db.sessions.create(u.id, userType);
    res.json({ user: publicUser(u), token });
  } catch (e) { fail(res, e, req, '/api/auth/login'); }
});

app.post('/api/auth/logout', async (req, res) => {
  if (req.token) await db.sessions.destroy(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

app.post('/api/auth/google', async (req, res) => {
  const client = getGoogleClient();
  if (!client) return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  const { credential, refCode } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) return res.status(400).json({ error: 'Google did not return a verified email' });
    const u = await db.users.findOrCreateGoogle({ email: payload.email, name: payload.name || payload.given_name || 'Google User', googleId: payload.sub, picture: payload.picture, refCode });
    const token = await db.sessions.create(u.id);
    res.json({ user: publicUser(u), token });
  } catch (e) { console.error('Google verify failed:', e.message); res.status(401).json({ error: 'Invalid or expired Google token' }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => { res.json(publicUser(req.user)); });

app.get('/api/auth/verify', async (req, res) => {
  const result = await db.consumeEmailToken(req.query.token, 'verify');
  if (!result) return res.status(400).send('Verification link is invalid or expired.');
  await db.users.markEmailVerified(result.userId);
  res.send('<h2 style="font-family:sans-serif;max-width:480px;margin:60px auto;color:#000">✅ Email verified.</h2><p style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#666">You can return to SDGMart and continue shopping.</p>');
});

app.post('/api/auth/resend-verification', requireAuth, customerOnly, async (req, res) => {
  if (req.user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const verifyToken = await db.makeEmailToken(req.user.id, 'verify');
  const verifyLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${verifyToken}`;
  const emailResult = await sendEmail({
    to: req.user.email,
    subject: 'Verify your SDGMart email',
    html: emailLayout({
      title: 'Verify your email',
      intro: 'You asked us to re-send your verification link. Tap below to verify (expires in 24h).',
      cta: 'Verify my email', ctaUrl: verifyLink,
    }),
    text: `Verify your email: ${verifyLink}`,
  });
  if (emailResult.skipped) console.log(`✉️  (no email config) re-sent for ${req.user.email}: ${verifyLink}`);
  if (emailResult.skipped && process.env.NODE_ENV !== 'production') console.log('[dev] verification link:', verifyLink);
  res.json({ ok: true, emailSent: !!emailResult.ok });
});

// ── Password reset ───────────────────────────────────────────────────────
// Every exit from forgot-password returns THIS, byte for byte. mailDegraded
// is a property of the mail system, identical for an address that exists and
// one that does not — the moment one branch returns something another does
// not, the route is an account-enumeration oracle again (audit A-11, E-09).
function forgotPasswordBody() {
  return mailDegraded() ? { ok: true, mailDegraded: true } : { ok: true };
}

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Rate-limit per email
  const rl = db.rateCheck(`reset:${String(email).toLowerCase()}`, { windowMs: 60 * 60 * 1000, max: 5, blockMs: 60 * 60 * 1000 });
  if (!rl.allowed) return res.json(forgotPasswordBody()); // Silent rate-limit (don't leak)
  try {
    // Customers first, then riders. A rider's address was never looked up at
    // all, so their reset silently matched nothing and they had no way back
    // into their account.
    //
    // The token PURPOSE carries the account type, and that is load-bearing:
    // `email_tokens` records only a bare user_id, and riders and customers
    // share an id space (the A-01 finding). A token minted for rider #5 under
    // the plain 'reset' purpose would reset CUSTOMER #5's password. Scoping it
    // to 'reset-rider' makes the two token families unable to resolve to each
    // other's table — consumeEmailToken already refuses on a purpose mismatch,
    // and refuses without consuming, so the reset route can try both in turn.
    let account = await db.users.findByEmail(email);
    let purpose = 'reset';
    if (!account) {
      account = await db.riders.findByEmail(email);
      purpose = 'reset-rider';
    }
    // Respond OK even when the email doesn't exist (don't leak which addresses are registered)
    if (!account) return res.json(forgotPasswordBody());
    const u = account;
    const token = await db.makeEmailToken(u.id, purpose, purpose === 'reset-rider');
    const link = `${req.protocol}://${req.get('host')}/?reset=${token}`;
    const emailResult = await sendEmail({
      to: u.email,
      subject: 'Reset your SDGMart password',
      html: emailLayout({
        title: 'Reset your password',
        intro: 'Tap below to choose a new password. This link expires in 24 hours. If you didn\'t request this, ignore the email — your current password stays unchanged.',
        cta: 'Set a new password', ctaUrl: link,
      }),
      text: `Reset your SDGMart password: ${link}`,
    });
    if (emailResult.skipped) console.log(`🔑 (no email config) reset for ${u.email}: ${link}`);
    if (emailResult.error) {
      try {
        await db.errorLog.record({
          message: 'password reset email FAILED (user cannot recover their account): ' + emailResult.error,
          path: '/api/auth/forgot-password', method: 'POST', status: 502, userId: u.id,
        });
      } catch (_) {}
    }
    // Returning the link when RESEND_API_KEY is unset made forgot-password an
    // unauthenticated password-reset oracle for any address, including admin.
    if (emailResult.skipped && process.env.NODE_ENV !== 'production') console.log('[dev] password reset link:', link);
    // Identical to the not-found and rate-limited branches above: three
    // distinguishable responses were themselves an account-enumeration oracle.
    // mailDegraded() is deliberately a property of the mail system, not of
    // this address — it reads the same for an address that does not exist, so
    // it tells an honest story without reopening A-11.
    res.json(forgotPasswordBody());
  } catch (e) { fail(res, e, req, '/api/auth/forgot-password'); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  const pwErr = db.validatePasswordStrength(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    // Try the customer family first, then the rider one. consumeEmailToken
    // refuses a purpose mismatch WITHOUT consuming the token, so the failed
    // first attempt cannot burn a rider's link. The purpose is what decides
    // which table is written — never the id, which both tables share.
    let result = await db.consumeEmailToken(token, 'reset');
    let isRider = false;
    if (!result) {
      result = await db.consumeEmailToken(token, 'reset-rider');
      isRider = !!result;
    }
    if (!result) return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    if (isRider) {
      // riderId, never userId: the two columns are what keep the id spaces apart.
      await db.riders.changePassword(result.riderId, newPassword);
      await db.sessions.destroyAllForUser(result.riderId, 'rider');
    } else {
      await db.users.changePassword(result.userId, newPassword);
      await db.sessions.destroyAllForUser(result.userId);
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e, req, '/api/auth/reset-password'); }
});

// customerOnly (not just requireAuth): riders have their own id space, so a
// rider reaching db.users.changePassword(req.user.id) would overwrite the
// UNRELATED customer holding that same numeric id.
app.post('/api/auth/change-password', requireAuth, customerOnly, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (!(await db.verifyPassword(currentPassword, req.user.passwordHash))) return res.status(401).json({ error: 'Current password is incorrect' });
  const pwErr = db.validatePasswordStrength(newPassword, { isAdminChange: req.user.role === 'admin' });
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    await db.users.changePassword(req.user.id, newPassword);
    await db.sessions.destroyAllForUser(req.user.id);
    const token = await db.sessions.create(req.user.id);
    res.json({ ok: true, token });
  } catch (e) { fail(res, e, req); }
});

// The rider counterpart. Deliberately a SEPARATE route rather than relaxing
// customerOnly above: that guard exists because riders and customers share an
// id space, so one handler serving both is exactly the shape that produced
// A-01. This one only ever writes to `riders`, keyed on a rider session.
app.post('/api/rider/change-password', riderOnly, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (!(await db.verifyPassword(currentPassword, req.user.passwordHash))) return res.status(401).json({ error: 'Current password is incorrect' });
  const pwErr = db.validatePasswordStrength(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    await db.riders.changePassword(req.user.id, newPassword);
    // Every other device holding the old password is signed out, then this one
    // gets a fresh session so the rider is not kicked out mid-delivery.
    await db.sessions.destroyAllForUser(req.user.id, 'rider');
    const token = await db.sessions.create(req.user.id, 'rider');
    res.json({ ok: true, token });
  } catch (e) { fail(res, e, req); }
});

app.get('/api/users/:id', requireAuth, customerOnly, async (req, res) => {
  if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const u = await db.users.get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json(publicUser(u));
  } catch (e) { fail(res, e, req); }
});

app.get('/api/squads/:userId', requireAuth, customerOnly, async (req, res) => {
  if (String(req.user.id) !== String(req.params.userId) && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const u = await db.users.get(req.params.userId);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const members = (await db.squads.members(u.squadCode)).map(m => ({
      id: m.id, name: m.name, totalSpent: m.totalSpent || 0, discountPending: !!m.discountPending, isYou: m.id === u.id,
    }));
    res.json({ me: publicUser(u), referralCode: u.refCode, squadCode: u.squadCode, members, goal: 500 });
  } catch (e) { fail(res, e, req); }
});

// ── Persistent cart (signed-in; a customer's cart follows them across devices) ──
// ── Data-subject requests (audit H-01) ───────────────────────────────────
// The privacy notice promises both of these; neither existed.
app.get('/api/me/export', requireAuth, async (req, res) => {
  try {
    const data = await db.dataRequests.exportForUser(req.user.id);
    if (!data) return res.status(404).json({ error: 'Account not found' });
    res.setHeader('Content-Disposition', 'attachment; filename="sdgmart-my-data.json"');
    res.json(data);
  } catch (e) { fail(res, e, req, '/api/me/export'); }
});

// Erasure is irreversible, so it requires the account password — or, for a
// Google-only account with no password set, an explicit typed confirmation.
app.post('/api/me/delete-account', requireAuth, async (req, res) => {
  const { password, confirm } = req.body || {};
  try {
    const hasPassword = !!req.user.passwordHash;
    if (hasPassword) {
      if (!password || !(await db.verifyPassword(password, req.user.passwordHash))) {
        return res.status(401).json({ error: 'Password is incorrect' });
      }
    } else if (String(confirm || '').trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm' });
    }
    await db.dataRequests.eraseUser(req.user.id);
    console.warn('account erased on request: user ' + req.user.id);
    res.json({ ok: true });
  } catch (e) { fail(res, e, req, '/api/me/delete-account'); }
});

app.get('/api/me/cart', requireAuth, async (req, res) => {
  try { res.json({ items: await db.carts.get(req.user.id) }); }
  catch (e) { fail(res, e, req); }
});
app.put('/api/me/cart', requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 100) : [];
    await db.carts.save(req.user.id, items);
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});

// ── Web Push ─────────────────────────────────────────────────────────────
let webpush = null;
try { webpush = require('web-push'); } catch (_) { console.warn('⚠️  web-push not installed — push notifications disabled'); }
let VAPID = null;

async function pushToUser(userId, payload) {
  if (!webpush || !VAPID) return;
  try {
    const subs = await db.pushSubs.forUser(userId);
    await Promise.all(subs.map(async (sub) => {
      try {
        await withTimeout(webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload)), 10000, 'push send');
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubs.remove(sub.endpoint);
        else console.warn('push send failed:', e.statusCode, e.body);
      }
    }));
  } catch (e) { console.warn('pushToUser failed:', e.message); }
}

// Notify every admin's subscribed devices of an event needing attention.
// Fire-and-forget from handlers so it never slows a customer's request down.
async function notifyAdmins(payload) {
  try {
    const { data } = await db.sb.from('users').select('id').eq('role', 'admin');
    await Promise.all((data || []).map((a) => pushToUser(a.id, payload)));
  } catch (e) { console.warn('notifyAdmins failed:', e.message); }
}

// ── Operational alerting (audit G-08, E-09, C-08) ───────────────────────
// notifyAdmins fired on a new order, an order issue, feedback and a product
// request — every routine success, and nothing at all on failure. These are
// the failures that cost money or silently strand a customer.
//
// Deduplicated: an outage produces the same alert continuously, and a phone
// buzzing every thirty seconds gets muted, which is worse than no alert.
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const _alertSentAt = new Map();
async function alertAdmins(key, title, body, url) {
  const now = Date.now();
  if (now - (_alertSentAt.get(key) || 0) < ALERT_COOLDOWN_MS) return false;
  _alertSentAt.set(key, now);
  console.error('ADMIN ALERT [' + key + '] ' + title + ' — ' + body);
  try {
    await db.errorLog.record({
      message: 'ALERT ' + key + ': ' + title + ' — ' + body,
      path: 'alert', method: 'ALERT', status: 500,
    });
  } catch (_) {}
  try { await notifyAdmins({ title, body, url: url || '/?admin=1' }); } catch (_) {}
  return true;
}

// Whether transactional email is currently working. Tracked globally, never
// per address: the point of E-09 is to tell people the mail system is down
// without telling an attacker which addresses exist (A-11).
const _mail = { consecutiveFailures: 0, lastFailureAt: 0 };
const MAIL_DEGRADED_AFTER = 2;
const MAIL_DEGRADED_WINDOW_MS = 15 * 60 * 1000;
function recordMailResult(ok) {
  if (ok) { _mail.consecutiveFailures = 0; return; }
  _mail.consecutiveFailures += 1;
  _mail.lastFailureAt = Date.now();
}
function mailDegraded() {
  return _mail.consecutiveFailures >= MAIL_DEGRADED_AFTER
    && Date.now() - _mail.lastFailureAt < MAIL_DEGRADED_WINDOW_MS;
}

// Lightweight daily job runner. There is no cron on this host, so it runs
// opportunistically on /healthz pings (UptimeRobot hits it every 5 min) and is
// guarded by an app_config date-marker so the work happens at most once a day.
let _dailyJobRunning = false;
async function runDailyJobs() {
  // Set synchronously, BEFORE any await. The old order set this flag after the
  // config read, so two concurrent /healthz hits both got past it.
  if (_dailyJobRunning) return;
  _dailyJobRunning = true;
  const today = db.businessDate();
  try {
    // Claim the day in the database, not in memory. The in-process flag only
    // guards one process; this is what actually decides the winner when
    // UptimeRobot and a real visitor arrive together, or when there is ever
    // more than one instance. Exactly one caller gets true (A-08).
    if (!(await db.appConfig.claim('daily_job_last_run', today))) { _dailyJobRunning = false; return; }
    // Release loyalty held by checkouts nobody came back to. releaseStale-
    // Reservations covers the customer who returns; this covers the one who
    // never does, so their credit is not locked up indefinitely.
    try {
      const abandoned = await db.pendingPayments.listOrphans({ olderThanMinutes: 24 * 60, limit: 50 });
      for (const row of abandoned) {
        if (!row.draft || !row.draft._reserved) continue;
        if (PAYSTACK_SECRET_KEY) {
          const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(row.reference));
          if (ver && ver.status && ver.data && ver.data.status === 'success') continue; // paid — leave for recovery
        }
        await releaseReservation(row.draft._reserved);
        await db.pendingPayments.delete(row.reference);
      }
    } catch (e) { console.warn('abandoned-reservation sweep failed:', e.message); }
    const now = new Date();
    const m = now.getMonth() + 1, d = now.getDate(), year = now.getFullYear();
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const { data } = await db.sb.from('users').select('id,name,birthday_notified_year').eq('birth_month', m).eq('birth_day', d);
    let people = data || [];
    // Feb-29 birthdays get their wish on Feb-28 in non-leap years.
    if (m === 2 && d === 28 && !isLeap) {
      const r = await db.sb.from('users').select('id,name,birthday_notified_year').eq('birth_month', 2).eq('birth_day', 29);
      people = people.concat(r.data || []);
    }
    for (const u of people) {
      if (Number(u.birthday_notified_year || 0) === year) continue;
      const first = u.name ? String(u.name).split(' ')[0] : '';
      await pushToUser(u.id, { title: `🎂 Happy Birthday${first ? ', ' + first : ''}!`, body: 'Your free birthday gift is waiting — shop today and pick a treat on us. 🎁', url: '/' });
      await db.sb.from('users').update({ birthday_notified_year: year }).eq('id', u.id);
    }
    await runRecurringOrders();
    // Expired stock holds are already ignored by every availability query;
    // this only reclaims the rows (audit C-10).
    try {
      if (await ownStockMode()) {
        const n = await db.stock.expireHolds();
        if (n) console.log('expired stock holds cleared: ' + n);
      }
    } catch (e) { console.warn('stock hold sweep failed:', e.message); }
    // Assignment used to happen only when a rider polled (audit C-08).
    try { const r = await checkStuckOrders(); if (r.stuck) console.warn('watchdog: ' + r.stuck + ' order(s) past SLA'); }
    catch (e) { console.warn('stuck-order watchdog failed:', e.message); }
    // Was fired from the public GET /api/leaderboard on every request, to do
    // work that matters once a month (audit D-09). It is idempotent via an
    // app_config marker, so running it here changes nothing but the cost.
    try { await db.leaderboard.awardLastMonthWinner(); }
    catch (e) { console.warn('leaderboard award failed:', e.message); }
    // Prune the tables nothing else ever deletes from (audit B-12). Last,
    // and in its own catch, so a sweep failure cannot cost anyone their
    // recurring order or their birthday push.
    try { await db.retention.sweep(); }
    catch (e) { console.warn('retention sweep failed:', e.message); }
  } catch (e) { console.warn('runDailyJobs failed:', e.message); }
  finally { _dailyJobRunning = false; }
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: VAPID.publicKey });
});
app.post('/api/push/subscribe', requireAuth, customerOnly, async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'Invalid subscription' });
  try { await db.pushSubs.add(req.user.id, sub); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/push/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) await db.pushSubs.remove(endpoint);
  res.json({ ok: true });
});

// ── Riders ───────────────────────────────────────────────────────────────
app.get('/api/admin/riders', requireAdmin, async (req, res) => {
  try { res.json(await db.riders.list()); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/admin/riders', requireAdmin, async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  try {
    const r = await db.createRider({ name, email, phone, password });
    res.json({ id: r.id, name: r.name, email: r.email, phone: r.phone, role: 'rider' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/rider/location', riderOnly, async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat/lng required' });
  try { await db.riders.setLocation(req.user.id, lat, lng); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

app.post('/api/rider/online', riderOnly, async (req, res) => {
  const { online } = req.body || {};
  try {
    await db.riders.setOnline(req.user.id, !!online);
    if (online) {
      const assigned = await db.orders.assignQueuedForToday();
      for (let i = 0; i < assigned.length; i++) {
        const { orderId } = assigned[i];
        const o = await db.orders.get(orderId);
        if (!o || !o.userId) continue;
        if (i === 0) await pushToUser(o.userId, { title: '🛵 You are next!', body: 'A rider is on the way to you.', url: `/?track=${o.id}`, tag: `order-${o.id}` });
        else await pushToUser(o.userId, { title: '📦 Rider assigned', body: `${i + 1}${['st','nd','rd'][i] || 'th'} in their route — completing nearby deliveries first.`, url: `/?track=${o.id}`, tag: `order-${o.id}` });
      }
    }
    res.json({ ok: true, online: !!online });
  } catch (e) { fail(res, e, req); }
});

app.get('/api/rider/orders', riderOnly, async (req, res) => {
  try { await db.orders.assignQueuedForToday(); res.json(await db.orders.forRider(req.user.id)); }
  catch (e) { fail(res, e, req); }
});

app.post('/api/rider/orders/:id/status', riderOnly, async (req, res) => {
  const { status } = req.body || {};
  if (!['in_transit','delivered'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const o = await db.orders.setStatus(req.params.id, status, req.user.id);
    if (!o) return res.status(404).json({ error: 'Order not found or not yours' });
    if (o.userId) {
      if (status === 'in_transit') await pushToUser(o.userId, { title: '🛵 Out for delivery', body: 'Your SDGMart order is on the way.', url: `/?track=${o.id}`, tag: `order-${o.id}` });
      else if (status === 'delivered') await pushToUser(o.userId, { title: '✅ Delivered', body: 'Your SDGMart order has been delivered. Thank you!', url: `/?track=${o.id}`, tag: `order-${o.id}` });
      if (status === 'delivered') {
        const remaining = await db.orders.forRider(req.user.id);
        const next = remaining[0];
        if (next && next.userId) await pushToUser(next.userId, { title: '🛵 You are next!', body: 'Your rider is heading to you now.', url: `/?track=${next.id}`, tag: `order-${next.id}` });
      }
    }
    res.json(o);
  } catch (e) { fail(res, e, req); }
});

// Customer: list my own orders
// Audit D-07: this returned every order the customer had ever placed, to
// render one screen. Bounded now — but generously, and NOT at the 20 the
// finding suggested: MyOrdersPage has no paging UI, so a low default would
// silently hide a customer's history rather than page it. 100 is past any
// realistic Tamale shopper while still capping the query.
const ME_ORDERS_DEFAULT = 100;
app.get('/api/me/orders', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || ME_ORDERS_DEFAULT, 1), 500);
    const { data, error } = await db.sb.from('orders').select('*').eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    // Attach each order's shareable tracking token (deterministic HMAC) so the
    // customer can copy/share a track-on-any-device link (e.g. give a Family
    // Mode recipient the link without an account).
    const out = db.rowsOut(data).map(o => ({ ...o, trackToken: orderTrackToken(o.id) }));
    res.json(out);
  } catch (e) { fail(res, e, req); }
});

// Signed per-order track token so GUESTS can follow their order after closing
// the app (no account, no session). Pure HMAC of the order id — nothing stored,
// unguessable without the server secret, stable across restarts. Returned once
// at order creation; the client keeps it in localStorage.
// Guest tracking tokens are signed with their OWN secret. They used to derive
// from SUPABASE_SERVICE_KEY, which meant rotating the most sensitive credential
// you hold broke every tracking link a guest had saved and every code printed on
// a WhatsApp receipt — a customer-visible cost attached to the one action you
// most need to take quickly during an incident.
//
// Falls back to the service key when TRACK_TOKEN_SECRET is unset, so existing
// tokens keep working; set the env var to decouple them for good.
const TRACK_SECRET = process.env.TRACK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
if (!process.env.TRACK_TOKEN_SECRET) {
  console.warn('\u26a0\ufe0f  TRACK_TOKEN_SECRET is not set \u2014 guest tracking tokens are derived from');
  console.warn('   SUPABASE_SERVICE_KEY, so rotating that key will invalidate every saved');
  console.warn('   tracking link. Set TRACK_TOKEN_SECRET to decouple them.');
}

function orderTrackToken(orderId) {
  return require('crypto').createHmac('sha256', TRACK_SECRET)
    .update('track:' + String(orderId)).digest('hex').slice(0, 20);
}
app.get('/api/orders/:id/tracking', async (req, res) => {
  try {
    const tokenOk = req.query.t && String(req.query.t) === orderTrackToken(req.params.id);
    if (!tokenOk && !req.user) return res.status(401).json({ error: 'Sign in required' });
    const t = await getTrackingCached(req.params.id);
    if (!t) return res.status(404).json({ error: 'Order not found' });
    // Guest links stop working 7 days after delivery, so an old shared link
    // can't expose the customer's name/address forever. Signed-in owners are
    // unaffected (they authenticate normally below).
    if (tokenOk && !req.user && t.order.status === 'delivered') {
      // Prefer the exact delivered_at stamp; fall back to the scheduled
      // delivery date (+1 day slack) for orders delivered before the
      // delivered_at column existed.
      const basis = t.order.deliveredAt
        ? new Date(t.order.deliveredAt).getTime()
        : (t.order.deliveryDate ? new Date(t.order.deliveryDate).getTime() + 86400000 : null);
      if (basis && Date.now() - basis > 7 * 86400000) {
        return res.status(410).json({ error: 'This tracking code has expired (order was delivered more than 7 days ago).' });
      }
    }
    if (!tokenOk) {
      const isOwner = String(t.order.userId) === String(req.user.id);
      const isRider = req.user.role === 'rider' && String(t.order.riderId) === String(req.user.id);
      if (!isOwner && !isRider && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(t);
  } catch (e) { fail(res, e, req); }
});

// ── Search analytics ─────────────────────────────────────────────────────
app.post('/api/search/log', rateLimitIp('searchlog', LIMIT_TELEMETRY), async (req, res) => {
  const { query, resultCount } = req.body || {};
  try { await db.searchLog.record(query, req.user ? req.user.id : null, resultCount); res.json({ ok: true }); }
  catch (_) { res.json({ ok: true }); }
});
app.get('/api/admin/search/top', requireAdmin, async (req, res) => {
  try { res.json(await db.searchLog.topQueries({ days: parseInt(req.query.days) || 30, limit: parseInt(req.query.limit) || 20 })); }
  catch (e) { fail(res, e, req); }
});
app.get('/api/admin/search/unmatched', requireAdmin, async (req, res) => {
  try { res.json(await db.searchLog.unmatchedQueries({ days: parseInt(req.query.days) || 30, limit: parseInt(req.query.limit) || 20 })); }
  catch (e) { fail(res, e, req); }
});

// ── Saved addresses ──────────────────────────────────────────────────────
app.get('/api/me/addresses', requireAuth, async (req, res) => {
  try { res.json(await db.addresses.list(req.user.id)); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/me/addresses', requireAuth, async (req, res) => {
  try { res.json(await db.addresses.create(req.user.id, req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/me/addresses/:id', requireAuth, async (req, res) => {
  try { res.json(await db.addresses.update(req.user.id, req.params.id, req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/me/addresses/:id', requireAuth, async (req, res) => {
  try { await db.addresses.delete(req.user.id, req.params.id); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// Update profile (name + phone; birthday is captured ONCE then locked)
app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { name, phone, birthDay, birthMonth } = req.body || {};
  try {
    const patch = {
      name: String(name || req.user.name).slice(0, 100),
      phone: String(phone || '').slice(0, 30),
    };
    // Only accept a birthday if the user has none yet — never allow changes
    // afterwards (prevents gaming the birthday-gift offer).
    if (req.user.birthDay == null && req.user.birthMonth == null && birthDay != null && birthMonth != null) {
      const d = parseInt(birthDay, 10), m = parseInt(birthMonth, 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) { patch.birth_day = d; patch.birth_month = m; }
    }
    const { data, error } = await db.sb.from('users').update(patch).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json(db.rowOut(data));
  } catch (e) { fail(res, e, req); }
});

// ── Reviews ──────────────────────────────────────────────────────────────
app.get('/api/products/:id/reviews', async (req, res) => {
  try { res.json(await db.reviews.forProduct(req.params.id)); }
  catch (e) { fail(res, e, req); }
});
app.get('/api/products/reviews/summary', async (req, res) => {
  // ?ids=1,2,3
  try {
    const ids = String(req.query.ids || '').split(',').map(s => parseInt(s)).filter(Boolean);
    res.json(await db.reviews.summaryForProducts(ids));
  } catch (e) { fail(res, e, req); }
});
app.get('/api/me/pending-reviews', requireAuth, async (req, res) => {
  try { res.json(await db.reviews.pendingForUser(req.user.id)); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/me/reviews', requireAuth, async (req, res) => {
  const { productId, orderId, rating, message } = req.body || {};
  if (!rating || (!productId && !orderId)) return res.status(400).json({ error: 'rating and orderId (or productId) required' });
  try {
    // Whole-order review (the current flow) vs legacy per-product review.
    if (!productId) {
      // Only the order's owner can review it.
      const o = await db.orders.get(orderId);
      if (!o || String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your order' });
      return res.json(await db.reviews.createForOrder({ userId: req.user.id, orderId, rating, message }));
    }
    // Legacy per-product path. It used to write with no check at all that the
    // reviewer had bought anything (audit A-20). The UI no longer sends
    // productId, so this survives only for old clients — and now it proves
    // ownership of the order and that the product was actually in it.
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const o = await db.orders.get(orderId);
    if (!o || String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your order' });
    const inOrder = (o.items || []).some((it) => String(it.id != null ? it.id : it.productId) === String(productId));
    if (!inOrder) return res.status(403).json({ error: 'That product was not in this order' });
    res.json(await db.reviews.create({ userId: req.user.id, productId, orderId, rating, message }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Issue reports (delivered-order complaints) ───────────────────────────
app.post('/api/me/orders/:id/report-issue', requireAuth, async (req, res) => {
  const o = await db.orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your order' });
  const { issueType, description } = req.body || {};
  if (!description) return res.status(400).json({ error: 'Please describe the issue' });
  try {
    const rep = await db.issueReports.create({ orderId: o.id, userId: req.user.id, issueType, description });
    // Same reason as /api/feedback: carry who to call back, not just what broke.
    const who = [o.customer || req.user.name, o.phone || req.user.phone].filter(Boolean).join(' · ');
    notifyAdmins({
      title: '⚠️ Issue on order #' + o.id,
      body: (who ? who + '\n' : '') + String(description).slice(0, 120),
      url: '/admin', tag: 'admin-issue-' + o.id,
    }).catch(() => {});
    res.json(rep);
  } catch (e) { fail(res, e, req); }
});
// General feedback / complaints (no order attached) — appear in Admin → Issues.
// Requires supabase-schema-feedback.sql (issue_reports.order_id made nullable).
app.post('/api/feedback', requireAuth, async (req, res) => {
  const description = String((req.body && req.body.message) || '').trim();
  if (!description) return res.status(400).json({ error: 'Please write your feedback' });
  const rate = db.rateCheck(`feedback:${req.user.id}`, { windowMs: 10 * 60 * 1000, max: 5 });
  if (!rate.allowed) return res.status(429).json({ error: 'Too many messages — please try again later' });
  try {
    const fb = await db.issueReports.create({ orderId: null, userId: req.user.id, issueType: 'feedback', description });
    // Name and phone in the notification itself. The message alone told the
    // admin something was wrong but not who to call back, so every in-app
    // message meant opening the console to find out — and an anonymous-looking
    // buzz is easy to leave for later. The Issues tab carries the same details.
    const who = [req.user.name, req.user.phone].filter(Boolean).join(' · ') || 'A customer';
    notifyAdmins({
      title: '💬 Feedback from ' + (req.user.name || 'a customer'),
      body: who + '\n' + String(description).slice(0, 120),
      url: '/admin', tag: 'admin-feedback',
    }).catch(() => {});
    res.json(fb);
  } catch (e) {
    console.error('feedback save failed:', e.message);
    res.status(500).json({ error: 'Could not send right now — please use the WhatsApp button instead.' });
  }
});
app.get('/api/admin/issue-reports', requireAdmin, async (req, res) => {
  try { res.json(await db.issueReports.listAll()); }
  catch (e) { fail(res, e, req); }
});
app.put('/api/admin/issue-reports/:id/resolve', requireAdmin, async (req, res) => {
  try { await db.issueReports.resolve(req.params.id, (req.body && req.body.note) || ''); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// ── Cancel order (customer, within 15 min of placement) ──────────────────
app.post('/api/me/orders/:id/cancel', requireAuth, async (req, res) => {
  const result = await db.cancelOrder(req.params.id, req.user.id, (req.body && req.body.reason) || '');
  if (!result || result.error) return res.status(400).json({ error: (result && result.error) || 'Cancel failed' });
  res.json({ ok: true });
});

// ── Health check (for UptimeRobot / load balancers) ──────────────────────
// Lightweight: no DB hit, returns instantly so pings are cheap.
// Liveness (/healthz) says the process is up. Readiness says the app can
// actually serve — which is a different question, because every route depends on
// Supabase. /healthz deliberately does no DB work: it is pinged every five
// minutes and drives the daily job, so it must stay cheap. Point an uptime
// monitor at BOTH: /healthz catches the process dying, /readyz catches the
// database going away, which is the more likely outage and the one the old
// setup could not see at all.
app.get('/readyz', async (req, res) => {
  const started = Date.now();
  try {
    await db.appConfig.get('daily_job_last_run');   // trivial, indexed, always present
    res.json({ ok: true, db: 'up', ms: Date.now() - started });
  } catch (e) {
    console.error('readiness check failed:', e.message);
    res.status(503).json({ ok: false, db: 'down', ms: Date.now() - started });
  }
});

app.get('/healthz', (req, res) => { runDailyJobs(); res.json({ ok: true, ts: Date.now() }); });

// ── Admin: operational metrics dashboard ─────────────────────────────────
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  try {
    const days = Math.max(7, Math.min(90, parseInt(req.query.days) || 30));
    res.json(await db.metrics.overview({ days }));
  } catch (e) { fail(res, e, req); }
});

// ── Referral leaderboard ─────────────────────────────────────────────────
app.get('/api/admin/leaderboard', requireAdmin, async (req, res) => {
  try { res.json(await db.leaderboard.topReferrers(parseInt(req.query.limit) || 10)); }
  catch (e) { fail(res, e, req); }
});
// Public version (first names only) for the squad page gamification
// Public and uncached, and it fired awardLastMonthWinner on every single
// request — an app_config read plus a referrals scan per visitor, to do work
// that matters once a month. The award moved into runDailyJobs; the board
// itself is cached for a minute, which is far finer than it changes (audit D-09).
const LEADERBOARD_TTL_MS = 60 * 1000;
let _leaderboardCache = { at: 0, data: null };
app.get('/api/leaderboard', async (req, res) => {
  try {
    if (_leaderboardCache.data && Date.now() - _leaderboardCache.at < LEADERBOARD_TTL_MS) {
      return res.json(_leaderboardCache.data);
    }
    const list = await db.leaderboard.topReferrers(10);
    const out = list.map(u => ({
      name: (u.name || 'A friend').split(' ')[0],
      referralCount: u.referralCount,
    }));
    _leaderboardCache = { at: Date.now(), data: out };
    res.json(out);
  } catch (e) { fail(res, e, req); }
});

// ── Retention (admin) — returning vs new customers per month + lapsed list ──
const LAPSED_AFTER_DAYS = 30;
app.get('/api/admin/retention', requireAdmin, async (req, res) => {
  // Returns name, email and phone for up to 500 customers in one response.
  logPiiAccess(req, 'GET /api/admin/retention', 'up to 500');
  try {
    const { data: orderRows, error } = await db.sb.from('orders')
      .select('user_id, created_at')
      .not('user_id', 'is', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .limit(20000);
    if (error) throw error;
    const monthKey = (iso) => String(iso).slice(0, 7);
    const byUser = new Map();
    for (const o of orderRows || []) {
      const b = byUser.get(o.user_id) || { first: o.created_at, last: o.created_at, count: 0, months: new Set() };
      b.count += 1;
      if (o.created_at < b.first) b.first = o.created_at;
      if (o.created_at > b.last) b.last = o.created_at;
      b.months.add(monthKey(o.created_at));
      byUser.set(o.user_id, b);
    }
    // Last 6 calendar months: active = ordered that month; returning = also
    // ordered in an earlier month; rate = share of the month's customers who
    // are repeat customers.
    const now = new Date();
    const months = [];
    for (let k = 5; k >= 0; k--) {
      const ym = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      let active = 0, returning = 0;
      for (const b of byUser.values()) {
        if (!b.months.has(ym)) continue;
        active += 1;
        if (monthKey(b.first) < ym) returning += 1;
      }
      months.push({ month: ym, active, returning, newCustomers: active - returning, rate: active ? Math.round((returning / active) * 100) : 0 });
    }
    // Lapsed = has ordered before, but nothing in the last LAPSED_AFTER_DAYS days.
    const cutoff = new Date(Date.now() - LAPSED_AFTER_DAYS * 86400000).toISOString();
    const lapsedIds = [...byUser.entries()].filter(([, b]) => b.last < cutoff).map(([id]) => id).slice(0, 500);
    let lapsed = [];
    if (lapsedIds.length) {
      const { data: us } = await db.sb.from('users').select('id, name, email, phone, role').in('id', lapsedIds);
      const { data: subs } = await db.sb.from('push_subscriptions').select('user_id').in('user_id', lapsedIds);
      const pushSet = new Set((subs || []).map((s) => s.user_id));
      lapsed = (us || []).filter((u) => u.role !== 'admin').map((u) => {
        const b = byUser.get(u.id);
        return {
          id: u.id, name: u.name, email: u.email, phone: u.phone,
          orders: b.count, lastOrder: b.last,
          daysSince: Math.floor((Date.now() - new Date(b.last).getTime()) / 86400000),
          hasPush: pushSet.has(u.id),
        };
      }).sort((a, z) => z.daysSince - a.daysSince);
    }
    res.json({ months, lapsedAfterDays: LAPSED_AFTER_DAYS, lapsed });
  } catch (e) { fail(res, e, req); }
});
// Win-back push to selected lapsed customers (only lands for users with a
// push subscription; pushToUser silently skips the rest).
app.post('/api/admin/retention/notify', requireAdmin, async (req, res) => {
  const { userIds, title, body } = req.body || {};
  if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ error: 'userIds required' });
  const t = String(title || '').trim().slice(0, 80) || '👋 We miss you at SDGMart!';
  const b = String(body || '').trim().slice(0, 200) || "It's been a while — come back and see what's new. 🛒";
  let attempted = 0;
  for (const id of userIds.slice(0, 200)) {
    await pushToUser(Number(id), { title: t, body: b, url: '/' });
    attempted += 1;
  }
  res.json({ ok: true, attempted });
});

// Client-side crash reporter (from the React error boundary)
app.post('/api/client-error', rateLimitIp('clienterr', LIMIT_TELEMETRY), async (req, res) => {
  try {
    const { message, stack, path: p } = req.body || {};
    await db.errorLog.record({ message: 'CLIENT: ' + (message || 'unknown'), stack: stack || '', path: p || '', method: 'CLIENT', status: 0, userId: req.user ? req.user.id : null });
  } catch (_) {}
  res.json({ ok: true });
});

// ── Admin: error logs ────────────────────────────────────────────────────
app.get('/api/admin/errors', requireAdmin, async (req, res) => {
  try { res.json(await db.errorLog.list(parseInt(req.query.limit) || 100)); }
  catch (e) { fail(res, e, req); }
});
app.delete('/api/admin/errors', requireAdmin, async (req, res) => {
  try { await db.errorLog.clear(); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// ── Live counter ─────────────────────────────────────────────────────────
app.get('/api/stats/delivered-count', async (req, res) => {
  try {
    const c = await db.stats.counts();
    // Show whichever is larger so the ticker shows from the very first order placed,
    // while still preferring the (more impressive) delivered count once it climbs.
    res.json({ count: Math.max(c.delivered, c.total), delivered: c.delivered, total: c.total });
  } catch (e) { fail(res, e, req); }
});

// ── Promotions ───────────────────────────────────────────────────────────
app.get('/api/promotions/active', async (req, res) => {
  try { res.json(await db.promotions.listActive()); }
  catch (e) { fail(res, e, req); }
});
app.get('/api/admin/promotions', requireAdmin, async (req, res) => {
  try { res.json(await db.promotions.listAll()); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/admin/promotions', requireAdmin, async (req, res) => {
  try { res.json(await db.promotions.create(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/promotions/:id', requireAdmin, async (req, res) => {
  try { await db.promotions.delete(req.params.id); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});
// Publish + broadcast push notification to all subscribers
app.post('/api/admin/promotions/:id/publish', requireAdmin, async (req, res) => {
  try {
    const promo = await db.promotions.publish(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Not found' });
    if (!promo.pushSent && webpush && VAPID) {
      // Fire push to every subscriber asynchronously — don't make admin wait
      (async () => {
        const { data: subs } = await db.sb.from('push_subscriptions').select('user_id, endpoint, keys');
        await Promise.all((subs || []).map(async s => {
          try {
            await withTimeout(webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({
              title: `⚡ ${promo.title}`,
              body: promo.description || `Up to ${promo.discountPercent}% off — limited time`,
              url: '/', tag: `promo-${promo.id}`,
            })), 10000, 'promo push');
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubs.remove(s.endpoint);
          }
        }));
        await db.promotions.markPushSent(promo.id);
      })().catch(e => console.warn('promo broadcast failed:', e.message));
    }
    res.json(promo);
  } catch (e) { fail(res, e, req); }
});

// ── Product requests ─────────────────────────────────────────────────────
app.post('/api/product-requests', rateLimitIp('prodreq', LIMIT_REQUESTS), async (req, res) => {
  const { name, whatsappNumber, callNumber, contactWhatsapp, contactCall, productName, notes } = req.body || {};
  if (!productName || !name) return res.status(400).json({ error: 'Your name and the item are required' });
  if (!whatsappNumber && !callNumber) return res.status(400).json({ error: 'Please give us at least one number to reach you' });
  try {
    const r = await db.productRequests.create({
      userId: req.user ? req.user.id : null,
      name, whatsappNumber, callNumber, contactWhatsapp, contactCall, productName, notes,
    });
    notifyAdmins({ title: '🔍 Product request', body: (name || 'Someone') + ' wants: ' + String(productName).slice(0, 70), url: '/admin', tag: 'admin-request' }).catch(() => {});
    res.json({ ok: true, id: r.id });
  } catch (e) { fail(res, e, req); }
});
app.get('/api/admin/product-requests', requireAdmin, async (req, res) => {
  try { res.json(await db.productRequests.listAll({ status: req.query.status || null })); }
  catch (e) { fail(res, e, req); }
});
app.put('/api/admin/product-requests/:id', requireAdmin, async (req, res) => {
  try {
    const patch = req.body || {};
    if (patch.status === 'contacted') patch.contactedAt = new Date().toISOString();
    res.json(await db.productRequests.update(req.params.id, patch));
  } catch (e) { fail(res, e, req); }
});

// ── Admin: upload product photo ──────────────────────────────────────────
app.post('/api/admin/upload-image', requireAdmin, async (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || !dataUrl.startsWith('data:')) return res.status(400).json({ error: 'dataUrl required' });
  try {
    const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid data url' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) return res.status(413).json({ error: 'image too large (max ~1.5MB)' });
    // The declared MIME is deliberately ignored — uploadProductPhoto reads the
    // real format from the bytes and rejects anything that is not an image.
    if (!db.sniffImageType(buf)) return res.status(400).json({ error: 'Only JPEG, PNG and WebP images can be uploaded.' });
    const url = await db.uploadProductPhoto(buf);
    res.json({ url });
  } catch (e) { fail(res, e, req); }
});

// ── Admin: surprise extra on an order ────────────────────────────────────
app.post('/api/admin/orders/:id/surprise', requireAdmin, async (req, res) => {
  const { note } = req.body || {};
  try {
    await db.sb.from('orders').update({ surprise_extra: String(note || '').slice(0, 200) }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});

// ── Delivery time slots (admin-configured, read by checkout) ─────────────
app.get('/api/delivery/slots', async (req, res) => {
  try {
    const slots = (await db.appConfig.get('delivery_slots')) || ['12:00-14:00', '14:00-16:00', '16:00-18:00'];
    res.json({ slots, maxDaysAhead: 7 });
  } catch (e) { fail(res, e, req); }
});

// ── MoMo merchant numbers (admin-configured, read by checkout) ───────────
// Stored in app_config under key 'momo_numbers' as { mtn, telecel, at, name }
app.get('/api/momo/numbers', async (req, res) => {
  try {
    const cfg = (await db.appConfig.get('momo_numbers')) || {};
    res.json(cfg);
  } catch (e) { fail(res, e, req); }
});
app.post('/api/admin/momo/numbers', requireAdmin, async (req, res) => {
  const { mtn, telecel, at, name } = req.body || {};
  // Light validation — accept whatever format; just trim and cap length
  const clean = (v) => v == null ? '' : String(v).trim().slice(0, 30);
  try {
    await db.appConfig.set('momo_numbers', {
      mtn: clean(mtn), telecel: clean(telecel), at: clean(at), name: clean(name),
    });
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});

// ── Store settings (admin-toggleable site behaviour) ─────────────────────
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    res.json({
      showFreshness: !!(await db.appConfig.get('show_freshness')),
      deductStock: !!(await db.appConfig.get('deduct_stock')),
      storeName: (await db.appConfig.get('store_name')) || 'SDGMart',
      deliverySlots: (await db.appConfig.get('delivery_slots')) || ['12:00-14:00', '14:00-16:00', '16:00-18:00'],
      orderingEnabled: await switchOn('ordering_enabled'),
      onlinePaymentEnabled: await switchOn('online_payment_enabled'),
      loyaltyRedemptionEnabled: await switchOn('loyalty_redemption_enabled'),
    });
  } catch (e) { fail(res, e, req); }
});
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const { showFreshness, storeName, deliverySlots, deductStock,
    orderingEnabled, onlinePaymentEnabled, loyaltyRedemptionEnabled } = req.body || {};
  try {
    // Kill switches. Logged, because turning trading off is worth an audit trail.
    for (const [k, v] of [['ordering_enabled', orderingEnabled],
      ['online_payment_enabled', onlinePaymentEnabled],
      ['loyalty_redemption_enabled', loyaltyRedemptionEnabled]]) {
      if (v == null) continue;
      await db.appConfig.set(k, !!v);
      if (!v) {
        const msg = 'KILL SWITCH: ' + k + ' turned OFF by admin ' + req.user.id;
        console.warn(msg);
        await db.errorLog.record({ message: msg, path: '/api/admin/settings', method: 'POST', status: 200, userId: req.user.id });
      }
    }
    if (showFreshness != null) await db.appConfig.set('show_freshness', !!showFreshness);
    // Own-stock mode (audit C-10). Turning this on makes the shop start
    // deducting inventory, which is only safe once the reservation functions
    // exist — without them the app would claim to track stock and silently
    // not. Refuse rather than half-enable it.
    if (deductStock != null) {
      if (deductStock && !(await db.appConfig.get('deduct_stock'))) {
        if (!(await db.stock.ready())) {
          return res.status(409).json({
            error: 'Own-stock mode needs the stock reservation migration. Run supabase-schema-stock-holds.sql, then try again.',
            code: 'STOCK_MIGRATION_MISSING',
          });
        }
        await db.errorLog.record({
          message: 'OWN-STOCK MODE TURNED ON by user ' + (req.user ? req.user.id : '?')
            + ' — the shop now deducts inventory and refuses orders it cannot fill.',
          path: 'audit', method: 'SETTINGS', status: 200, userId: req.user ? req.user.id : null,
        }).catch(() => {});
      }
      await db.appConfig.set('deduct_stock', !!deductStock);
    }
    if (storeName != null) await db.appConfig.set('store_name', String(storeName).slice(0, 60));
    if (Array.isArray(deliverySlots)) {
      const clean = deliverySlots.map(s => String(s).slice(0, 20).trim()).filter(Boolean).slice(0, 12);
      await db.appConfig.set('delivery_slots', clean);
    }
    invalidateCatalog(); // show_freshness is baked into /data/products.js
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});

// ── Birthday gifts (admin config + customer eligibility) ─────────────────
app.get('/api/admin/birthday-gifts', requireAdmin, async (req, res) => {
  try { res.json((await db.appConfig.get('birthday_gifts')) || { enabled: false, productIds: [] }); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/admin/birthday-gifts', requireAdmin, async (req, res) => {
  const { enabled, productIds } = req.body || {};
  try {
    const ids = Array.isArray(productIds) ? productIds.map(n => parseInt(n, 10)).filter(Boolean).slice(0, 50) : [];
    await db.appConfig.set('birthday_gifts', { enabled: !!enabled, productIds: ids });
    res.json({ ok: true });
  } catch (e) { fail(res, e, req); }
});
app.get('/api/birthday/gifts', requireAuth, customerOnly, async (req, res) => {
  try {
    const { cfg, eligible } = await birthdayGiftStatus(req.user);
    if (!eligible) return res.json({ eligible: false, products: [] });
    // One query for the whole gift list rather than one per id (audit D-09).
    const found = await db.products.listByIds(cfg.productIds);
    const products = found.filter((p) => p && (p.stock == null || p.stock > 0));
    res.json({ eligible: products.length > 0, products });
  } catch (e) { fail(res, e, req); }
});

// ── Recurring orders ─────────────────────────────────────────────────────
app.get('/api/me/recurring', requireAuth, async (req, res) => {
  try { res.json(await db.recurring.listForUser(req.user.id)); }
  catch (e) { fail(res, e, req); }
});
app.post('/api/me/recurring', requireAuth, async (req, res) => {
  const { items, cadenceDays, nextRunAt, deliveryInfo } = req.body || {};
  if (!Array.isArray(items) || !items.length || !cadenceDays || !nextRunAt) return res.status(400).json({ error: 'items, cadenceDays, nextRunAt required' });
  try { res.json(await db.recurring.create({ userId: req.user.id, items, cadenceDays: parseInt(cadenceDays), nextRunAt, deliveryInfo })); }
  catch (e) { fail(res, e, req); }
});
app.put('/api/me/recurring/:id', requireAuth, async (req, res) => {
  try { res.json(await db.recurring.setActive(req.params.id, req.user.id, !!req.body.active)); }
  catch (e) { fail(res, e, req); }
});
app.delete('/api/me/recurring/:id', requireAuth, async (req, res) => {
  try { await db.recurring.delete(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (e) { fail(res, e, req); }
});

// Service worker must never be cached long — browsers poll it to discover new
// app versions, so a cached sw.js delays every update rollout. (express.static
// below would serve it with no Cache-Control, letting Cloudflare default-cache
// it for hours.)
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'application/javascript');
  try {
    const src = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    // The literal in the file is a dev placeholder; the deployed version is
    // stamped here so it can never be forgotten (audit G-05).
    res.send(src.replace(/const CACHE_NAME = '[^']*';/, "const CACHE_NAME = 'sdgmart-" + buildId() + "';"));
  } catch (e) {
    // Serving a stale-but-working service worker beats serving none.
    res.sendFile(path.join(__dirname, 'sw.js'));
  }
});

// ── Legal pages ──────────────────────────────────────────────────────────
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));

// ── Block direct download of source, configs, docs, and schema ───────────
// express.static(__dirname, { dotfiles: 'ignore' }) below would otherwise serve server.js, database.js,
// HANDOFF.md, package.json, *.sql, etc. as plain text. The client only ever
// needs the built bundle (/app.bundle.js), /data, /icons, the HTML, css, sw.js
// and manifest — all of which are unaffected by this guard.
app.use((req, res, next) => {
  const p = req.path;
  if (/(^|\/)\.[^\/]/.test(p)                       // any dot-segment: /.git/, /.env, /a/.ssh/…
    || /^\/(components|scripts)\//.test(p)
    || /^\/(server|database|hooks|tweaks-panel|App)\.jsx?$/.test(p)
    || /^\/package(-lock)?\.json$/.test(p)
    || /\.(md|sql|log|sh|ya?ml|env)$/i.test(p)) {
    return res.status(404).end();
  }
  next();
});

// ── Static files ─────────────────────────────────────────────────────────
app.use('/icons', express.static(path.join(__dirname, 'icons'), { dotfiles: 'ignore' }));
app.use(express.static(__dirname, { index: 'SDGMart.html' }));

// ── SPA client routes ────────────────────────────────────────────────────
// The app is a single-page app that now uses real URLs (/shop, /checkout,
// /squad, /order-confirmed, …) so each section is shareable and shows up as a
// distinct page in Google Analytics. Any GET that isn't an API call or a real
// file returns the app shell, so refreshing or directly opening one of those
// routes works instead of 404ing. (Real files were already served by static
// above; unknown /api GETs and file paths fall through to the normal 404.)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'SDGMart.html'));
});

// ── Global error handler (must be last) ──────────────────────────────────
// Logs any unhandled route error to the error_logs table + console, then
// returns a clean 500. Optionally forwards to Sentry if SENTRY_DSN is set.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  const safePath = scrubUrl(req.originalUrl);
  if (Sentry) { try { Sentry.captureException(err, { extra: { path: safePath, method: req.method, userId: req.user ? req.user.id : null } }); } catch (_) {} }
  db.errorLog.record({
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? err.stack : '',
    path: safePath, method: req.method, status: 500,
    userId: req.user ? req.user.id : null,
  });
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our end.' });
});

// Process-level safety nets — log crashes instead of dying silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  if (Sentry) { try { Sentry.captureException(reason); } catch (_) {} }
  // A Supabase/PostgREST error is a plain object, not an Error, so it carries no
  // .stack — two of these landed as `invalid input syntax for type bigint:
  // "undefined"` with an EMPTY stack, which says something broke but gives no way
  // to find it. Keep the code/details/hint PostgREST does provide, and synthesise
  // a stack when the reason has none, so the next one is traceable instead of a
  // mystery. The message stays first so existing log reading is unaffected.
  const parts = [];
  if (reason && reason.message) parts.push(reason.message); else parts.push(String(reason));
  for (const k of ['code', 'details', 'hint']) {
    if (reason && reason[k]) parts.push(k + '=' + String(reason[k]).slice(0, 200));
  }
  db.errorLog.record({
    message: 'unhandledRejection: ' + parts.join(' · '),
    stack: (reason && reason.stack) ? reason.stack : ('no stack on reason; captured at handler:\n' + new Error('unhandledRejection').stack),
    // Findable, not anonymous. Without these a process-level fault lands in
    // Admin → Errors as status null / path null — the most serious row in the
    // table and the only one that cannot be filtered for or sorted to the top.
    path: 'process', method: 'REJECTION', status: 500,
  }).catch(() => {});   // never let the logger itself reject unhandled
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  if (Sentry) { try { Sentry.captureException(err); } catch (_) {} }
  // Exit, do not continue. After an uncaught exception the stack unwound from
  // somewhere unknown, leaving work half-finished; carrying on serves subtly
  // wrong results indefinitely. Render restarts an exited process in seconds,
  // so losing the in-flight requests is the cheaper trade. The delay gives the
  // log write and the Sentry flush a chance to land first.
  Promise.resolve(db.errorLog.record({
    message: 'uncaughtException: ' + err.message, stack: err.stack,
    path: 'process', method: 'CRASH', status: 500,
  }))
    .catch(() => {})
    .finally(() => setTimeout(() => process.exit(1), 500).unref());
});

// ── Startup ──────────────────────────────────────────────────────────────
async function start() {
  try {
    await db.bootstrap();
  } catch (e) {
    console.error('❌ DB bootstrap failed:', e.message);
    console.error('   Did you run supabase-schema.sql in the Supabase SQL editor?');
    process.exit(1);
  }
  if (webpush) {
    try {
      VAPID = await db.getVapidKeys();
      if (VAPID) {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@sdgmart.local', VAPID.publicKey, VAPID.privateKey);
        console.log('🔔 Web Push enabled');
      }
    } catch (e) { console.warn('Web Push init failed:', e.message); }
  }
  app.listen(PORT, () => {
    console.log(`\n🏪 SDGMart running at http://localhost:${PORT}`);
    console.log(`   Admin login: ${db.ADMIN_EMAIL}`);
  });
}

start();
