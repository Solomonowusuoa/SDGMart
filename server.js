// Load .env from THIS file's directory (not the cwd), so the server works
// regardless of where it's launched from (e.g. preview tools that run from a
// different working directory). In production (Render) env vars come from the
// platform dashboard, so a missing .env is a harmless no-op.
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (_) {}
const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const db = require('./database');

// ── Resend (transactional email) ─────────────────────────────────────────
// RESEND_API_KEY = your key from https://resend.com/api-keys
// RESEND_FROM_EMAIL = sender address (default: onboarding@resend.dev for
//   immediate use without a custom domain. Once you verify your own domain
//   in Resend, set this to e.g. 'noreply@sdgmart.com').
// ── Paystack (online card + mobile money) ────────────────────────────────
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
async function paystackApi(path, method = 'GET', body) {
  const r = await fetch('https://api.paystack.co' + path, {
    method,
    headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
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
async function sendEmail({ to, subject, html, text }) {
  const client = getResend();
  if (!client) return { skipped: true, reason: 'RESEND_API_KEY not set' };
  try {
    const r = await client.emails.send({ from: RESEND_FROM_EMAIL, to, subject, html, text });
    return { ok: true, id: r.data && r.data.id };
  } catch (e) {
    console.warn('email send failed:', e.message);
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
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.use(cors());
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
  next();
}
function riderOnly(req, res, next) {
  if (!req.user || req.user.role !== 'rider') return res.status(403).json({ error: 'Rider only' });
  next();
}
app.use(authMiddleware);

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
  // Always overwrite so updates to the icon code propagate to the file system.
  fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createIconPNG(192));
  fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createIconPNG(512));
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), createIconSVG());
}
ensureIcons();

// ── Pre-bundled app (esbuild) ────────────────────────────────────────────
// Replaces in-browser Babel: we concatenate all source files in load order
// and transform JSX → JS once (minified) on the server. The browser then runs
// a single fast bundle instead of compiling 22 files on every visit.
// In dev we rebuild on each request; in production we build once and cache.
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
  'components/AdminPage.jsx',
  'components/LoginPage.jsx',
  'components/MapPicker.jsx',
  'components/RiderPage.jsx',
  'components/MyOrdersPage.jsx',
  'components/AccountPage.jsx',
  'components/ReviewPromptModal.jsx',
  'components/RequestProductButton.jsx',
  'components/OrderTrackingPage.jsx',
  'tweaks-panel.jsx',
  'App.jsx',
];
let _esbuild = null;
let _bundleCache = null;
let _bundleBuiltAt = 0;   // newest source mtime captured when we last built

// Newest modification time across all bundle source files. Cheap (~20 stats).
function newestSourceMtime() {
  let newest = 0;
  for (const rel of BUNDLE_FILES) {
    try { const m = fs.statSync(path.join(__dirname, rel)).mtimeMs; if (m > newest) newest = m; }
    catch (_) {}
  }
  return newest;
}

function buildAppBundle() {
  if (!_esbuild) _esbuild = require('esbuild');
  // Concatenate sources with a banner per file (helps stack traces).
  const parts = BUNDLE_FILES.map(rel => {
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
try { _bundleCache = buildAppBundle(); _bundleBuiltAt = newestSourceMtime(); console.log('📦 App bundle pre-built'); }
catch (e) { console.warn('⚠️  initial bundle build failed (will retry on first request):', e.message); }

// ── Dynamic products.js (served from DB) ─────────────────────────────────
app.get('/data/products.js', async (req, res) => {
  try {
    const productsList = (await db.products.list()).map(p => ({ ...p, bestseller: !!p.bestseller, img: p.img || null }));
    const ordersList = await db.orders.list();
    const counts = {};
    ordersList.forEach(o => {
      let items = o.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
      (items || []).forEach(i => { counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); });
    });
    const TOP_IDS_BY_ORDERS = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => Number(id));
    const categories = ["Cereals","Dairy","Detergents","Rice & Grains","Cooking Oil","Snacks","Canned Foods","Drinks","Desserts"];
    const essentials = [1, 5, 13, 17, 9, 29, 25, 22, 3];
    const neighborhoods = ["Tamale Central","Kalpohin","Lamashegu","Sagnarigu","Nyohini","Choggu","Kalpohini","Vittin","Tishigu","Gumbihini","Jisonayili"];
    // Customer-facing freshness/expiry display is off by default; admin can flip it on.
    const showFreshness = !!(await db.appConfig.get('show_freshness'));
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
if (typeof window !== 'undefined') {
  window.PRODUCTS = PRODUCTS;
  window.CATEGORIES = CATEGORIES;
  window.ESSENTIALS = ESSENTIALS;
  window.NEIGHBORHOODS = NEIGHBORHOODS;
  window.TOP_IDS_BY_ORDERS = TOP_IDS_BY_ORDERS;
  window.SHOW_FRESHNESS = SHOW_FRESHNESS;
  window.LOCATIONIQ_KEY = ${JSON.stringify(locationiqKey)};
  window.PAYSTACK_PUBLIC_KEY = ${JSON.stringify(PAYSTACK_PUBLIC_KEY)};
}`;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(js);
  } catch (e) {
    console.error('products.js failed:', e);
    res.status(500).send('// error loading products');
  }
});

// ── Products API ─────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try { res.json((await db.products.list()).map(p => ({ ...p, bestseller: !!p.bestseller, img: p.img || null }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/top', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit) || 8));
    const productsList = (await db.products.list()).map(p => ({ ...p, bestseller: !!p.bestseller }));
    const ordersList = await db.orders.list();
    const counts = {};
    ordersList.forEach(o => {
      let items = o.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
      (items || []).forEach(i => { counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); });
    });
    const ranked = productsList.map(p => ({ ...p, _orderCount: counts[p.id] || 0 })).sort((a, b) => b._orderCount - a._orderCount);
    const realTop = ranked.filter(p => p._orderCount > 0).slice(0, limit);
    if (realTop.length < limit) {
      const remaining = ranked.filter(p => p._orderCount === 0);
      for (let i = remaining.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
      realTop.push(...remaining.slice(0, limit - realTop.length));
    }
    res.json(realTop);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await db.products.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ ...p, bestseller: !!p.bestseller });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, unit, bestBefore, stock, description, bestseller, lowStockThreshold } = req.body;
    const created = await db.products.create({ name, category, price: parseFloat(price), unit, bestBefore, stock: parseInt(stock) || 0, description: description || '', bestseller: !!bestseller, lowStockThreshold: lowStockThreshold != null ? parseInt(lowStockThreshold) : undefined });
    res.status(201).json({ ...created, bestseller: !!created.bestseller });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, unit, bestBefore, stock, description, bestseller, lowStockThreshold } = req.body;
    const updated = await db.products.update(req.params.id, { name, category, price: parseFloat(price), unit, bestBefore, stock: parseInt(stock) || 0, description: description || '', bestseller: !!bestseller, ...(lowStockThreshold != null ? { lowStockThreshold: parseInt(lowStockThreshold) } : {}) });
    res.json({ ...updated, bestseller: !!updated.bestseller });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try { await db.products.delete(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: low-stock products (uses per-product threshold, default 5)
app.get('/api/admin/inventory/low', requireAdmin, async (req, res) => {
  try { res.json(await db.products.lowStock()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Orders API ───────────────────────────────────────────────────────────
app.get('/api/orders', requireAdmin, async (req, res) => {
  try { res.json(await db.orders.list()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared order-creation logic. Used by Cash-on-Delivery (/api/orders) and the
// Paystack verify/webhook paths. `reqUser` may be null (guest). `extra` carries
// payment status (paid, paystackRef).
async function createOrderFromBody(reqUser, body, extra = {}) {
  const {
    customer, phone, neighborhood, address,
    items, total, delivery,
    recipientName, recipientPhone, recipientAddress, payMethod, momoNumber,
    subtotal, discountApplied, loyaltyUsed, location,
  } = body || {};
  const userId = reqUser ? reqUser.id : null;
  const now = new Date();
  const afterCutoff = now.getHours() >= 12;
  const deliveryDate = new Date(now);
  if (afterCutoff) deliveryDate.setDate(deliveryDate.getDate() + 1);
  const deliveryDateStr = deliveryDate.toISOString().slice(0, 10);
  const loc = location && typeof location.lat === 'number' ? location : null;

  const created = await db.orders.create({
    userId,
    customerName: customer || '', customerPhone: phone || '',
    recipientName: recipientName || '', recipientPhone: recipientPhone || '',
    address: address || recipientAddress || '', neighborhood: neighborhood || '',
    items: items || [], subtotal: Number(subtotal || 0), deliveryFee: Number(delivery || 0),
    discount: Number(discountApplied ? (subtotal * 0.05) : 0),
    loyaltyUsed: Number(loyaltyUsed || 0),
    total: Number(total || 0),
    paymentMethod: payMethod || (extra.paid ? 'paystack' : 'cash'),
    momoNumber: momoNumber || '',
    paid: !!extra.paid, paystackRef: extra.paystackRef || null,
    status: 'queued', location: loc, deliveryDate: deliveryDateStr, priority: afterCutoff,
  });

  let squadInfo = null;
  if (userId) {
    if (discountApplied) await db.squads.consumeDiscount(userId);
    if (loyaltyUsed) await db.squads.consumeLoyalty(userId, loyaltyUsed);
    squadInfo = await db.squads.recordSpend(userId, Number(subtotal || total || 0));
    if (!reqUser.firstOrderDone) await db.sb.from('users').update({ first_order_done: true }).eq('id', userId);
    if (loc) await db.addresses.markLastUsed(userId, loc, neighborhood);
  }
  db.stats.invalidateDelivered();
  return {
    ok: true, id: created.id,
    deliveryDate: deliveryDateStr, priority: afterCutoff,
    loyaltyEarned: squadInfo ? squadInfo.loyaltyEarned : 0,
    squadGoalHit: !!(squadInfo && squadInfo.squadGoalHit),
  };
}

app.post('/api/orders', async (req, res) => {
  if (req.user && req.user.role !== 'rider' && req.user.emailVerified === false) {
    return res.status(403).json({ error: 'Please verify your email before placing an order.' });
  }
  try {
    const result = await createOrderFromBody(req.user, req.body, { paid: false });
    res.status(201).json(result);
  } catch (e) { console.error('order create failed:', e); res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id', requireAdmin, async (req, res) => {
  try { await db.orders.update(req.params.id, req.body || {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const o = await db.orders.get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: delete an order
app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  try { await db.sb.from('orders').delete().eq('id', req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Paystack: online payment (card + mobile money) ───────────────────────
// Whether online payment is available (used by the client to show/hide it).
app.get('/api/paystack/config', (req, res) => {
  res.json({ enabled: !!(PAYSTACK_SECRET_KEY && PAYSTACK_PUBLIC_KEY), publicKey: PAYSTACK_PUBLIC_KEY || null });
});

// 1) Initialize a transaction. Server sets the amount + reference (locked in
//    Paystack) and stashes the order draft so the order is only created after
//    payment is confirmed.
app.post('/api/paystack/init', async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Online payment is not configured' });
  const { email, amount, draft } = req.body || {};
  const ghs = Number(amount);
  if (!(ghs > 0)) return res.status(400).json({ error: 'Invalid amount' });
  if (!draft || !Array.isArray(draft.items) || !draft.items.length) return res.status(400).json({ error: 'Empty order' });
  const customerEmail = (email && /\S+@\S+\.\S+/.test(email)) ? email
    : (req.user && req.user.email) ? req.user.email
    : `guest_${Date.now()}@guest.sdgmart.app`;
  const reference = 'SDG_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try {
    const init = await paystackApi('/transaction/initialize', 'POST', {
      email: customerEmail,
      amount: Math.round(ghs * 100), // pesewas
      currency: 'GHS',
      reference,
      channels: ['mobile_money', 'card'],
      metadata: { order_for: draft.customer || '', phone: draft.phone || '' },
    });
    if (!init || !init.status || !init.data) return res.status(502).json({ error: (init && init.message) || 'Could not start payment' });
    await db.pendingPayments.create(reference, req.user ? req.user.id : null, draft, ghs);
    res.json({ reference, accessCode: init.data.access_code, publicKey: PAYSTACK_PUBLIC_KEY });
  } catch (e) { console.error('paystack init failed:', e.message); res.status(500).json({ error: 'Payment init failed' }); }
});

// 2) Verify a transaction and create the order (idempotent).
app.post('/api/paystack/verify', async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: 'Missing reference' });
  try {
    // Already created (e.g. webhook beat us to it)? Return it.
    const existing = await db.orders.findByPaystackRef(reference);
    if (existing) return res.json({ ok: true, id: existing.id, already: true });

    const ver = await paystackApi('/transaction/verify/' + encodeURIComponent(reference));
    if (!ver || !ver.status || !ver.data || ver.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment was not completed' });
    }
    const pending = await db.pendingPayments.get(reference);
    const draft = (pending && pending.draft) || req.body.draft;
    if (!draft) return res.status(400).json({ error: 'Order details not found' });
    const reqUser = pending && pending.userId ? await db.users.get(pending.userId) : req.user;
    const result = await createOrderFromBody(reqUser, draft, { paid: true, paystackRef: reference });
    await db.pendingPayments.delete(reference);
    res.json(result);
  } catch (e) { console.error('paystack verify failed:', e.message); res.status(500).json({ error: e.message }); }
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
          await createOrderFromBody(reqUser, pending.draft, { paid: true, paystackRef: ref });
          await db.pendingPayments.delete(ref);
        }
      }
    }
    res.sendStatus(200);
  } catch (e) { console.error('paystack webhook error:', e.message); res.sendStatus(200); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: signup / login / logout / me ───────────────────────────────────
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, password_hash, password, ...rest } = u;
  return rest;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, phone, password, refCode } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const pwErr = db.validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    // Reject duplicate email up front for a clean error
    const existing = await db.users.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });
    const u = await db.users.create({ name, email, phone, password, refCode, role: 'customer' });
    const verifyToken = await db.makeEmailToken(u.id, 'verify');
    const verifyLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${verifyToken}`;
    // Send real email if Resend is configured; otherwise fall back to dev-style link surfacing.
    const emailResult = await sendEmail({
      to: u.email,
      subject: 'Verify your SDGMart email',
      html: emailLayout({
        title: `Welcome to SDGMart, ${u.name.split(' ')[0]}!`,
        intro: 'Tap the button below to verify your email. This link expires in 24 hours.',
        cta: 'Verify my email', ctaUrl: verifyLink,
        footer: "If you didn't sign up, you can safely ignore this email.",
      }),
      text: `Welcome to SDGMart!\n\nVerify your email by opening: ${verifyLink}\n\n(Link expires in 24 hours.)`,
    });
    if (emailResult.skipped) console.log(`✉️  (no email config) verification link for ${u.email}: ${verifyLink}`);
    const token = await db.sessions.create(u.id);
    res.status(201).json({
      user: publicUser(u), token,
      // Only return the raw link in dev (when no real email goes out) so the UI can still surface it
      verificationLink: emailResult.skipped ? verifyLink : undefined,
      emailSent: !!emailResult.ok,
      message: emailResult.ok ? 'Account created — check your email to verify.' : 'Account created. Please verify your email.',
    });
  } catch (e) {
    console.error('signup failed:', e);
    res.status(500).json({ error: e.message || 'Signup failed' });
  }
});

const LOGIN_LIMIT = { windowMs: 5 * 60 * 1000, max: 5, blockMs: 15 * 60 * 1000 };

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const ip = clientIp(req);
  const key = `login:${ip}:${String(email).toLowerCase()}`;
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
  } catch (e) { console.error('login failed:', e); res.status(500).json({ error: e.message }); }
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

app.post('/api/auth/resend-verification', requireAuth, async (req, res) => {
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
  res.json({ ok: true, emailSent: !!emailResult.ok, verificationLink: emailResult.skipped ? verifyLink : undefined });
});

// ── Password reset ───────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Rate-limit per email
  const rl = db.rateCheck(`reset:${String(email).toLowerCase()}`, { windowMs: 60 * 60 * 1000, max: 5, blockMs: 60 * 60 * 1000 });
  if (!rl.allowed) return res.json({ ok: true }); // Silent rate-limit (don't leak)
  try {
    const u = await db.users.findByEmail(email);
    // Respond OK even when the email doesn't exist (don't leak which addresses are registered)
    if (!u) return res.json({ ok: true });
    const token = await db.makeEmailToken(u.id, 'reset');
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
    res.json({ ok: true, emailSent: !!emailResult.ok, resetLink: emailResult.skipped ? link : undefined });
  } catch (e) { console.error('forgot-password failed:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  const pwErr = db.validatePasswordStrength(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    const result = await db.consumeEmailToken(token, 'reset');
    if (!result) return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    await db.users.changePassword(result.userId, newPassword);
    await db.sessions.destroyAllForUser(result.userId);
    res.json({ ok: true });
  } catch (e) { console.error('reset-password failed:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (!db.verifyPassword(currentPassword, req.user.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect' });
  const pwErr = db.validatePasswordStrength(newPassword, { isAdminChange: req.user.role === 'admin' });
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    await db.users.changePassword(req.user.id, newPassword);
    await db.sessions.destroyAllForUser(req.user.id);
    const token = await db.sessions.create(req.user.id);
    res.json({ ok: true, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
  if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const u = await db.users.get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json(publicUser(u));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/squads/:userId', requireAuth, async (req, res) => {
  if (String(req.user.id) !== String(req.params.userId) && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const u = await db.users.get(req.params.userId);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const members = (await db.squads.members(u.squadCode)).map(m => ({
      id: m.id, name: m.name, totalSpent: m.totalSpent || 0, discountPending: !!m.discountPending, isYou: m.id === u.id,
    }));
    res.json({ me: publicUser(u), referralCode: u.refCode, squadCode: u.squadCode, members, goal: 500 });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubs.remove(sub.endpoint);
        else console.warn('push send failed:', e.statusCode, e.body);
      }
    }));
  } catch (e) { console.warn('pushToUser failed:', e.message); }
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: VAPID.publicKey });
});
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'Invalid subscription' });
  try { await db.pushSubs.add(req.user.id, sub); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/push/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) await db.pushSubs.remove(endpoint);
  res.json({ ok: true });
});

// ── Riders ───────────────────────────────────────────────────────────────
app.get('/api/admin/riders', requireAdmin, async (req, res) => {
  try { res.json(await db.riders.list()); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
  catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rider/orders', riderOnly, async (req, res) => {
  try { await db.orders.assignQueuedForToday(); res.json(await db.orders.forRider(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Customer: list my own orders
app.get('/api/me/orders', requireAuth, async (req, res) => {
  try {
    const { data, error } = await db.sb.from('orders').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    // Convert snake_case to camelCase for the client
    const out = data.map(o => { const x = {}; for (const k of Object.keys(o)) x[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = o[k]; return x; });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id/tracking', requireAuth, async (req, res) => {
  try {
    const t = await db.orders.getWithTracking(req.params.id);
    if (!t) return res.status(404).json({ error: 'Order not found' });
    const isOwner = String(t.order.userId) === String(req.user.id);
    const isRider = String(t.order.riderId) === String(req.user.id);
    if (!isOwner && !isRider && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Search analytics ─────────────────────────────────────────────────────
app.post('/api/search/log', async (req, res) => {
  const { query, resultCount } = req.body || {};
  try { await db.searchLog.record(query, req.user ? req.user.id : null, resultCount); res.json({ ok: true }); }
  catch (_) { res.json({ ok: true }); }
});
app.get('/api/admin/search/top', requireAdmin, async (req, res) => {
  try { res.json(await db.searchLog.topQueries({ days: parseInt(req.query.days) || 30, limit: parseInt(req.query.limit) || 20 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/search/unmatched', requireAdmin, async (req, res) => {
  try { res.json(await db.searchLog.unmatchedQueries({ days: parseInt(req.query.days) || 30, limit: parseInt(req.query.limit) || 20 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Saved addresses ──────────────────────────────────────────────────────
app.get('/api/me/addresses', requireAuth, async (req, res) => {
  try { res.json(await db.addresses.list(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Update profile (name + phone)
app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  try {
    const { data, error } = await db.sb.from('users').update({
      name: String(name || req.user.name).slice(0, 100),
      phone: String(phone || '').slice(0, 30),
    }).eq('id', req.user.id).select().single();
    if (error) throw error;
    const out = {}; for (const k of Object.keys(data)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = data[k];
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reviews ──────────────────────────────────────────────────────────────
app.get('/api/products/:id/reviews', async (req, res) => {
  try { res.json(await db.reviews.forProduct(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/products/reviews/summary', async (req, res) => {
  // ?ids=1,2,3
  try {
    const ids = String(req.query.ids || '').split(',').map(s => parseInt(s)).filter(Boolean);
    res.json(await db.reviews.summaryForProducts(ids));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/me/pending-reviews', requireAuth, async (req, res) => {
  try { res.json(await db.reviews.pendingForUser(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/me/reviews', requireAuth, async (req, res) => {
  const { productId, orderId, rating, message } = req.body || {};
  if (!productId || !rating) return res.status(400).json({ error: 'productId and rating required' });
  try { res.json(await db.reviews.create({ userId: req.user.id, productId, orderId, rating, message })); }
  catch (e) { res.status(400).json({ error: e.message }); }
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
    res.json(rep);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/issue-reports', requireAdmin, async (req, res) => {
  try { res.json(await db.issueReports.listAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/issue-reports/:id/resolve', requireAdmin, async (req, res) => {
  try { await db.issueReports.resolve(req.params.id, (req.body && req.body.note) || ''); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cancel order (customer, within 15 min of placement) ──────────────────
app.post('/api/me/orders/:id/cancel', requireAuth, async (req, res) => {
  const result = await db.cancelOrder(req.params.id, req.user.id, (req.body && req.body.reason) || '');
  if (!result || result.error) return res.status(400).json({ error: (result && result.error) || 'Cancel failed' });
  res.json({ ok: true });
});

// ── Health check (for UptimeRobot / load balancers) ──────────────────────
// Lightweight: no DB hit, returns instantly so pings are cheap.
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Admin: operational metrics dashboard ─────────────────────────────────
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  try {
    const days = Math.max(7, Math.min(90, parseInt(req.query.days) || 30));
    res.json(await db.metrics.overview({ days }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Referral leaderboard ─────────────────────────────────────────────────
app.get('/api/admin/leaderboard', requireAdmin, async (req, res) => {
  try { res.json(await db.leaderboard.topReferrers(parseInt(req.query.limit) || 10)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Public version (first names only) for the squad page gamification
app.get('/api/leaderboard', async (req, res) => {
  try {
    const list = await db.leaderboard.topReferrers(10);
    res.json(list.map(u => ({
      name: (u.name || 'A friend').split(' ')[0],
      referralCount: u.referralCount,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: error logs ────────────────────────────────────────────────────
app.get('/api/admin/errors', requireAdmin, async (req, res) => {
  try { res.json(await db.errorLog.list(parseInt(req.query.limit) || 100)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/errors', requireAdmin, async (req, res) => {
  try { await db.errorLog.clear(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live counter ─────────────────────────────────────────────────────────
app.get('/api/stats/delivered-count', async (req, res) => {
  try {
    const c = await db.stats.counts();
    // Show whichever is larger so the ticker shows from the very first order placed,
    // while still preferring the (more impressive) delivered count once it climbs.
    res.json({ count: Math.max(c.delivered, c.total), delivered: c.delivered, total: c.total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Promotions ───────────────────────────────────────────────────────────
app.get('/api/promotions/active', async (req, res) => {
  try { res.json(await db.promotions.listActive()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/promotions', requireAdmin, async (req, res) => {
  try { res.json(await db.promotions.listAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/promotions', requireAdmin, async (req, res) => {
  try { res.json(await db.promotions.create(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/promotions/:id', requireAdmin, async (req, res) => {
  try { await db.promotions.delete(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({
              title: `⚡ ${promo.title}`,
              body: promo.description || `Up to ${promo.discountPercent}% off — limited time`,
              url: '/', tag: `promo-${promo.id}`,
            }));
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubs.remove(s.endpoint);
          }
        }));
        await db.promotions.markPushSent(promo.id);
      })().catch(e => console.warn('promo broadcast failed:', e.message));
    }
    res.json(promo);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Product requests ─────────────────────────────────────────────────────
app.post('/api/product-requests', async (req, res) => {
  const { name, whatsappNumber, callNumber, contactWhatsapp, contactCall, productName, notes } = req.body || {};
  if (!productName || !name) return res.status(400).json({ error: 'Your name and the item are required' });
  if (!whatsappNumber && !callNumber) return res.status(400).json({ error: 'Please give us at least one number to reach you' });
  try {
    const r = await db.productRequests.create({
      userId: req.user ? req.user.id : null,
      name, whatsappNumber, callNumber, contactWhatsapp, contactCall, productName, notes,
    });
    res.json({ ok: true, id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/product-requests', requireAdmin, async (req, res) => {
  try { res.json(await db.productRequests.listAll({ status: req.query.status || null })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/product-requests/:id', requireAdmin, async (req, res) => {
  try {
    const patch = req.body || {};
    if (patch.status === 'contacted') patch.contactedAt = new Date().toISOString();
    res.json(await db.productRequests.update(req.params.id, patch));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: upload product photo ──────────────────────────────────────────
app.post('/api/admin/upload-image', requireAdmin, async (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || !dataUrl.startsWith('data:')) return res.status(400).json({ error: 'dataUrl required' });
  try {
    const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid data url' });
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) return res.status(413).json({ error: 'image too large (max ~1.5MB)' });
    const url = await db.uploadProductPhoto(buf, mime);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: surprise extra on an order ────────────────────────────────────
app.post('/api/admin/orders/:id/surprise', requireAdmin, async (req, res) => {
  const { note } = req.body || {};
  try {
    await db.sb.from('orders').update({ surprise_extra: String(note || '').slice(0, 200) }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MoMo merchant numbers (admin-configured, read by checkout) ───────────
// Stored in app_config under key 'momo_numbers' as { mtn, telecel, at, name }
app.get('/api/momo/numbers', async (req, res) => {
  try {
    const cfg = (await db.appConfig.get('momo_numbers')) || {};
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Store settings (admin-toggleable site behaviour) ─────────────────────
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    res.json({
      showFreshness: !!(await db.appConfig.get('show_freshness')),
      storeName: (await db.appConfig.get('store_name')) || 'SDGMart',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const { showFreshness, storeName } = req.body || {};
  try {
    if (showFreshness != null) await db.appConfig.set('show_freshness', !!showFreshness);
    if (storeName != null) await db.appConfig.set('store_name', String(storeName).slice(0, 60));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recurring orders ─────────────────────────────────────────────────────
app.get('/api/me/recurring', requireAuth, async (req, res) => {
  try { res.json(await db.recurring.listForUser(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/me/recurring', requireAuth, async (req, res) => {
  const { items, cadenceDays, nextRunAt, deliveryInfo } = req.body || {};
  if (!Array.isArray(items) || !items.length || !cadenceDays || !nextRunAt) return res.status(400).json({ error: 'items, cadenceDays, nextRunAt required' });
  try { res.json(await db.recurring.create({ userId: req.user.id, items, cadenceDays: parseInt(cadenceDays), nextRunAt, deliveryInfo })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/me/recurring/:id', requireAuth, async (req, res) => {
  try { res.json(await db.recurring.setActive(req.params.id, req.user.id, !!req.body.active)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/me/recurring/:id', requireAuth, async (req, res) => {
  try { await db.recurring.delete(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Static files ─────────────────────────────────────────────────────────
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.use(express.static(__dirname, { index: 'SDGMart.html' }));

// ── Global error handler (must be last) ──────────────────────────────────
// Logs any unhandled route error to the error_logs table + console, then
// returns a clean 500. Optionally forwards to Sentry if SENTRY_DSN is set.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  db.errorLog.record({
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? err.stack : '',
    path: req.originalUrl, method: req.method, status: 500,
    userId: req.user ? req.user.id : null,
  });
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our end.' });
});

// Process-level safety nets — log crashes instead of dying silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  db.errorLog.record({ message: 'unhandledRejection: ' + (reason && reason.message ? reason.message : String(reason)), stack: reason && reason.stack ? reason.stack : '' });
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  db.errorLog.record({ message: 'uncaughtException: ' + err.message, stack: err.stack });
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
    console.log(`   Admin login: ${db.ADMIN_EMAIL} (default password: ${db.ADMIN_DEFAULT_PW})`);
  });
}

start();
