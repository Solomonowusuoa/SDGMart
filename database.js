// SDGMart database layer — Supabase (Postgres) backed.
//
// All public methods are ASYNC. Server handlers must `await` every call.
//
// Required env vars (set in .env locally and Render in production):
//   SUPABASE_URL              = https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY      = your service_role key (server-only)
//   VAPID_PUBLIC_KEY          = (optional) overrides DB-stored VAPID
//   VAPID_PRIVATE_KEY         = (optional)
//
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required.');
  console.error('    Put them in .env locally and in Render → Environment in production.');
  process.exit(1);
}
// Every Supabase call gets a deadline. Node fetch has no default timeout, so a
// Supabase instance that stops responding rather than refusing — the usual shape
// of a degraded service — would leave requests hanging forever. On a single
// process those pile up until nothing is served at all: a slow dependency
// becomes a full outage. 10s is far above normal (single-digit ms) and far
// below a customer giving up.
const SUPABASE_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 10000);
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) }),
  },
});

// ── Admin bootstrap ──────────────────────────────────────────────────────
const ADMIN_EMAIL = 'solomonowusuoa@gmail.com';
const ADMIN_DEFAULT_PW = 'sdgadmin2026';

// ── Password rules ───────────────────────────────────────────────────────
function validatePasswordStrength(password, { isAdminChange = false } = {}) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain a letter.';
  if (!/\d/.test(pw)) return 'Password must contain a number.';
  if (isAdminChange && pw === ADMIN_DEFAULT_PW) return 'Pick a password different from the default.';
  return null;
}

// ── Password hashing (scrypt — same as before) ───────────────────────────
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const test = crypto.scryptSync(plain, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch (_) { return false; }
}

// ── camelCase ↔ snake_case helpers ───────────────────────────────────────
const camelToSnake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function rowOut(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const k of Object.keys(row)) out[snakeToCamel(k)] = row[k];
  return out;
}
function rowIn(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) out[camelToSnake(k)] = obj[k];
  return out;
}
function rowsOut(rows) { return Array.isArray(rows) ? rows.map(rowOut) : rows; }

// ── In-memory rate limiter (transient, intentionally not persisted) ──────
const rateBuckets = new Map();
function rateCheck(key, { windowMs = 5 * 60 * 1000, max = 5, blockMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b) { b = { hits: [], blockedUntil: 0 }; rateBuckets.set(key, b); }
  if (b.blockedUntil > now) return { allowed: false, retryAfterMs: b.blockedUntil - now };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) { b.blockedUntil = now + blockMs; return { allowed: false, retryAfterMs: blockMs }; }
  b.hits.push(now);
  return { allowed: true };
}
function rateClear(key) { rateBuckets.delete(key); }

// ── Products ─────────────────────────────────────────────────────────────
const products = {
  async list() {
    const { data, error } = await sb.from('products').select('*').order('id');
    if (error) throw error;
    return rowsOut(data);
  },
  // One round-trip for a whole basket, instead of one per line.
  async listByIds(ids) {
    if (!ids || !ids.length) return [];
    const { data, error } = await sb.from('products').select('*').in('id', ids);
    if (error) throw error;
    return rowsOut(data);
  },
  async get(id) {
    const { data, error } = await sb.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async create(p) {
    const { data, error } = await sb.from('products').insert(rowIn(p)).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async update(id, patch) {
    const { data, error } = await sb.from('products').update(rowIn(patch)).eq('id', id).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async delete(id) {
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
  async lowStock() {
    // Default threshold = 5 unless per-product override exists
    const { data, error } = await sb.from('products').select('*');
    if (error) throw error;
    return rowsOut(data).filter((p) => p.stock <= (p.lowStockThreshold ?? 5));
  },
  // Reduce stock for each ordered line item (used only when the deduct_stock
  // admin setting is ON). Best-effort read-modify-write; never throws.
  async decrementStock(items) {
    for (const it of (items || [])) {
      if (!it || it.id == null || it.birthdayGift) continue;
      try {
        const { data } = await sb.from('products').select('stock').eq('id', it.id).maybeSingle();
        if (!data) continue;
        const next = Math.max(0, Number(data.stock || 0) - Number(it.qty || 1));
        await sb.from('products').update({ stock: next }).eq('id', it.id);
      } catch (_) { /* keep going */ }
    }
  },
};

// ── Users ────────────────────────────────────────────────────────────────
const users = {
  async get(id) {
    const { data, error } = await sb.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async findByEmail(email) {
    // .eq, not .ilike: ilike made caller-supplied % and _ into SQL wildcards, so
    // probing a%, ab%, abc% binary-searched the whole user table. Every insert
    // already lowercases, and the accompanying migration normalises legacy rows.
    const { data, error } = await sb.from('users').select('*').eq('email', String(email || '').toLowerCase().trim()).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async findByRefCode(code) {
    if (!code) return null;
    const { data, error } = await sb.from('users').select('*').eq('ref_code', code.toUpperCase()).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async create({ name, email, phone, password, refCode, role = 'customer' }) {
    const passwordHash = password ? hashPassword(password) : null;
    // Look up the referrer (if any) — inherit their squadCode AND credit them
    let squadCode = null;
    let ownsSquad = false;
    let referrer = null;
    if (refCode) {
      referrer = await users.findByRefCode(refCode);
      if (referrer) {
        // Join the referrer's squad — no upper cap, so squads can grow past 5.
        // (The referral is still recorded via referred_by below regardless.)
        squadCode = referrer.squadCode || referrer.refCode;
      }
    }
    if (!squadCode) {
      // New user owns their own squad
      squadCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      ownsSquad = true;
    }
    const myRefCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const insert = {
      name, email: String(email).toLowerCase().trim(), phone, password_hash: passwordHash, role,
      ref_code: myRefCode, squad_code: squadCode, owns_squad: ownsSquad,
      // Record who referred them — credited only AFTER their first purchase.
      referred_by: referrer ? referrer.id : null,
    };
    const { data, error } = await sb.from('users').insert(insert).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async verifyCredentials(email, password) {
    const u = await users.findByEmail(email);
    if (!u || !u.passwordHash) return null;
    if (!verifyPassword(password, u.passwordHash)) return null;
    return u;
  },
  async changePassword(id, newPassword) {
    const passwordHash = hashPassword(newPassword);
    const { data, error } = await sb.from('users').update({ password_hash: passwordHash, must_change_password: false }).eq('id', id).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async markEmailVerified(id) {
    const { error } = await sb.from('users').update({ email_verified: true }).eq('id', id);
    if (error) throw error;
    return true;
  },
  async findOrCreateGoogle({ email, name, googleId, picture, refCode }) {
    const lower = String(email).toLowerCase();
    // Existing user by googleId or email
    let u = null;
    {
      const r = await sb.from('users').select('*').eq('google_id', googleId).maybeSingle();
      u = rowOut(r.data);
    }
    if (!u) {
      const r = await sb.from('users').select('*').eq('email', lower.trim()).maybeSingle();
      u = rowOut(r.data);
      if (u) {
        // Link google_id to existing email user and mark verified
        const upd = await sb.from('users').update({ google_id: googleId, email_verified: true, picture: picture || u.picture })
          .eq('id', u.id).select().single();
        u = rowOut(upd.data);
      }
    }
    if (!u) {
      // Brand new google user — create
      u = await users.create({ name, email: lower, phone: null, password: null, refCode, role: 'customer' });
      const upd = await sb.from('users').update({ google_id: googleId, email_verified: true, picture: picture || null })
        .eq('id', u.id).select().single();
      u = rowOut(upd.data);
    }
    return u;
  },
};

// ── Squads ───────────────────────────────────────────────────────────────
// ── Atomic balance updates (compare-and-swap) ────────────────────────────
// PostgREST cannot express `set x = x - $1`, and a plain read-modify-write
// loses money under concurrency: ten simultaneous checkouts all read the same
// loyalty balance, all pass the affordability check, and all get the discount —
// GHS 50 of credit paying out GHS 500. Here the write is made CONDITIONAL on
// the value the decision was based on (`expect`), so only one racer can win;
// the losers re-read and decide again. Needs no schema change.
//
// decide(user) returns null to decline, or { patch, expect, value }.
const CAS_ATTEMPTS = 5;
const money = (n) => Number(n || 0).toFixed(2);
async function casUser(userId, decide) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const u = await users.get(userId);
    if (!u) return { ok: false, reason: 'no-user' };
    const step = decide(u);
    if (!step) return { ok: false, reason: 'declined' };
    let q = sb.from('users').update(step.patch).eq('id', userId);
    for (const [col, expected] of Object.entries(step.expect || {})) {
      q = expected === null ? q.is(col, null) : q.eq(col, expected);
    }
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (data && data.length) return { ok: true, value: step.value };
    // Lost the race — another request changed the row first. Re-read and retry.
  }
  return { ok: false, reason: 'contention' };
}

const squads = {
  async members(squadCode) {
    if (!squadCode) return [];
    const { data, error } = await sb.from('users').select('*').eq('squad_code', squadCode);
    if (error) throw error;
    return rowsOut(data);
  },
  // Records spend, then if EVERY squad member has crossed GHS 500,
  // flag everyone as discountPending and reset their totals.
  // Also accrues loyalty: GHS 50 off per GHS 1000 spent (loyalty_balance).
  async recordSpend(userId, spendAmount) {
    const u = await users.get(userId);
    if (!u) return null;
    // Loyalty: every GHS 1000 of TOTAL spend across all time gives GHS 50
    // Conditional write: two deliveries settling at once must not both read the
    // same total_spent and both award a tier. casUser re-reads and retries.
    const spend = Number(spendAmount || 0);
    const applied = await casUser(userId, (cur) => {
      const prev = Number(cur.totalSpent || 0);
      const total = prev + spend;
      const earned = (Math.floor(total / 1000) - Math.floor(prev / 1000)) * 50;
      return {
        patch: { total_spent: money(total), loyalty_balance: money(Number(cur.loyaltyBalance || 0) + earned) },
        expect: { total_spent: money(prev), loyalty_balance: money(cur.loyaltyBalance) },
        value: { newTotal: total, loyaltyEarned: earned, newLoyalty: Number(cur.loyaltyBalance || 0) + earned },
      };
    });
    if (!applied.ok) { console.warn('recordSpend could not settle for user ' + userId + ' (' + applied.reason + ')'); return null; }
    const newTotal = applied.value.newTotal;
    const loyaltyEarned = applied.value.loyaltyEarned;
    const newLoyalty = applied.value.newLoyalty;

    // ── Squad goal logic ─────────────────────────────────────────────────
    // When every squad member's totalSpent has hit GHS 500 (the target),
    // each member is rewarded with GHS 25 (= 5% of the target) added
    // straight to their loyalty_balance. Spend OVER 500 rolls over into the
    // next round: a member at 730 restarts the new round at 230, not 0 —
    // early finishers don't lose the extra shopping they did while waiting
    // for squadmates.
    let squadBonus = 0;
    if (u.squadCode) {
      const members = await squads.members(u.squadCode);
      const allHit = members.length > 0 && members.every((m) =>
        (String(m.id) === String(userId) ? newTotal : Number(m.totalSpent || 0)) >= 500,
      );
      if (allHit) {
        squadBonus = 25; // 5% of 500
        // Award every member individually so we can add to their existing balance
        let myRollover = 0;
        for (const m of members) {
          const effectiveTotal = String(m.id) === String(userId) ? newTotal : Number(m.totalSpent || 0);
          const rollover = Math.max(0, effectiveTotal - 500);
          if (String(m.id) === String(userId)) myRollover = rollover;
          // Conditional per member: the squad bonus must not double-pay if two
          // members' deliveries land at the same moment.
          await casUser(m.id, (cur) => ({
            patch: {
              total_spent: money(rollover),
              loyalty_balance: money(Number(cur.loyaltyBalance || 0) + 25),
              discount_pending: false, // clear any legacy flag
            },
            expect: { loyalty_balance: money(cur.loyaltyBalance) },
            value: true,
          }));
        }
        // Return the awarding user's fresh balance so the UI updates right away
        return { totalSpent: myRollover, loyaltyEarned: loyaltyEarned + 25, loyaltyBalance: Number(u.loyaltyBalance || 0) + loyaltyEarned + 25, squadGoalHit: true };
      }
    }
    return { totalSpent: newTotal, loyaltyEarned, loyaltyBalance: newLoyalty, squadGoalHit: false };
  },
  // Claim the one-off squad discount. Succeeds for exactly one caller.
  async consumeDiscount(userId) {
    const r = await casUser(userId, (u) => (u.discountPending
      ? { patch: { discount_pending: false }, expect: { discount_pending: true }, value: true }
      : null));
    return r.ok && r.value === true;
  },
  // Spend loyalty credit. Returns the amount actually taken, and THROWS rather
  // than silently under-charging if the row is too contended to settle.
  async consumeLoyalty(userId, amount) {
    const want = Number(amount || 0);
    if (!(want > 0)) return 0;
    const r = await casUser(userId, (u) => {
      const bal = Number(u.loyaltyBalance || 0);
      const used = Math.min(bal, want);
      if (!(used > 0)) return null;
      return {
        patch: { loyalty_balance: money(bal - used) },
        expect: { loyalty_balance: money(bal) },
        value: used,
      };
    });
    if (r.ok) return r.value;
    if (r.reason === 'declined') return 0;          // no balance left
    throw new Error('Could not apply your loyalty credit just now — please try again');
  },
  // Give loyalty back (cancellation, or compensating a failed order).
  async addLoyalty(userId, amount) {
    const add = Number(amount || 0);
    if (!(add > 0)) return 0;
    const r = await casUser(userId, (u) => {
      const bal = Number(u.loyaltyBalance || 0);
      return {
        patch: { loyalty_balance: money(bal + add) },
        expect: { loyalty_balance: money(bal) },
        value: add,
      };
    });
    if (!r.ok) throw new Error('Could not restore loyalty credit for user ' + userId);
    return r.value;
  },
  // Hand the squad discount back after a failed or cancelled order.
  async restoreDiscount(userId) {
    const r = await casUser(userId, (u) => (u.discountPending
      ? null
      : { patch: { discount_pending: true }, expect: { discount_pending: false }, value: true }));
    return r.ok;
  },
  // Claim the first-order-free-delivery perk. Exactly one order can win it, so
  // parallel first orders can no longer each qualify (audit A-18).
  async claimFirstOrder(userId) {
    const r = await casUser(userId, (u) => (u.firstOrderDone
      ? null
      : { patch: { first_order_done: true }, expect: { first_order_done: false }, value: true }));
    return r.ok && r.value === true;
  },
  // Claim this year's birthday gift. Exactly one order per calendar year wins.
  async claimBirthdayGift(userId, year) {
    const r = await casUser(userId, (u) => (Number(u.birthdayGiftClaimedYear || 0) === Number(year)
      ? null
      : { patch: { birthday_gift_claimed_year: year },
          expect: { birthday_gift_claimed_year: u.birthdayGiftClaimedYear == null ? null : u.birthdayGiftClaimedYear },
          value: true }));
    return r.ok && r.value === true;
  },
  async releaseBirthdayGift(userId, year) {
    const r = await casUser(userId, (u) => (Number(u.birthdayGiftClaimedYear || 0) === Number(year)
      ? { patch: { birthday_gift_claimed_year: null }, expect: { birthday_gift_claimed_year: year }, value: true }
      : null));
    return r.ok;
  },
  async releaseFirstOrder(userId) {
    const r = await casUser(userId, (u) => (u.firstOrderDone
      ? { patch: { first_order_done: false }, expect: { first_order_done: true }, value: true }
      : null));
    return r.ok;
  },
};

// ── Sessions ─────────────────────────────────────────────────────────────
const SESSION_TTL_DAYS = 7;
const sessions = {
  async create(userId, userType = 'user') {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await sb.from('sessions').insert({ token, user_id: userId, user_type: userType, expires_at: expiresAt });
    if (error) throw error;
    return token;
  },
  async get(token) {
    if (!token) return null;
    const { data, error } = await sb.from('sessions').select('*').eq('token', token).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (new Date(data.expires_at) < new Date()) {
      await sb.from('sessions').delete().eq('token', token);
      return null;
    }
    return { token: data.token, userId: data.user_id, userType: data.user_type };
  },
  async destroy(token) {
    if (!token) return;
    await sb.from('sessions').delete().eq('token', token);
  },
  async destroyAllForUser(userId, userType = 'user') {
    await sb.from('sessions').delete().eq('user_id', userId).eq('user_type', userType);
  },
};

// ── Email tokens (verify + password reset) ───────────────────────────────
const EMAIL_TOKEN_TTL_HOURS = 24;
async function makeEmailToken(userId, purpose = 'verify') {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await sb.from('email_tokens').insert({ token, user_id: userId, purpose, expires_at: expiresAt });
  return token;
}
async function consumeEmailToken(token, expectedPurpose = null) {
  if (!token) return null;
  const { data } = await sb.from('email_tokens').select('*').eq('token', token).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await sb.from('email_tokens').delete().eq('token', token);
    return null;
  }
  if (expectedPurpose && data.purpose !== expectedPurpose) return null;
  await sb.from('email_tokens').delete().eq('token', token);
  return { userId: data.user_id, purpose: data.purpose };
}

// ── Riders ───────────────────────────────────────────────────────────────
const riders = {
  async list() {
    const { data, error } = await sb.from('riders').select('*').order('name');
    if (error) throw error;
    return rowsOut(data);
  },
  async get(id) {
    const { data, error } = await sb.from('riders').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async findByEmail(email) {
    const { data, error } = await sb.from('riders').select('*').eq('email', String(email || '').toLowerCase().trim()).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async setOnline(id, online) {
    await sb.from('riders').update({ online: !!online }).eq('id', id);
  },
  async setLocation(id, lat, lng) {
    await sb.from('riders').update({ lat, lng, last_location_at: new Date().toISOString() }).eq('id', id);
  },
  async verifyCredentials(email, password) {
    const r = await riders.findByEmail(email);
    if (!r) return null;
    if (!verifyPassword(password, r.passwordHash)) return null;
    return r;
  },
};

async function createRider({ name, email, phone, password }) {
  const { data, error } = await sb.from('riders').insert({
    name, email: String(email).toLowerCase().trim(), phone, password_hash: hashPassword(password),
  }).select().single();
  if (error) throw error;
  return rowOut(data);
}

// ── Orders ───────────────────────────────────────────────────────────────
const _distKm = (a, b) => {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 1e9;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
};

// Does orders.client_request_id exist yet? Probed once, loudly, instead of
// assuming — shipping code that writes a column before its migration has run is
// exactly what silently broke every order insert for a day (HANDOFF §10).
let _idempotencySupported = null;
async function ordersSupportIdempotency() {
  if (_idempotencySupported !== null) return _idempotencySupported;
  try {
    const { error } = await sb.from('orders').select('client_request_id').limit(1);
    _idempotencySupported = !error;
  } catch (_) { _idempotencySupported = false; }
  if (!_idempotencySupported) {
    console.warn('⚠️  orders.client_request_id is missing — run supabase-schema-order-idempotency.sql.');
    console.warn('   Duplicate-order protection is DISABLED until then; everything else works normally.');
  }
  return _idempotencySupported;
}

const orders = {
  async list({ status = null, limit = null } = {}) {
    let q = sb.from('orders').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return rowsOut(data);
  },
  async get(id) {
    const { data, error } = await sb.from('orders').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  // Has this exact checkout attempt already produced an order? Lets a retry
  // after a dropped response return the original instead of duplicating it.
  // One day's orders, for the revenue / cash-reconciliation view. Ghana is
  // UTC+0 with no daylight saving, so a UTC day boundary is the local day.
  async forDay(dateStr) {
    const start = dateStr + 'T00:00:00.000Z';
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    const { data, error } = await sb.from('orders')
      .select('id,total,paid,payment_method,status,rider_id,created_at,delivered_at,customer_name')
      .gte('created_at', start).lt('created_at', end)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return rowsOut(data);
  },
  async findByClientRequestId(key) {
    if (!key || !(await ordersSupportIdempotency())) return null;
    const { data } = await sb.from('orders').select('*').eq('client_request_id', key).maybeSingle();
    return data ? rowOut(data) : null;
  },
  async findByPaystackRef(ref) {
    if (!ref) return null;
    const { data } = await sb.from('orders').select('*').eq('paystack_ref', ref).maybeSingle();
    return rowOut(data);
  },
  async create(payload) {
    const row = rowIn(payload);
    if (row.client_request_id && !(await ordersSupportIdempotency())) delete row.client_request_id;
    else if (!row.client_request_id) delete row.client_request_id;
    const { data, error } = await sb.from('orders').insert(row).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async update(id, patch) {
    const { data, error } = await sb.from('orders').update(rowIn(patch)).eq('id', id).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async setStatus(id, status, riderId = null) {
    // Read the CURRENT state first: rewards are granted only on the transition
    // INTO 'delivered', never on a repeat call (riders on flaky connections tap
    // twice), and never on delivered -> delivered.
    const before = await orders.get(id);
    if (!before) return null;
    // A rider may only move an order that is ALREADY assigned to them. Without
    // this, any rider could walk sequential order ids, mark every live order
    // delivered, and take assignment of each one on the way — sending false
    // "Delivered" pushes and, now that rewards accrue on delivery, granting
    // them on orders that never arrived. Assignment is the admin's operation
    // (orders.assignToRider), so this path must never write rider_id.
    if (riderId != null && String(before.riderId || '') !== String(riderId)) return null;
    const o = await orders.update(id, { status });
    if (status === 'delivered' && before && before.status !== 'delivered' && before.userId) {
      // Accrual lives here, not at checkout — see createOrderFromBody. Best
      // effort: a failure must not block the rider marking the order delivered.
      try {
        const u = await users.get(before.userId);
        if (u) {
          await squads.recordSpend(before.userId, Number(before.subtotal || 0));
          await referrals.creditFirstPurchase(u);
        }
      } catch (e) { console.warn('reward accrual on delivery failed for order ' + id + ':', e.message); }
    }
    // Stamp the delivery time (separate best-effort write so the status
    // update above still succeeds if supabase-schema-delivered-at.sql
    // hasn't been run yet).
    if (status === 'delivered') {
      try { await sb.from('orders').update({ delivered_at: new Date().toISOString() }).eq('id', id); } catch (_) {}
    }
    return o;
  },
  // Admin manually assigns (or reassigns) an order to a specific rider.
  // Pass riderId=null to unassign and send the order back to the queue.
  async assignToRider(orderId, riderId) {
    const patch = riderId
      ? { rider_id: riderId, status: 'assigned' }
      : { rider_id: null, status: 'queued' };
    return await orders.update(orderId, patch);
  },
  async forRider(riderId) {
    const { data, error } = await sb.from('orders').select('*').eq('rider_id', riderId).in('status', ['assigned','in_transit']).order('created_at');
    if (error) throw error;
    const list = rowsOut(data);
    // Nearest-neighbor sort starting from the rider's current location
    const r = await riders.get(riderId);
    if (!r || r.lat == null) return list;
    const remaining = [...list];
    const ordered = [];
    let cursor = { lat: r.lat, lng: r.lng };
    while (remaining.length) {
      remaining.sort((a, b) => _distKm(cursor, a.location || {}) - _distKm(cursor, b.location || {}));
      const next = remaining.shift();
      ordered.push(next);
      cursor = next.location || cursor;
    }
    return ordered;
  },
  async getWithTracking(orderId) {
    const o = await orders.get(orderId);
    if (!o) return null;
    let rider = null;
    if (o.riderId) rider = await riders.get(o.riderId);
    // Position in this rider's route (1 = next, 2 = after that, etc.)
    let queuePosition = null;
    if (o.riderId && o.status === 'assigned') {
      const route = await orders.forRider(o.riderId);
      const idx = route.findIndex((x) => String(x.id) === String(orderId));
      queuePosition = idx >= 0 ? idx + 1 : null;
    }
    return { order: o, rider, queuePosition };
  },
  async assignToNearestOnlineRider(orderId) {
    const o = await orders.get(orderId);
    if (!o || !o.location) return null;
    const all = await riders.list();
    const online = all.filter((r) => r.online && r.lat != null);
    if (!online.length) return null;
    online.sort((a, b) => _distKm(o.location, a) - _distKm(o.location, b));
    await orders.update(orderId, { riderId: online[0].id, status: 'assigned' });
    return online[0];
  },
  async assignQueuedForToday() {
    const now = new Date();
    if (now.getHours() < 12) return [];
    const today = now.toISOString().slice(0, 10);
    const { data, error } = await sb.from('orders').select('*')
      .eq('status', 'queued').is('rider_id', null).not('location', 'is', null)
      .or(`delivery_date.is.null,delivery_date.lte.${today}`);
    if (error) throw error;
    const eligible = rowsOut(data).sort((a, b) => {
      if (!!b.priority - !!a.priority !== 0) return !!b.priority - !!a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    const assigned = [];
    for (const o of eligible) {
      const r = await orders.assignToNearestOnlineRider(o.id);
      if (r) assigned.push({ orderId: o.id, riderId: r.id });
    }
    return assigned;
  },
};

// Persist location + scheduling info on a freshly-created order
async function attachOrderLocation(orderId, location, userId, opts = {}) {
  const patch = { location: location || null };
  if (userId != null) patch.user_id = userId;
  if (opts.deliveryDate) patch.delivery_date = opts.deliveryDate;
  if (opts.priority != null) patch.priority = !!opts.priority;
  if (!patch.status) patch.status = 'queued';
  const { data, error } = await sb.from('orders').update(patch).eq('id', orderId).select().single();
  if (error) throw error;
  return rowOut(data);
}

// ── Push subscriptions ───────────────────────────────────────────────────
const pushSubs = {
  async forUser(userId) {
    const { data, error } = await sb.from('push_subscriptions').select('*').eq('user_id', userId);
    if (error) throw error;
    return rowsOut(data);
  },
  async add(userId, subscription) {
    await sb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    const { error } = await sb.from('push_subscriptions').insert({
      user_id: userId, endpoint: subscription.endpoint, keys: subscription.keys,
    });
    if (error) throw error;
  },
  async remove(endpoint) {
    await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  },
};

// ── Search analytics ─────────────────────────────────────────────────────
const searchLog = {
  async record(query, userId = null, resultCount = null) {
    if (!query || !String(query).trim()) return;
    await sb.from('search_queries').insert({
      query: String(query).trim().slice(0, 200),
      user_id: userId,
      result_count: resultCount,
    });
  },
  async topQueries({ days = 30, limit = 20 } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb.from('search_queries').select('query').gte('created_at', since);
    if (error) throw error;
    const counts = new Map();
    for (const r of data) {
      const q = String(r.query || '').toLowerCase();
      counts.set(q, (counts.get(q) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  },
  async unmatchedQueries({ days = 30, limit = 20 } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb.from('search_queries').select('query, result_count').gte('created_at', since).eq('result_count', 0);
    if (error) throw error;
    const counts = new Map();
    for (const r of data) {
      const q = String(r.query || '').toLowerCase();
      counts.set(q, (counts.get(q) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  },
};

// ── Recurring orders ─────────────────────────────────────────────────────
const recurring = {
  async listForUser(userId) {
    const { data, error } = await sb.from('recurring_orders').select('*').eq('user_id', userId).order('next_run_at');
    if (error) throw error;
    return rowsOut(data);
  },
  async create({ userId, items, cadenceDays, nextRunAt, deliveryInfo }) {
    const { data, error } = await sb.from('recurring_orders').insert({
      user_id: userId, items, cadence_days: cadenceDays,
      next_run_at: nextRunAt, delivery_info: deliveryInfo || null,
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async setActive(id, userId, active) {
    const { data, error } = await sb.from('recurring_orders').update({ active: !!active }).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async delete(id, userId) {
    await sb.from('recurring_orders').delete().eq('id', id).eq('user_id', userId);
  },
};

// ── Product requests (customer-submitted "do you sell X?") ───────────────
const productRequests = {
  async create({ userId, name, whatsappNumber, callNumber, contactWhatsapp, contactCall, productName, notes }) {
    const { data, error } = await sb.from('product_requests').insert({
      user_id: userId || null,
      name: String(name || '').slice(0, 100),
      whatsapp_number: whatsappNumber ? String(whatsappNumber).slice(0, 30) : null,
      call_number: callNumber ? String(callNumber).slice(0, 30) : null,
      contact_whatsapp: !!contactWhatsapp,
      contact_call: !!contactCall,
      product_name: String(productName || '').slice(0, 200),
      notes: String(notes || '').slice(0, 600),
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async listAll({ status = null } = {}) {
    let q = sb.from('product_requests').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return rowsOut(data);
  },
  async update(id, patch) {
    const { data, error } = await sb.from('product_requests').update(rowIn(patch)).eq('id', id).select().single();
    if (error) throw error;
    return rowOut(data);
  },
};

// ── App config (singleton key/value table) ───────────────────────────────
const appConfig = {
  async get(key) {
    const { data, error } = await sb.from('app_config').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data ? data.value : null;
  },
  async set(key, value) {
    const { error } = await sb.from('app_config').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};

// ── VAPID keys (env > app_config) ─────────────────────────────────────────
async function getVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const stored = await appConfig.get('vapid');
  if (stored && stored.publicKey && stored.privateKey) return stored;
  try {
    const webpush = require('web-push');
    const keys = webpush.generateVAPIDKeys();
    await appConfig.set('vapid', keys);
    return keys;
  } catch (_) {
    return null;
  }
}

// ── Bootstrap (ensure admin exists) ──────────────────────────────────────
async function bootstrap() {
  let admin = await users.findByEmail(ADMIN_EMAIL);
  if (!admin) {
    admin = await users.create({
      name: 'SDGMart Admin', email: ADMIN_EMAIL, phone: null,
      password: ADMIN_DEFAULT_PW, refCode: null, role: 'admin',
    });
    await sb.from('users').update({ email_verified: true, must_change_password: true }).eq('id', admin.id);
    console.log('🛠  Created admin account ' + ADMIN_EMAIL + ' (default pw: ' + ADMIN_DEFAULT_PW + ' — change immediately)');
  } else if (admin.passwordHash && verifyPassword(ADMIN_DEFAULT_PW, admin.passwordHash) && !admin.mustChangePassword) {
    await sb.from('users').update({ must_change_password: true }).eq('id', admin.id);
  }
}

// ── Saved addresses ──────────────────────────────────────────────────────
const addresses = {
  async list(userId) {
    const { data, error } = await sb.from('addresses').select('*').eq('user_id', userId).order('is_default', { ascending: false }).order('created_at');
    if (error) throw error;
    return rowsOut(data);
  },
  async create(userId, { label, neighborhood, address, location, isDefault }) {
    // First address a user saves becomes their default automatically.
    if (!isDefault) {
      const { count } = await sb.from('addresses').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (!count) isDefault = true;
    }
    if (isDefault) await sb.from('addresses').update({ is_default: false }).eq('user_id', userId);
    const { data, error } = await sb.from('addresses').insert({
      user_id: userId, label, neighborhood, address, location: location || null, is_default: !!isDefault,
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async update(userId, id, patch) {
    // Explicit allowlist. The patch was previously passed through wholesale, so
    // `{"userId": <victim id>, "isDefault": true}` moved the row into someone
    // else's account and became their default — rerouting their next delivery
    // to an address the attacker controls.
    const safe = {};
    for (const k of ['label', 'neighborhood', 'address', 'location', 'isDefault', 'isLastUsed']) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, k)) safe[k] = patch[k];
    }
    if (safe.isDefault) await sb.from('addresses').update({ is_default: false }).eq('user_id', userId);
    const { data, error } = await sb.from('addresses').update(rowIn(safe)).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async delete(userId, id) {
    await sb.from('addresses').delete().eq('id', id).eq('user_id', userId);
  },
  // Called automatically when an order is placed — marks the chosen location as the user's last-used
  async markLastUsed(userId, location, neighborhood) {
    await sb.from('addresses').update({ is_last_used: false }).eq('user_id', userId);
    if (!location || !location.lat) return;
    // Try to find an existing matching address (lat/lng within ~50m)
    const { data: existing } = await sb.from('addresses').select('*').eq('user_id', userId);
    let match = null;
    for (const a of (existing || [])) {
      if (a.location && Math.abs(a.location.lat - location.lat) < 0.0005 && Math.abs(a.location.lng - location.lng) < 0.0005) {
        match = a; break;
      }
    }
    if (match) {
      await sb.from('addresses').update({ is_last_used: true }).eq('id', match.id);
    } else {
      await sb.from('addresses').insert({
        user_id: userId, label: 'Recent', neighborhood, location, is_last_used: true,
      });
    }
  },
};

// ── Reviews ──────────────────────────────────────────────────────────────
const reviews = {
  async forProduct(productId) {
    const { data, error } = await sb.from('reviews').select('*').eq('product_id', productId).eq('approved', true).order('created_at', { ascending: false });
    if (error) throw error;
    return rowsOut(data);
  },
  async summaryForProducts(productIds) {
    if (!productIds || !productIds.length) return {};
    const { data, error } = await sb.from('reviews').select('product_id, rating').in('product_id', productIds).eq('approved', true);
    if (error) throw error;
    const out = {};
    (data || []).forEach(r => {
      if (!out[r.product_id]) out[r.product_id] = { sum: 0, count: 0 };
      out[r.product_id].sum += r.rating;
      out[r.product_id].count += 1;
    });
    Object.keys(out).forEach(k => { out[k] = { avg: out[k].sum / out[k].count, count: out[k].count }; });
    return out;
  },
  async create({ userId, productId, orderId, rating, message }) {
    const { data, error } = await sb.from('reviews').insert({
      user_id: userId, product_id: productId, order_id: orderId,
      rating: Math.max(1, Math.min(5, parseInt(rating))),
      message: (message || '').slice(0, 800),
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  // Order-level review ("how was your order?") — product_id NULL marks it.
  // Requires supabase-schema-order-reviews.sql (product_id made nullable).
  async createForOrder({ userId, orderId, rating, message }) {
    const { data, error } = await sb.from('reviews').insert({
      user_id: userId, product_id: null, order_id: orderId,
      rating: Math.max(1, Math.min(5, parseInt(rating))),
      message: (message || '').slice(0, 800),
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  // Returns recent delivered ORDERS the user hasn't reviewed yet (one prompt
  // per order — replaced the old per-product prompts). Any review row on the
  // order (order-level OR a legacy per-product one) counts as reviewed.
  async pendingForUser(userId) {
    const { data: ordrs } = await sb.from('orders').select('id, items, created_at').eq('user_id', userId).eq('status', 'delivered').order('created_at', { ascending: false }).limit(5);
    if (!ordrs || !ordrs.length) return [];
    const orderIds = ordrs.map(o => o.id);
    const { data: existing } = await sb.from('reviews').select('order_id').eq('user_id', userId).in('order_id', orderIds);
    const reviewed = new Set((existing || []).map(r => r.order_id));
    return ordrs.filter(o => !reviewed.has(o.id)).map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const names = items.filter(i => !i.birthdayGift).map(i => i.name);
      return {
        orderId: o.id,
        itemsSummary: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
      };
    }).slice(0, 3); // at most 3 order prompts at a time
  },
};

// ── Issue reports ────────────────────────────────────────────────────────
const issueReports = {
  async create({ orderId, userId, issueType, description }) {
    const { data, error } = await sb.from('issue_reports').insert({
      order_id: orderId, user_id: userId,
      issue_type: String(issueType || 'other').slice(0, 30),
      description: String(description || '').slice(0, 1000),
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async listAll() {
    const { data, error } = await sb.from('issue_reports')
      .select('*, users(name, email)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => {
      const { users: u, ...rest } = r;
      return { ...rowOut(rest), userName: u ? u.name : null, userEmail: u ? u.email : null };
    });
  },
  async resolve(id, note) {
    await sb.from('issue_reports').update({
      resolved: true, resolved_at: new Date().toISOString(), resolved_note: note || '',
    }).eq('id', id);
  },
};

// ── Promotions ───────────────────────────────────────────────────────────
const promotions = {
  async listActive() {
    const now = new Date().toISOString();
    const { data, error } = await sb.from('promotions').select('*')
      .eq('published', true).lte('starts_at', now).gte('ends_at', now)
      .order('starts_at', { ascending: false });
    if (error) throw error;
    return rowsOut(data);
  },
  async listAll() {
    const { data, error } = await sb.from('promotions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return rowsOut(data);
  },
  async get(id) {
    const { data, error } = await sb.from('promotions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return rowOut(data);
  },
  async create({ title, description, productIds, discountPercent, startsAt, endsAt }) {
    const { data, error } = await sb.from('promotions').insert({
      title, description: description || '',
      product_ids: productIds || [],
      discount_percent: parseInt(discountPercent),
      starts_at: startsAt, ends_at: endsAt,
    }).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async publish(id) {
    const { data, error } = await sb.from('promotions').update({
      published: true, published_at: new Date().toISOString(),
    }).eq('id', id).select().single();
    if (error) throw error;
    return rowOut(data);
  },
  async markPushSent(id) {
    await sb.from('promotions').update({ push_sent: true }).eq('id', id);
  },
  async delete(id) {
    await sb.from('promotions').delete().eq('id', id);
  },
};

// ── Stats (cached lightly) ───────────────────────────────────────────────
let _statsCache = { delivered: 0, total: 0, at: 0 };
const stats = {
  async counts() {
    if (Date.now() - _statsCache.at < 30000) return { delivered: _statsCache.delivered, total: _statsCache.total };
    const [delRes, totRes] = await Promise.all([
      sb.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered'),
      sb.from('orders').select('*', { count: 'exact', head: true }).neq('status', 'cancelled'),
    ]);
    _statsCache = {
      delivered: delRes.count || 0,
      total: totRes.count || 0,
      at: Date.now(),
    };
    return { delivered: _statsCache.delivered, total: _statsCache.total };
  },
  async deliveredCount() { return (await stats.counts()).delivered; },
  invalidateDelivered() { _statsCache.at = 0; },
};

// ── Operational metrics (admin dashboard) ───────────────────────────────
const metrics = {
  async overview({ days = 30 } = {}) {
    const since = new Date(Date.now() - days * 86400000);
    const { data: allOrders } = await sb.from('orders').select('*').gte('created_at', since.toISOString());
    const orders = rowsOut(allOrders || []);
    const nonCancelled = orders.filter(o => o.status !== 'cancelled');
    const delivered = orders.filter(o => o.status === 'delivered');

    // Per-day buckets (oldest → newest)
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const buckets = {};
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400000);
      buckets[k] = { date: k, orders: 0, revenue: 0 };
    }
    nonCancelled.forEach(o => {
      const k = dayKey(o.createdAt);
      if (buckets[k]) buckets[k].orders += 1;
    });
    delivered.forEach(o => {
      const k = dayKey(o.createdAt);
      if (buckets[k]) buckets[k].revenue += Number(o.total || 0);
    });
    const series = Object.values(buckets);

    // Status breakdown
    const statusBreakdown = {};
    orders.forEach(o => { const s = o.status || 'queued'; statusBreakdown[s] = (statusBreakdown[s] || 0) + 1; });

    // Top products + categories by quantity
    const prodQty = {}, catQty = {};
    nonCancelled.forEach(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      items.forEach(it => {
        const q = Number(it.qty || 1);
        prodQty[it.name] = (prodQty[it.name] || 0) + q;
        if (it.category) catQty[it.category] = (catQty[it.category] || 0) + q;
      });
    });
    const topProducts = Object.entries(prodQty).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, qty]) => ({ name, qty }));
    const topCategories = Object.entries(catQty).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, qty]) => ({ name, qty }));

    const totalRevenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0);
    const aov = nonCancelled.length ? (nonCancelled.reduce((s, o) => s + Number(o.total || 0), 0) / nonCancelled.length) : 0;

    // Lifetime customer + recurring counts
    const [{ count: customerCount }, { count: recurringCount }] = await Promise.all([
      sb.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer'),
      sb.from('recurring_orders').select('*', { count: 'exact', head: true }).eq('active', true),
    ]);

    return {
      days,
      series,
      statusBreakdown,
      topProducts,
      topCategories,
      totals: {
        orders: nonCancelled.length,
        delivered: delivered.length,
        revenue: totalRevenue,
        aov,
        customers: customerCount || 0,
        activeRecurring: recurringCount || 0,
      },
    };
  },
};

// ── Pending Paystack payments (draft stash) ──────────────────────────────
const pendingPayments = {
  async create(reference, userId, draft, amount) {
    await sb.from('pending_payments').insert({ reference, user_id: userId || null, draft, amount });
  },
  async get(reference) {
    const { data } = await sb.from('pending_payments').select('*').eq('reference', reference).maybeSingle();
    return data ? { reference: data.reference, userId: data.user_id, draft: data.draft, amount: data.amount } : null;
  },
  async delete(reference) {
    await sb.from('pending_payments').delete().eq('reference', reference);
  },
  // Drafts old enough that the customer has either paid or walked away, which
  // still have no order against their reference. A draft is only deleted after
  // its order is successfully created, so anything left here is either an
  // abandoned checkout (harmless) or a payment we took and failed to fulfil.
  // This customer's own abandoned checkouts. Used to hand their reserved
  // loyalty back the moment they start a new one, rather than making them wait
  // for a sweep.
  async listStaleForUser(userId, olderThanMinutes = 30) {
    if (!userId) return [];
    const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
    const { data } = await sb.from('pending_payments').select('*')
      .eq('user_id', userId).lt('created_at', cutoff).limit(10);
    return (data || []).map((r) => ({ reference: r.reference, userId: r.user_id, draft: r.draft, createdAt: r.created_at }));
  },
  async listOrphans({ olderThanMinutes = 15, limit = 50 } = {}) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
    const { data, error } = await sb.from('pending_payments').select('*')
      .lt('created_at', cutoff).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return [];
    const refs = rows.map((r) => r.reference);
    const { data: matched } = await sb.from('orders').select('paystack_ref').in('paystack_ref', refs);
    const claimed = new Set((matched || []).map((m) => m.paystack_ref));
    return rows.filter((r) => !claimed.has(r.reference)).map((r) => ({
      reference: r.reference, userId: r.user_id, amount: r.amount,
      createdAt: r.created_at, draft: r.draft,
    }));
  },
};

// ── Referrals: credit the referrer after the referee's FIRST purchase ─────
const referrals = {
  // Called once when a user completes their first order. If they were referred,
  // credit the referrer GHS 5 + log the referral under the current month.
  async creditFirstPurchase(refereeUser) {
    if (!refereeUser || !refereeUser.referredBy || refereeUser.referralCredited) return;
    try {
      const referrerId = refereeUser.referredBy;
      const referrer = await users.get(referrerId);
      if (!referrer) return;
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      // Claim the referee's credit FIRST, conditionally. Only one caller can
      // flip referral_credited false -> true, so concurrent deliveries cannot
      // pay the referrer twice (audit A-18).
      const claimed = await casUser(refereeUser.id, (cur) => (cur.referralCredited
        ? null
        : { patch: { referral_credited: true }, expect: { referral_credited: false }, value: true }));
      if (!claimed.ok) return;
      await sb.from('referrals').insert({ referrer_id: referrerId, referee_id: refereeUser.id, month });
      await casUser(referrerId, (cur) => ({
        patch: {
          loyalty_balance: money(Number(cur.loyaltyBalance || 0) + 5),
          referral_count: Number(cur.referralCount || 0) + 1,
        },
        expect: { loyalty_balance: money(cur.loyaltyBalance) },
        value: true,
      }));
    } catch (e) { console.warn('referral credit failed (run schema-referrals.sql?):', e.message); }
  },
};

// ── Monthly referral leaderboard (+ auto-award last month's winner) ───────
const leaderboard = {
  async topReferrers(limit = 10) {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const { data, error } = await sb.from('referrals').select('referrer_id').eq('month', month);
      if (error) { console.warn('leaderboard query failed (run schema-referrals.sql?):', error.message); return []; }
      const counts = {};
      (data || []).forEach(r => { counts[r.referrer_id] = (counts[r.referrer_id] || 0) + 1; });
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
      const out = [];
      for (const [rid, count] of ranked) {
        const u = await users.get(rid);
        out.push({ id: rid, name: (u && u.name) || 'A friend', referralCount: count, loyaltyBalance: u ? u.loyaltyBalance : 0 });
      }
      return out;
    } catch (e) { console.warn('leaderboard failed:', e.message); return []; }
  },
  // Award last month's top referrer GHS 15 (once). Cron-less: runs on demand,
  // idempotent via an app_config marker.
  async awardLastMonthWinner() {
    try {
      const now = new Date();
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonth = lastMonthDate.toISOString().slice(0, 7);
      const marker = await appConfig.get('leaderboard_awarded_month');
      if (marker === lastMonth) return null; // already awarded
      const { data } = await sb.from('referrals').select('referrer_id').eq('month', lastMonth);
      if (!data || !data.length) { await appConfig.set('leaderboard_awarded_month', lastMonth); return null; }
      const counts = {};
      data.forEach(r => { counts[r.referrer_id] = (counts[r.referrer_id] || 0) + 1; });
      const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const winner = await users.get(winnerId);
      if (winner) {
        await squads.addLoyalty(winnerId, 15);
      }
      await appConfig.set('leaderboard_awarded_month', lastMonth);
      return { winnerId, month: lastMonth };
    } catch (e) { console.warn('award winner failed:', e.message); return null; }
  },
};

// ── Error logging (in-house monitoring) ──────────────────────────────────
const errorLog = {
  async record({ message, stack, path: p, method, status, userId }) {
    try {
      await sb.from('error_logs').insert({
        message: String(message || '').slice(0, 500),
        stack: String(stack || '').slice(0, 4000),
        path: p ? String(p).slice(0, 200) : null,
        method: method || null,
        status: status || null,
        user_id: userId || null,
      });
    } catch (_) { /* never let logging throw */ }
  },
  async list(limit = 100) {
    const { data, error } = await sb.from('error_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return rowsOut(data);
  },
  async clear() {
    await sb.from('error_logs').delete().neq('id', 0);
  },
};

// ── Photo upload to Supabase Storage ─────────────────────────────────────
async function ensurePhotoBucket() {
  try {
    // Will return error if bucket already exists; we ignore that.
    await sb.storage.createBucket('product-photos', { public: true });
  } catch (_) {}
}
async function uploadProductPhoto(buffer, mimeType = 'image/jpeg') {
  await ensurePhotoBucket();
  const ext = (mimeType.split('/')[1] || 'jpg').replace('+xml', '');
  const path = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await sb.storage.from('product-photos').upload(path, buffer, {
    contentType: mimeType, cacheControl: '31536000',
  });
  if (error) throw error;
  const { data } = sb.storage.from('product-photos').getPublicUrl(path);
  return data.publicUrl;
}

// ── Cancel order ─────────────────────────────────────────────────────────
// Wraps orders.update with a reason + timestamp.
async function cancelOrder(orderId, userId, reason) {
  const o = await orders.get(orderId);
  if (!o) return null;
  // A guest order has user_id NULL. The old `o.userId &&` short-circuit meant
  // the check was SKIPPED for those, so any signed-in account could walk
  // sequential ids and cancel every guest order inside its 15-minute window.
  if (!o.userId || String(o.userId) !== String(userId)) return { error: 'not yours' };
  if (o.status !== 'queued') return { error: 'order is already being processed' };
  // 15-minute cancellation window
  const ageMin = (Date.now() - new Date(o.createdAt).getTime()) / 60000;
  if (ageMin > 15) return { error: 'cancellation window has passed (15 min)' };
  await sb.from('orders').update({
    status: 'cancelled',
    cancel_reason: String(reason || '').slice(0, 300),
    cancelled_at: new Date().toISOString(),
  }).eq('id', orderId);
  // Hand back whatever this order consumed. Without this a customer who spent
  // loyalty on an order and then cancelled simply lost the credit, and the
  // first-delivery-free perk stayed burned on an order that never happened.
  if (o.userId) { try { await reverseOrderRewards(o); } catch (e) { console.warn('reverseOrderRewards failed for order ' + orderId + ':', e.message); } }
  return { ok: true };
}

// Restore the value a cancelled order took from the customer. Accrual (spend
// tiers, squad progress, referral credit) is NOT reversed here because it is
// never granted until delivery — see orders.setStatus.
async function reverseOrderRewards(o) {
  const userId = o.userId;
  if (!userId) return;
  const u = await users.get(userId);
  if (!u) return;
  const patch = {};
  // 1. Loyalty the customer spent on this order.
  const spent = Number(o.loyaltyUsed || 0);
  if (spent > 0) patch.loyalty_balance = Number(u.loyaltyBalance || 0) + spent;
  // 2. The one-off squad discount, if this order used it.
  if (Number(o.discount || 0) > 0 && !u.discountPending) patch.discount_pending = true;
  // 3. The first-order-free-delivery perk: hand it back only when this customer
  //    has no other live order, i.e. this really was the order that used it.
  if (u.firstOrderDone) {
    const { data: others } = await sb.from('orders').select('id')
      .eq('user_id', userId).neq('status', 'cancelled').neq('id', o.id).limit(1);
    if (!others || !others.length) patch.first_order_done = false;
  }
  if (Object.keys(patch).length) await sb.from('users').update(patch).eq('id', userId);
}

// ── Persistent cart (signed-in users; syncs across devices) ──────────────
const carts = {
  async get(userId) {
    const { data, error } = await sb.from('carts').select('items').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data && Array.isArray(data.items) ? data.items : [];
  },
  async save(userId, items) {
    await sb.from('carts').upsert(
      { user_id: userId, items: Array.isArray(items) ? items : [], updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  },
};

module.exports = {
  sb,
  users, squads, sessions, riders, orders, products,
  addresses, reviews, issueReports, promotions, productRequests, stats,
  metrics, leaderboard, referrals, errorLog, pendingPayments,
  pushSubs, searchLog, recurring, appConfig, carts,
  rowOut, rowsOut,
  hashPassword, verifyPassword, validatePasswordStrength,
  rateCheck, rateClear,
  makeEmailToken, consumeEmailToken,
  createRider, attachOrderLocation,
  uploadProductPhoto, cancelOrder,
  getVapidKeys, bootstrap,
  ADMIN_EMAIL, ADMIN_DEFAULT_PW,
};
