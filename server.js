const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const db = require('./database');

// Google OAuth client ID — set GOOGLE_CLIENT_ID in your environment to enable
// "Sign in with Google". Get one at https://console.cloud.google.com/apis/credentials.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let _googleClient = null;
function getGoogleClient() {
  if (!GOOGLE_CLIENT_ID) return null;
  if (_googleClient) return _googleClient;
  try {
    const { OAuth2Client } = require('google-auth-library');
    _googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
    return _googleClient;
  } catch (e) {
    console.warn('⚠️  google-auth-library not installed — Google sign-in disabled');
    return null;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render/Fly/Railway load balancers — needed for correct
// req.protocol (https vs http) and req.ip (real client, not proxy).
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// ── Session-based auth middleware ─────────────────────────────────────────
// Reads a Bearer token (or X-Session-Token header) and attaches `req.user`.
function authMiddleware(req, res, next) {
  let token = '';
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) token = req.headers['x-session-token'] || '';
  const sess = db.sessions.get(token);
  req.user = sess ? db.users.get(sess.userId) : null;
  req.token = token;
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
app.use(authMiddleware);

// ── Generate PNG icon (solid color, no external deps) ─────────────────────
function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCRCTable();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return ((crc ^ 0xFFFFFFFF) >>> 0);
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}
function createSolidPNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      raw[y * rowSize + 1 + x * 3] = r;
      raw[y * rowSize + 2 + x * 3] = g;
      raw[y * rowSize + 3 + x * 3] = b;
    }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function ensureIcons() {
  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);
  const r = 78, g = 139, b = 63; // #4E8B3F sage green
  if (!fs.existsSync(path.join(iconsDir, 'icon-192.png')))
    fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createSolidPNG(192, r, g, b));
  if (!fs.existsSync(path.join(iconsDir, 'icon-512.png')))
    fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createSolidPNG(512, r, g, b));
}
ensureIcons();

// ── Dynamic products.js (served from DB, replaces static file) ────────────
app.get('/data/products.js', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all().map(p => ({
    ...p,
    bestseller: p.bestseller === 1 || p.bestseller === true,
    img: p.img || null,
  }));
  // Pre-compute top sellers by order frequency so the homepage has something
  // sensible even before /api/products/top is fetched.
  const orders = db.prepare('SELECT * FROM orders').all();
  const counts = {};
  orders.forEach(o => {
    let items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    (items || []).forEach(i => { counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); });
  });
  const TOP_IDS_BY_ORDERS = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => Number(id));
  const categories = ["Cereals","Dairy","Detergents","Rice & Grains","Cooking Oil","Snacks","Canned Foods","Drinks","Desserts"];
  const essentials = [1, 5, 13, 17, 9, 29, 25, 22, 3];
  const neighborhoods = ["Tamale Central","Kalpohin","Lamashegu","Sagnarigu","Nyohini","Choggu","Kalpohini","Vittin","Tishigu","Gumbihini","Jisonayili"];
  const js = `
const PRODUCTS = ${JSON.stringify(products)};
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
});

// ── Products API ───────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all().map(p => ({
    ...p, bestseller: p.bestseller === 1 || p.bestseller === true, img: p.img || null,
  }));
  res.json(products);
});

// Top sellers — based on order frequency. Falls back to a randomised pick
// when there aren't enough real orders yet.
app.get('/api/products/top', (req, res) => {
  const limit = Math.max(1, Math.min(20, parseInt(req.query.limit) || 8));
  const products = db.prepare('SELECT * FROM products').all().map(p => ({
    ...p, bestseller: p.bestseller === 1 || p.bestseller === true, img: p.img || null,
  }));
  const orders = db.prepare('SELECT * FROM orders').all();

  // Tally quantities per product id from order history
  const counts = {};
  orders.forEach(o => {
    let items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    (items || []).forEach(i => { counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); });
  });

  const ranked = products
    .map(p => ({ ...p, _orderCount: counts[p.id] || 0 }))
    .sort((a, b) => b._orderCount - a._orderCount);

  const realTop = ranked.filter(p => p._orderCount > 0).slice(0, limit);

  // If we don't have enough real top sellers yet, top up with a random sample
  if (realTop.length < limit) {
    const need = limit - realTop.length;
    const remaining = ranked.filter(p => p._orderCount === 0);
    // Fisher–Yates shuffle of `remaining`
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    realTop.push(...remaining.slice(0, need));
  }
  res.json(realTop);
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ ...p, bestseller: p.bestseller === 1 || p.bestseller === true });
});

app.post('/api/products', requireAdmin, (req, res) => {
  const { name, category, price, unit, bestBefore, stock, description, bestseller } = req.body;
  const result = db.prepare(
    'INSERT INTO products (name, category, price, unit, bestBefore, stock, description, bestseller) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, category, parseFloat(price), unit, bestBefore, parseInt(stock) || 0, description || '', bestseller ? 1 : 0);
  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...created, bestseller: created.bestseller === 1 || created.bestseller === true });
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const { name, category, price, unit, bestBefore, stock, description, bestseller } = req.body;
  db.prepare(
    'UPDATE products SET name=?, category=?, price=?, unit=?, bestBefore=?, stock=?, description=?, bestseller=? WHERE id=?'
  ).run(name, category, parseFloat(price), unit, bestBefore, parseInt(stock) || 0, description || '', bestseller ? 1 : 0, req.params.id);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ ...updated, bestseller: updated.bestseller === 1 || updated.bestseller === true });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Orders API ─────────────────────────────────────────────────────────────
app.get('/api/orders', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC').all().map(o => ({
    ...o,
    items: JSON.parse(o.items || '[]'),
    familyMode: o.familyMode === 1,
  }));
  res.json(orders);
});

app.post('/api/orders', (req, res) => {
  // Signed-in users must have a verified email to place orders.
  // Guest checkouts (no req.user) remain allowed.
  if (req.user && req.user.emailVerified === false) {
    return res.status(403).json({ error: 'Please verify your email before placing an order.' });
  }
  const {
    id, customer, phone, neighborhood, address,
    items, total, delivery, familyMode,
    recipientName, recipientPhone, recipientAddress,
    giftMessage, payMethod, mapsPin,
    subtotal, discountApplied,
    location, // { lat, lng, address }
  } = req.body;
  // Trust the session for userId; ignore any client-supplied userId.
  const userId = req.user ? req.user.id : null;
  db.prepare(`
    INSERT INTO orders (id, customer, phone, neighborhood, address, items, total, delivery,
      familyMode, recipientName, recipientPhone, recipientAddress, giftMessage, payMethod, mapsPin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, customer, phone, neighborhood, address || '',
    JSON.stringify(items || []), total, delivery || 0,
    familyMode ? 1 : 0,
    recipientName || '', recipientPhone || '', recipientAddress || '',
    giftMessage || '', payMethod || 'momo', mapsPin || ''
  );

  // Persist location, userId, deliveryDate, and priority.
  // Rules (all times local server time):
  //   Order placed BEFORE 14:00 → deliveryDate = today (joins today's 2pm batch)
  //   Order placed AT/AFTER 14:00 → deliveryDate = tomorrow, priority=true
  //                                  (gets assigned first when the next 2pm batch starts)
  const orderRow = db.prepare('SELECT * FROM orders').get(id);
  if (orderRow) {
    const loc = location && typeof location.lat === 'number' ? location : null;
    const now = new Date();
    const afterCutoff = now.getHours() >= 14;
    const deliveryDate = new Date(now);
    if (afterCutoff) deliveryDate.setDate(deliveryDate.getDate() + 1);
    const deliveryDateStr = deliveryDate.toISOString().slice(0, 10); // YYYY-MM-DD
    db.attachOrderLocation(id, loc, userId, { deliveryDate: deliveryDateStr, priority: afterCutoff });
  }

  // If signed-in user, accumulate spend and possibly unlock squad discount.
  let squadInfo = null;
  if (userId) {
    if (discountApplied) db.squads.consumeDiscount(userId);
    const spendAmount = Number(subtotal || total || 0);
    squadInfo = db.squads.recordSpend(userId, spendAmount);
  }
  res.status(201).json({
    ok: true,
    id,
    squadDiscountUnlocked: squadInfo ? squadInfo.discountUnlocked : false,
  });
});

app.put('/api/orders/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

app.get('/api/orders/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json({ ...order, items: JSON.parse(order.items || '[]'), familyMode: order.familyMode === 1 });
});

// ── Auth: signup / login / logout / me ────────────────────────────────────
// `publicUser` strips the password hash before returning the user to the client.
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, password, ...rest } = u;
  return rest;
}

// Helper for rate-limit keys — prefer X-Forwarded-For when behind a proxy.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

app.post('/api/auth/signup', (req, res) => {
  const { name, email, phone, password, refCode } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  const pwErr = db.validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    const u = db.users.create({ name, email, phone, password, refCode, role: 'customer' });
    // Issue an email-verification token. In production swap the console.log
    // for an actual email send (Nodemailer/SendGrid/SES).
    const verifyToken = db.makeEmailToken(u.id);
    const verifyLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${verifyToken}`;
    console.log(`✉️  Verification link for ${u.email}: ${verifyLink}`);
    const token = db.sessions.create(u.id);
    res.status(201).json({
      user: publicUser(u),
      token,
      verificationLink: verifyLink, // surfaced to the UI for dev convenience
      message: 'Account created. Please verify your email — link printed to server console.',
    });
  } catch (e) {
    res.status(409).json({ error: e.message || 'Signup failed' });
  }
});

// Rate limiter: 5 attempts per 5 minutes per IP+email; 15-minute lockout when exceeded.
const LOGIN_LIMIT = { windowMs: 5 * 60 * 1000, max: 5, blockMs: 15 * 60 * 1000 };

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const ip = clientIp(req);
  const key = `login:${ip}:${String(email).toLowerCase()}`;
  const rl = db.rateCheck(key, LOGIN_LIMIT);
  if (!rl.allowed) {
    res.set('Retry-After', String(rl.retryAfter));
    return res.status(429).json({
      error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} minute(s).`,
    });
  }
  const u = db.users.verifyCredentials(email, password);
  if (!u) return res.status(401).json({ error: 'Wrong email or password' });
  // Successful login → reset the rate counter for this key
  db.rateClear(key);
  const token = db.sessions.create(u.id);
  res.json({ user: publicUser(u), token });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.token) db.sessions.destroy(req.token);
  res.json({ ok: true });
});

// Tells the frontend whether Google sign-in is configured (and what client ID
// to use). Safe to expose — Google client IDs are public by design.
app.get('/api/auth/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

// Verify a Google ID token and sign the user in (creating the account if new).
app.post('/api/auth/google', async (req, res) => {
  const client = getGoogleClient();
  if (!client) return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  const { credential, refCode } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) {
      return res.status(400).json({ error: 'Google did not return a verified email' });
    }
    const u = db.users.findOrCreateGoogle({
      email: payload.email,
      name: payload.name || payload.given_name || 'Google User',
      googleId: payload.sub,
      picture: payload.picture,
      refCode,
    });
    const token = db.sessions.create(u.id);
    res.json({ user: publicUser(u), token });
  } catch (e) {
    console.error('Google verify failed:', e.message);
    res.status(401).json({ error: 'Invalid or expired Google token' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// Email verification — opening the link in any browser confirms the address.
app.get('/api/auth/verify', (req, res) => {
  const userId = db.consumeEmailToken(req.query.token);
  if (!userId) return res.status(400).send('Verification link is invalid or expired.');
  db.users.markEmailVerified(userId);
  res.send('<h2 style="font-family:sans-serif;max-width:480px;margin:60px auto;color:#2F6124">✅ Email verified.</h2><p style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#666">You can return to SDGMart and continue shopping.</p>');
});

// Re-issue a verification email (e.g. user lost the link).
app.post('/api/auth/resend-verification', requireAuth, (req, res) => {
  if (req.user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const verifyToken = db.makeEmailToken(req.user.id);
  const verifyLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${verifyToken}`;
  console.log(`✉️  Re-sent verification for ${req.user.email}: ${verifyLink}`);
  res.json({ ok: true, verificationLink: verifyLink });
});

// Change password (requires current password). Rotates all sessions for the user.
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (!db.verifyPassword(currentPassword, req.user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const pwErr = db.validatePasswordStrength(newPassword, { isAdminChange: req.user.role === 'admin' });
  if (pwErr) return res.status(400).json({ error: pwErr });
  db.users.changePassword(req.user.id, newPassword);
  // Invalidate all existing sessions, then issue a fresh one for the current client.
  db.sessions.destroyAllForUser(req.user.id);
  const token = db.sessions.create(req.user.id);
  res.json({ ok: true, token });
});

// User profile — only the user themselves or admin can read it.
app.get('/api/users/:id', requireAuth, (req, res) => {
  const wantId = String(req.params.id);
  if (String(req.user.id) !== wantId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const u = db.users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(publicUser(u));
});

// Squad: returns the user + all squad members. Self or admin only.
app.get('/api/squads/:userId', requireAuth, (req, res) => {
  const wantId = String(req.params.userId);
  if (String(req.user.id) !== wantId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const u = db.users.get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const members = db.squads.members(u.squadCode).map(m => ({
    id: m.id,
    name: m.name,
    totalSpent: m.totalSpent || 0,
    discountPending: !!m.discountPending,
    isYou: m.id === u.id,
  }));
  res.json({
    me: publicUser(u),
    referralCode: u.referralCode,
    squadCode: u.squadCode,
    members,
    goal: 500,
  });
});

// ── Riders & order tracking ───────────────────────────────────────────────

// Admin-only middleware
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
function riderOnly(req, res, next) {
  if (!req.user || req.user.role !== 'rider') return res.status(403).json({ error: 'Rider only' });
  next();
}

// Admin: list all riders + create a new one (no public signup path)
app.get('/api/admin/riders', authMiddleware, adminOnly, (req, res) => {
  res.json(db.riders.list());
});
app.post('/api/admin/riders', authMiddleware, adminOnly, (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  try {
    const r = db.createRider({ name, email, phone, password });
    res.json({ id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Rider: post current location (called every ~15s by the rider PWA)
app.post('/api/rider/location', authMiddleware, riderOnly, (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat/lng required' });
  db.riders.setLocation(req.user.id, lat, lng);
  res.json({ ok: true });
});

// Rider: toggle online status
app.post('/api/rider/online', authMiddleware, riderOnly, (req, res) => {
  const { online } = req.body || {};
  db.riders.setOnline(req.user.id, !!online);
  // When going online, sweep eligible queued orders (only after 14:00 cutoff,
  // and only those whose deliveryDate is today or past).
  if (online) db.orders.assignQueuedForToday();
  res.json({ ok: true, online: !!online });
});

// Rider: get assigned orders, sorted by nearest-neighbor route.
// Also sweeps for newly-eligible orders so the queue stays fresh as time passes
// (e.g. clock crosses 14:00 while the rider is already online).
app.get('/api/rider/orders', authMiddleware, riderOnly, (req, res) => {
  db.orders.assignQueuedForToday();
  res.json(db.orders.forRider(req.user.id));
});

// Rider: update an order's status
app.post('/api/rider/orders/:id/status', authMiddleware, riderOnly, (req, res) => {
  const { status } = req.body || {};
  if (!['in_transit','delivered'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const o = db.orders.setStatus(req.params.id, status, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found or not yours' });
  res.json(o);
});

// Customer: poll order tracking (rider live location + queue position)
app.get('/api/orders/:id/tracking', authMiddleware, (req, res) => {
  const t = db.orders.getWithTracking(req.params.id);
  if (!t) return res.status(404).json({ error: 'Order not found' });
  // Only the order owner, the assigned rider, or admin can see tracking
  const isOwner = String(t.order.userId) === String(req.user.id);
  const isRider = String(t.order.riderId) === String(req.user.id);
  if (!isOwner && !isRider && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(t);
});

// ── Static files (icons, etc.) ─────────────────────────────────────────────
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.use(express.static(__dirname, { index: 'SDGMart.html' }));

// ── Start (HTTP + optional HTTPS) ─────────────────────────────────────────
// HTTPS is opt-in via SDGMART_HTTPS=1. On first start with that flag we
// auto-generate a self-signed cert into ./certs/. Browsers will show a
// warning for self-signed certs — accept it once, or import the cert into
// your trust store. For production, terminate TLS at a real reverse proxy.
function startHttp() {
  app.listen(PORT, () => {
    console.log(`\n🏪 SDGMart running at http://localhost:${PORT}`);
    console.log(`   Admin login: ${db.ADMIN_EMAIL} (default password: sdgadmin2026)`);
    if (process.env.SDGMART_HTTPS !== '1') {
      console.log(`   (HTTPS disabled — set SDGMART_HTTPS=1 to enable)\n`);
    }
  });
}

function startHttps() {
  const https = require('https');
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);
    try {
      // Try Node 20+ built-in X.509 self-signed generation via crypto.
      const { generateKeyPairSync, createPrivateKey, X509Certificate } = require('crypto');
      // Fallback: use the small `selfsigned` package if available.
      let selfsigned;
      try { selfsigned = require('selfsigned'); } catch (_) {}
      if (selfsigned) {
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048, algorithm: 'sha256' });
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
        console.log('🔐 Generated self-signed cert in ./certs/ (using selfsigned package)');
      } else {
        console.warn('⚠️  HTTPS requested but the `selfsigned` package is not installed.');
        console.warn('    Install it with:  npm install selfsigned');
        console.warn('    Or drop your own key.pem + cert.pem into ./certs/ and restart.');
        return;
      }
    } catch (e) {
      console.warn('⚠️  Could not generate self-signed cert:', e.message);
      return;
    }
  }

  const HTTPS_PORT = process.env.HTTPS_PORT ? Number(process.env.HTTPS_PORT) : 3443;
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    .listen(HTTPS_PORT, () => {
      console.log(`🔒 HTTPS at https://localhost:${HTTPS_PORT} (self-signed — accept the browser warning)\n`);
    });
}

startHttp();
if (process.env.SDGMART_HTTPS === '1') startHttps();
