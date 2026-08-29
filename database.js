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

// ── Schema drift check (audit B-07) ──────────────────────────────────────
// Shipping code that writes a column before its migration has run took every
// order down for a day (HANDOFF §10), and the failure was silent — inserts just
// errored into a swallowed catch. This asserts at startup that the columns the
// code actually writes exist, and says plainly which migration is missing.
// It only reports: a missing OPTIONAL column is a warning, so the app still
// boots and serves, but nobody has to discover the gap from a customer.
const REQUIRED_SCHEMA = [
  ['orders',   'paystack_ref',        'supabase-schema-paystack.sql',        true],
  ['orders',   'delivered_at',        'supabase-schema-delivered-at.sql',    true],
  ['orders',   'delivery_slot',       'supabase-schema-tweaks.sql',          true],
  ['orders',   'client_request_id',   'supabase-schema-order-idempotency.sql', false],
  ['users',    'referred_by',         'supabase-schema-referrals.sql',       true],
  // The A-18 concurrency fix claims this column before paying a referrer. If
  // it were missing the CAS would throw into a catch and credit would silently
  // never be paid, so the drift check has to see it too.
  ['users',    'referral_credited',   'supabase-schema-referrals.sql',       true],
  ['users',    'first_order_done',    'supabase-schema-additions.sql',       true],
  ['users',    'birthday_gift_claimed_year', 'supabase-schema-tweaks.sql',   true],
  ['carts',    'items',               'supabase-schema-cart.sql',            true],
  ['referrals', 'month',              'supabase-schema-referrals.sql',       true],
  ['pending_payments', 'draft',       'supabase-schema-paystack.sql',        true],
];

async function checkSchema() {
  const missing = [];
  for (const [table, column, migration, required] of REQUIRED_SCHEMA) {
    try {
      const { error } = await sb.from(table).select(column).limit(1);
      if (error) missing.push({ table, column, migration, required });
    } catch (_) {
      missing.push({ table, column, migration, required });
    }
  }
  if (!missing.length) { console.log('\u2713  Database schema matches what the code expects'); return { ok: true, missing }; }

  const blocking = missing.filter((m) => m.required);
  console.error('');
  console.error('\u26a0\ufe0f  SCHEMA DRIFT \u2014 ' + missing.length + ' expected column(s) are missing:');
  for (const m of missing) {
    console.error('     ' + (m.required ? 'REQUIRED' : 'optional') + '  ' + m.table + '.' + m.column + '   \u2192 run ' + m.migration);
  }
  if (blocking.length) {
    console.error('');
    console.error('   Writes touching these columns WILL FAIL. Run the migrations above');
    console.error('   (node scripts/migrate.js status) before taking orders.');
  }
  console.error('');
  return { ok: false, missing };
}

// ── Admin bootstrap ──────────────────────────────────────────────────────
// Audit A-16: the bootstrap password used to be a constant in this file and
// was printed to the Render log on every boot, so any restore, fresh project
// or DR rebuild stood up a live admin account whose password sat in the
// repository. It now comes from the environment; when that is unset a random
// one is generated and shown exactly once, as the account is created.
const ADMIN_EMAIL = 'solomonowusuoa@gmail.com';
const ADMIN_BOOTSTRAP_PW = process.env.ADMIN_BOOTSTRAP_PASSWORD || null;
// Kept only so an admin still sitting on the old repo default is detected and
// forced to change it. Never used to create an account.
const LEGACY_ADMIN_PW = 'sdgadmin2026';

// ── Password rules ───────────────────────────────────────────────────────
function validatePasswordStrength(password, { isAdminChange = false } = {}) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain a letter.';
  if (!/\d/.test(pw)) return 'Password must contain a number.';
  if (isAdminChange && (pw === LEGACY_ADMIN_PW || (ADMIN_BOOTSTRAP_PW && pw === ADMIN_BOOTSTRAP_PW))) return 'Pick a password different from the default.';
  return null;
}

// ── Password hashing (scrypt on the threadpool — audit A-14) ─────────────
// scryptSync blocks Node's single event loop for the whole derivation, so a
// stream of signups or logins stalled every other request, checkout included.
// The callback form hands the work to libuv's threadpool instead.
const SCRYPT_KEYLEN = 64;
function scryptAsync(plain, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, SCRYPT_KEYLEN, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(plain, salt)).toString('hex');
  return `${salt}:${hash}`;
}
async function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const expected = Buffer.from(hash, 'hex');
    const test = await scryptAsync(plain, salt);
    if (expected.length !== test.length) return false;
    return crypto.timingSafeEqual(expected, test);
  } catch (_) { return false; }
}
// Unknown-email logins used to return before any derivation ran, so the
// response time alone said whether an address was registered — the timing
// half of the enumeration channel A-11 closed. Burning one derivation
// against a fixed hash makes both paths cost the same.
const DUMMY_PASSWORD_HASH = '0'.repeat(32) + ':' + '0'.repeat(SCRYPT_KEYLEN * 2);
async function burnPasswordTiming(plain) {
  try { await verifyPassword(String(plain || ''), DUMMY_PASSWORD_HASH); } catch (_) {}
}

// ── Business timezone (audit B-11) ───────────────────────────────────────
// Delivery dates used toISOString() (UTC) while the noon cutoff used
// getHours() (server-local). They agreed only because Render happens to run
// UTC and Ghana has no daylight saving — an accident nothing in code, config
// or docs recorded, so setting TZ or moving region would have silently shifted
// the cutoff and dated orders to the wrong day. Both now come from one
// explicit zone. Stored instants were always correct (timestamptz throughout);
// only the derivation of "today" and "past noon" was ambiguous.
const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Africa/Accra';
const _dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const _hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ, hour: '2-digit', hour12: false,
});
// YYYY-MM-DD in the business timezone. en-CA formats exactly that way.
function businessDate(d = new Date()) { return _dateFmt.format(d); }
// 0-23 in the business timezone.
function businessHour(d = new Date()) { return parseInt(_hourFmt.format(d), 10); }
// Shift by whole days and re-derive — safe across any future DST change.
function businessDatePlus(days, d = new Date()) {
  const shifted = new Date(d.getTime() + days * 86400000);
  return businessDate(shifted);
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
// Single-process only: buckets clear on every deploy and a second instance
// would keep its own. Acceptable while Render runs one dyno — see D-11.
const rateBuckets = new Map();
const RATE_SWEEP_MS = 5 * 60 * 1000;
const RATE_IDLE_MS = 60 * 60 * 1000;
let rateSweptAt = 0;
// Keys embed caller-supplied values (emails, IPs), so without a sweep the Map
// is an unbounded leak an attacker can grow at will (audit A-13).
function rateSweep(now) {
  if (now - rateSweptAt < RATE_SWEEP_MS) return;
  rateSweptAt = now;
  for (const [k, v] of rateBuckets) {
    const idle = !v.hits.length || now - v.hits[v.hits.length - 1] > RATE_IDLE_MS;
    if (v.blockedUntil < now && idle) rateBuckets.delete(k);
  }
}
function rateCheck(key, { windowMs = 5 * 60 * 1000, max = 5, blockMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  rateSweep(now);
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
    const passwordHash = password ? await hashPassword(password) : null;
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
    // 6 bytes, not 3: 281 trillion codes instead of 16.7 million. Retried below
    // on the unique violation, so even a collision no longer breaks signup.
    const myRefCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const insert = {
      name, email: String(email).toLowerCase().trim(), phone, password_hash: passwordHash, role,
      ref_code: myRefCode, squad_code: squadCode, owns_squad: ownsSquad,
      // Record who referred them — credited only AFTER their first purchase.
      referred_by: referrer ? referrer.id : null,
    };
    let { data, error } = await sb.from('users').insert(insert).select().single();
    // A ref_code collision must not cost someone their signup. Retry with a
    // fresh code; anything else (a duplicate email, say) is a real error.
    for (let attempt = 0; attempt < 3 && error && /ref_code/i.test(error.message || ''); attempt++) {
      insert.ref_code = crypto.randomBytes(6).toString('hex').toUpperCase();
      ({ data, error } = await sb.from('users').insert(insert).select().single());
    }
    if (error) throw error;
    return rowOut(data);
  },
  async verifyCredentials(email, password) {
    const u = await users.findByEmail(email);
    // Spend the same scrypt time whether or not the address exists (A-14).
    if (!u || !u.passwordHash) { await burnPasswordTiming(password); return null; }
    if (!(await verifyPassword(password, u.passwordHash))) return null;
    return u;
  },
  async changePassword(id, newPassword) {
    const passwordHash = await hashPassword(newPassword);
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
        // Linking a Google identity to a row that ALREADY has a password is the
        // pre-hijacking case: because email verification is disabled, an
        // attacker can register victim@gmail.com with a password of their
        // choosing and wait. When the real owner later signs in with Google
        // they are linked into that existing row — and the attacker still holds
        // a working password for it.
        //
        // So on link, the pre-existing password and every session it created are
        // destroyed. The rightful owner keeps the account and their Google
        // sign-in; anyone holding a password for it is locked out and would have
        // to prove control of the mailbox to set a new one.
        const hijackRisk = !!u.passwordHash;
        const patch = { google_id: googleId, email_verified: true, picture: picture || u.picture };
        if (hijackRisk) patch.password_hash = null;
        const upd = await sb.from('users').update(patch).eq('id', u.id).select().single();
        u = rowOut(upd.data);
        if (hijackRisk) {
          console.warn('Google link cleared a pre-existing password on user ' + u.id + ' (possible pre-registration)');
          try { await sessions.destroyAllForUser(u.id); } catch (_) {}
        }
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
    if (!(await verifyPassword(password, r.passwordHash))) return null;
    return r;
  },
};

async function createRider({ name, email, phone, password }) {
  // Audit B-14: this route never ran the strength check, so rider accounts —
  // which reach customer-facing order data — could have one-character
  // passwords. Same rules as every other account.
  const pwErr = validatePasswordStrength(password);
  if (pwErr) throw new Error(pwErr);
  const { data, error } = await sb.from('riders').insert({
    name, email: String(email).toLowerCase().trim(), phone, password_hash: await hashPassword(password),
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
  // Just the item arrays, from a bounded recent window — for the bestseller
  // scan. orders.list() pulled EVERY column of EVERY order ever placed
  // (addresses, phone numbers, the lot) into Node memory to count line items,
  // on a path anonymous visitors trigger. That is the out-of-memory risk in a
  // 512 MB instance; this reads one column over 90 days instead (D-02).
  async recentItemsForCounts({ days = 90, limit = 5000 } = {}) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await sb.from('orders')
      .select('items')
      .gte('created_at', since)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((r) => r.items);
  },
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
    // Legal transitions only. A repeat call (a rider tapping twice on a flaky
    // connection is the normal case, not an attack) now changes nothing rather
    // than re-stamping delivered_at — which silently extended the guest
    // tracking window — and re-sending the customer's "Delivered" push.
    const LEGAL = {
      queued: ['assigned', 'in_transit', 'delivered', 'cancelled'],
      assigned: ['in_transit', 'delivered', 'queued', 'cancelled'],
      in_transit: ['delivered', 'assigned', 'cancelled'],
      delivered: [],      // terminal
      cancelled: [],      // terminal
    };
    const allowed = LEGAL[before.status] || [];
    if (before.status === status || !allowed.includes(status)) {
      console.warn('rejected order ' + id + ' transition ' + before.status + ' -> ' + status);
      return { ...before, unchanged: true };
    }
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
      // Count only what is ahead of this order, in the database, instead of
      // pulling the rider's whole route back and re-sorting it in JavaScript
      // just to read off an index (D-03).
      const { count } = await sb.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('rider_id', o.riderId).in('status', ['assigned', 'in_transit'])
        .lt('created_at', o.createdAt);
      queuePosition = (count || 0) + 1;
    }
    return { order: o, rider, queuePosition };
  },
  // `order` and `onlineRiders` may be passed in by a caller that already has
  // them, which is what turns assignQueuedForToday from 3 round-trips per order
  // into one (D-04).
  async assignToNearestOnlineRider(orderId, order = null, onlineRiders = null) {
    const o = order || await orders.get(orderId);
    if (!o || !o.location) return null;
    const online = onlineRiders || (await riders.list()).filter((r) => r.online && r.lat != null);
    if (!online.length) return null;
    online.sort((a, b) => _distKm(o.location, a) - _distKm(o.location, b));
    await orders.update(orderId, { riderId: online[0].id, status: 'assigned' });
    return online[0];
  },
  async assignQueuedForToday() {
    const now = new Date();
    if (businessHour(now) < 12) return [];
    const today = businessDate(now);
    const { data, error } = await sb.from('orders').select('*')
      .eq('status', 'queued').is('rider_id', null).not('location', 'is', null)
      .or(`delivery_date.is.null,delivery_date.lte.${today}`);
    if (error) throw error;
    const eligible = rowsOut(data).sort((a, b) => {
      if (!!b.priority - !!a.priority !== 0) return !!b.priority - !!a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    // Fetch the rider list ONCE for the whole sweep, and pass each order through
    // rather than making the callee read it back.
    const online = (await riders.list()).filter((r) => r.online && r.lat != null);
    if (!online.length) return [];
    const assigned = [];
    for (const o of eligible) {
      const r = await orders.assignToNearestOnlineRider(o.id, o, online);
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
const MIN_CADENCE_DAYS = 1;
const MAX_CADENCE_DAYS = 90;
const MAX_SCHEDULE_AHEAD_DAYS = 365;
const MAX_ACTIVE_RECURRING = 10;
const recurring = {
  async listForUser(userId) {
    const { data, error } = await sb.from('recurring_orders').select('*').eq('user_id', userId).order('next_run_at');
    if (error) throw error;
    return rowsOut(data);
  },
  // Audit B-10: next_run_at went in unvalidated, so a past date made the row
  // due on the very next sweep — and with no cap on rows per user, a few
  // hundred back-dated rows became a few hundred real cash orders in one
  // runDailyJobs pass. Cadence and horizon are now bounded, and a user can
  // only hold so many active schedules.
  async create({ userId, items, cadenceDays, nextRunAt, deliveryInfo }) {
    // Reject a non-numeric cadence rather than clamping it: `parseInt('abc') || 0`
    // then clamped upward would have quietly become 1 — a daily order.
    const rawCadence = parseInt(cadenceDays, 10);
    if (!Number.isFinite(rawCadence)) throw new Error('cadenceDays must be a number of days.');
    const cadence = Math.min(Math.max(rawCadence, MIN_CADENCE_DAYS), MAX_CADENCE_DAYS);
    const run = String(nextRunAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(run)) throw new Error('nextRunAt must be a YYYY-MM-DD date.');
    // Never in the past (that is the immediate-fire bug) and never further out
    // than a year, which is well past any real reorder.
    const today = businessDate();
    if (run < today) throw new Error('nextRunAt cannot be in the past.');
    if (run > businessDatePlus(MAX_SCHEDULE_AHEAD_DAYS)) throw new Error('nextRunAt is too far ahead.');
    const { count } = await sb.from('recurring_orders')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('active', true);
    if (Number(count || 0) >= MAX_ACTIVE_RECURRING) throw new Error('You already have ' + MAX_ACTIVE_RECURRING + ' active auto-reorders. Pause or delete one first.');
    const { data, error } = await sb.from('recurring_orders').insert({
      user_id: userId, items: Array.isArray(items) ? items.slice(0, 100) : items, cadence_days: cadence,
      next_run_at: run, delivery_info: deliveryInfo || null,
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
  // Claim a once-per-period marker. Returns true for exactly ONE caller, even
  // when several arrive at the same moment: the update only matches rows whose
  // value differs, so the database decides the winner rather than a read
  // followed by a write. This is what stops two concurrent /healthz hits both
  // running the recurring-order job and placing every due order twice (A-08).
  async claim(key, value) {
    // Ensure the row exists without disturbing an existing value.
    await sb.from('app_config').upsert({ key, value: '__unclaimed__' }, { onConflict: 'key', ignoreDuplicates: true });
    const { data, error } = await sb.from('app_config')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key).neq('value', value).select('key');
    if (error) throw error;
    return !!(data && data.length);
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
    const pw = ADMIN_BOOTSTRAP_PW || crypto.randomBytes(12).toString('base64url');
    admin = await users.create({
      name: 'SDGMart Admin', email: ADMIN_EMAIL, phone: null,
      password: pw, refCode: null, role: 'admin',
    });
    await sb.from('users').update({ email_verified: true, must_change_password: true }).eq('id', admin.id);
    console.log('🛠  Created admin account ' + ADMIN_EMAIL);
    if (ADMIN_BOOTSTRAP_PW) {
      console.log('    Password taken from ADMIN_BOOTSTRAP_PASSWORD. It must be changed at first sign-in.');
    } else {
      console.log('    One-time password (shown here only, never logged again): ' + pw);
      console.log('    Sign in with it and change it immediately — admin routes stay locked until you do.');
    }
  } else if (admin.passwordHash && !admin.mustChangePassword && await verifyPassword(LEGACY_ADMIN_PW, admin.passwordHash)) {
    await sb.from('users').update({ must_change_password: true }).eq('id', admin.id);
    console.warn('⚠️  Admin is still on the old repo default password — admin routes are locked until it is changed.');
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
    const insert = { user_id: userId, label, neighborhood, address, location: location || null, is_default: !!isDefault };
    let { data, error } = await sb.from('addresses').insert(insert).select().single();
    // With the partial unique index in place (audit B-13) a concurrent save
    // that also cleared and claimed the default loses here instead of leaving
    // two defaults behind. Re-clear and retry once; the row still gets saved.
    if (error && isDefault && /unique|duplicate/i.test(error.message || '')) {
      await sb.from('addresses').update({ is_default: false }).eq('user_id', userId);
      ({ data, error } = await sb.from('addresses').insert(insert).select().single());
    }
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
    let { data, error } = await sb.from('addresses').update(rowIn(safe)).eq('id', id).eq('user_id', userId).select().single();
    if (error && safe.isDefault && /unique|duplicate/i.test(error.message || '')) {
      await sb.from('addresses').update({ is_default: false }).eq('user_id', userId);
      ({ data, error } = await sb.from('addresses').update(rowIn(safe)).eq('id', id).eq('user_id', userId).select().single());
    }
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
      return;
    }
    // Previously this INSERTED a new "Recent" address for every delivery pin
    // more than ~50m from a saved one — silently accumulating a dated map of
    // everywhere a customer has had groceries delivered, which they never asked
    // to save and the privacy notice describes as an address they *choose*
    // (H-02). Nothing is created automatically now. The customer saves an
    // address deliberately, from the Account page or at checkout.
    //
    // A small bound is still kept on any legacy "Recent" rows so existing
    // accounts stop carrying an unbounded history.
    const { data: recents } = await sb.from('addresses').select('id, created_at')
      .eq('user_id', userId).eq('label', 'Recent').order('created_at', { ascending: false });
    if (recents && recents.length > 3) {
      const stale = recents.slice(3).map((r) => r.id);
      await sb.from('addresses').delete().in('id', stale);
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
  // reviews_one_per_order (audit B-13) now makes a second review of the same
  // order a unique violation rather than a silent duplicate. Turn that into
  // something the customer can read instead of a 500.
  async createForOrder({ userId, orderId, rating, message }) {
    const { data, error } = await sb.from('reviews').insert({
      user_id: userId, product_id: null, order_id: orderId,
      rating: Math.max(1, Math.min(5, parseInt(rating))),
      message: (message || '').slice(0, 800),
    }).select().single();
    if (error) {
      if (/unique|duplicate/i.test(error.message || '')) {
        const e = new Error('You have already rated this order.');
        e.status = 409;
        throw e;
      }
      throw error;
    }
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

    // Per-day buckets (oldest → newest), bucketed by the business day so the
    // dashboard's "today" matches the shop's, not the server's (audit B-11).
    const dayKey = (d) => businessDate(new Date(d));
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
    } catch (e) {
      // This is money owed to a real person. It used to warn and vanish
      // (audit E-10); now it is recorded where someone will see it.
      console.error('REFERRAL CREDIT FAILED for referee ' + refereeUser.id + ' → referrer ' + refereeUser.referredBy + ':', e.message);
      try {
        await errorLog.record({
          message: 'REFERRAL CREDIT FAILED: referee ' + refereeUser.id + ' -> referrer ' + refereeUser.referredBy + ' (GHS 5 not paid): ' + e.message,
          path: 'referrals.creditFirstPurchase', method: 'JOB', status: 500, userId: refereeUser.id,
        });
      } catch (_) {}
    }
  },
};

// ── Retention (audit B-12) ───────────────────────────────────────────────
// Sessions were deleted only when an expired one happened to be read, and
// email_tokens, pending_payments, search_queries and error_logs had no
// retention at all — so on a 500MB tier the junk tables were the ones growing
// fastest. This runs once a day from runDailyJobs.
//
// Windows are set by what the data is actually for, not by a uniform number:
// a session past its expiry is dead weight the same day, while error logs are
// the only forensic trail there is and are worth three months.
//
// pending_payments is deliberately NOT swept aggressively here. The abandoned-
// reservation job already releases held loyalty at 24h after checking Paystack;
// this only removes rows so old that no recovery is plausible, and it leaves
// anything still carrying a reservation alone so the money path stays the one
// place that decides.
const RETENTION = {
  sessions: { days: 0 },        // expired is expired
  emailTokens: { days: 0 },
  pendingPayments: { days: 30 },
  searchQueries: { days: 90 },
  errorLogs: { days: 90 },
};

const retention = {
  async sweep() {
    const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const now = new Date().toISOString();
    const out = {};
    const run = async (name, fn) => {
      try { out[name] = await fn(); }
      catch (e) { out[name] = 'failed: ' + e.message; console.warn('retention sweep (' + name + ') failed:', e.message); }
    };

    await run('sessions', async () => {
      const { data } = await sb.from('sessions').delete().lt('expires_at', now).select('token');
      return (data || []).length;
    });
    await run('emailTokens', async () => {
      const { data } = await sb.from('email_tokens').delete().lt('expires_at', now).select('token');
      return (data || []).length;
    });
    await run('pendingPayments', async () => {
      // Only rows with nothing reserved against them — anything still holding
      // a customer's loyalty is the money path's to release, not ours.
      const { data: old } = await sb.from('pending_payments').select('reference, draft')
        .lt('created_at', ago(RETENTION.pendingPayments.days)).limit(500);
      const safe = (old || []).filter((r) => !(r.draft && r.draft._reserved)).map((r) => r.reference);
      if (!safe.length) return 0;
      await sb.from('pending_payments').delete().in('reference', safe);
      return safe.length;
    });
    await run('searchQueries', async () => {
      const { data } = await sb.from('search_queries').delete()
        .lt('created_at', ago(RETENTION.searchQueries.days)).select('id');
      return (data || []).length;
    });
    await run('errorLogs', async () => {
      const { data } = await sb.from('error_logs').delete()
        .lt('created_at', ago(RETENTION.errorLogs.days)).select('id');
      return (data || []).length;
    });

    const summary = Object.entries(out).map(([k, v]) => k + '=' + v).join(' ');
    console.log('retention sweep: ' + summary);
    return out;
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
    } catch (e) {
      // Logging must never throw, but failing invisibly meant the error log
      // could be dead for weeks with nothing to show it (audit E-10). The
      // console is the one sink that cannot itself be down.
      console.error('ERROR LOG WRITE FAILED — the error below was never recorded:', e.message);
      console.error('   ', String(message || '').slice(0, 300));
    }
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
// Audit A-19: the MIME used to come straight from the client's data URL and
// set both the stored contentType and the file extension, so
// `data:text/html;base64,...` was stored as .html and served as HTML from a
// public bucket. The declared type is now ignored entirely — the format is
// read from the bytes, and anything that is not a real JPEG/PNG/WebP is
// rejected before it reaches storage.
const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg',  match: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  ext: 'png',  match: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', ext: 'webp', match: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  for (const sig of IMAGE_SIGNATURES) {
    try { if (sig.match(buffer)) return sig; } catch (_) {}
  }
  return null;
}

async function uploadProductPhoto(buffer) {
  const sig = sniffImageType(buffer);
  if (!sig) throw new Error('Only JPEG, PNG and WebP images can be uploaded.');
  await ensurePhotoBucket();
  const path = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${sig.ext}`;
  const { error } = await sb.storage.from('product-photos').upload(path, buffer, {
    contentType: sig.mime, cacheControl: '31536000',
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

// ── Data-subject requests (audit H-01) ───────────────────────────────────
// The privacy notice promises "You can ask us to delete your account and
// associated personal data at any time" and names Ghana's Act 843. No deletion
// path existed, and a plain user delete would not have honoured the promise:
// orders keep DENORMALISED copies of the customer's name, phone and address,
// with user_id set to null on delete — so the person's details would have
// remained in the orders table indefinitely.
//
// Orders themselves are kept: they are accounting records, and a rider's
// completed deliveries must still reconcile. What is removed is the ability to
// identify a person from them.
const dataRequests = {
  async exportForUser(userId) {
    const [user, addresses, orders_, reviews_, recurring_, referralsOut] = await Promise.all([
      users.get(userId),
      sb.from('addresses').select('*').eq('user_id', userId).then((r) => r.data || []),
      sb.from('orders').select('*').eq('user_id', userId).then((r) => r.data || []),
      sb.from('reviews').select('*').eq('user_id', userId).then((r) => r.data || []),
      sb.from('recurring_orders').select('*').eq('user_id', userId).then((r) => r.data || []),
      sb.from('referrals').select('*').eq('referrer_id', userId).then((r) => r.data || []),
    ]);
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;   // never export the hash
    return {
      exportedAt: new Date().toISOString(),
      account: safeUser,
      addresses, orders: orders_, reviews: reviews_,
      recurringOrders: recurring_, referralsMade: referralsOut,
    };
  },

  async eraseUser(userId) {
    const tombstone = '[deleted]';
    // 1. Scrub the personal details denormalised onto past orders. This is the
    //    part a plain DELETE would have missed entirely.
    await sb.from('orders').update({
      customer_name: tombstone, customer_phone: null,
      recipient_name: null, recipient_phone: null,
      address: tombstone, momo_number: null, location: null,
    }).eq('user_id', userId);

    // 2. Anything else carrying contact details independently of the account.
    await sb.from('product_requests').update({
      name: tombstone, whatsapp_number: null, call_number: null,
    }).eq('user_id', userId);

    // 3. Detach from the referral graph so no one else's row points at them.
    await sb.from('users').update({ referred_by: null }).eq('referred_by', userId);
    await sb.from('referrals').delete().or('referrer_id.eq.' + userId + ',referee_id.eq.' + userId);

    // 4. Session and cart state.
    try { await sessions.destroyAllForUser(userId); } catch (_) {}
    try { await sb.from('carts').delete().eq('user_id', userId); } catch (_) {}

    // 5. The account itself. addresses, reviews, recurring_orders and
    //    push_subscriptions are ON DELETE CASCADE and go with it; orders keep
    //    ON DELETE SET NULL, which is why step 1 had to run first.
    const { error } = await sb.from('users').delete().eq('id', userId);
    if (error) throw error;
    return { ok: true };
  },
};

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
  metrics, leaderboard, referrals, errorLog, pendingPayments, checkSchema, dataRequests,
  pushSubs, searchLog, recurring, appConfig, carts,
  rowOut, rowsOut,
  hashPassword, verifyPassword, burnPasswordTiming, validatePasswordStrength,
  rateCheck, rateClear, retention,
  businessDate, businessHour, businessDatePlus, BUSINESS_TZ,
  makeEmailToken, consumeEmailToken,
  createRider, attachOrderLocation,
  uploadProductPhoto, sniffImageType, cancelOrder,
  getVapidKeys, bootstrap,
  ADMIN_EMAIL,
};
