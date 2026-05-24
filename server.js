// Load .env file in dev. In production (Render) env vars come from the
// platform dashboard, so this is a no-op there.
try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const db = require('./database');

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
app.use(express.json({ limit: '1mb' }));

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
    const js = `
const PRODUCTS = ${JSON.stringify(productsList)};
const CATEGORIES = ${JSON.stringify(categories)};
const ESSENTIALS = ${JSON.stringify(essentials)};
const NEIGHBORHOODS = ${JSON.stringify(neighborhoods)};
const TOP_IDS_BY_ORDERS = ${JSON.stringify(TOP_IDS_BY_ORDERS)};
if (typeof window !== 'undefined') {
  window.PRODUCTS = PRODUCTS;
  window.CATEGORIES = CATEGORIES;
  window.ESSENTIALS = ESSENTIALS;
  window.NEIGHBORHOODS = NEIGHBORHOODS;
  window.TOP_IDS_BY_ORDERS = TOP_IDS_BY_ORDERS;
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

app.post('/api/orders', async (req, res) => {
  if (req.user && req.user.role !== 'rider' && req.user.emailVerified === false) {
    return res.status(403).json({ error: 'Please verify your email before placing an order.' });
  }
  try {
    const {
      customer, phone, neighborhood, address,
      items, total, delivery,
      recipientName, recipientPhone, recipientAddress, payMethod, momoNumber,
      subtotal, discountApplied, loyaltyUsed, location,
    } = req.body;
    const userId = req.user ? req.user.id : null;
    const now = new Date();
    const afterCutoff = now.getHours() >= 14;
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
      paymentMethod: payMethod || 'momo', momoNumber: momoNumber || '',
      status: 'queued', location: loc, deliveryDate: deliveryDateStr, priority: afterCutoff,
    });

    let squadInfo = null;
    if (userId) {
      if (discountApplied) await db.squads.consumeDiscount(userId);
      if (loyaltyUsed) await db.squads.consumeLoyalty(userId, loyaltyUsed);
      squadInfo = await db.squads.recordSpend(userId, Number(subtotal || total || 0));
    }
    res.status(201).json({
      ok: true, id: created.id,
      deliveryDate: deliveryDateStr, priority: afterCutoff,
      loyaltyEarned: squadInfo ? squadInfo.loyaltyEarned : 0,
      squadGoalHit: !!(squadInfo && squadInfo.squadGoalHit),
    });
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
    console.log(`✉️  Verification link for ${u.email}: ${verifyLink}`);
    const token = await db.sessions.create(u.id);
    res.status(201).json({ user: publicUser(u), token, verificationLink: verifyLink, message: 'Account created. Please verify your email.' });
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
  console.log(`✉️  Re-sent verification for ${req.user.email}: ${verifyLink}`);
  res.json({ ok: true, verificationLink: verifyLink });
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
    console.log(`🔑 Password reset link for ${u.email}: ${link}`);
    res.json({ ok: true, resetLink: link });
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
