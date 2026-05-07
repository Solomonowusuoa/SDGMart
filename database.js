// Lightweight synchronous JSON database — same API surface as better-sqlite3.
// Data is stored in sdgmart.json next to this file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'sdgmart.json');

// Admin bootstrap — created on first start if it doesn't already exist.
const ADMIN_EMAIL = 'solomonowusuoa@gmail.com';
const ADMIN_DEFAULT_PW = 'sdgadmin2026';

// ── Password strength rules ───────────────────────────────────────────────
// Minimum 8 characters, at least one letter and one number. Rejects the
// default admin password explicitly so admins MUST rotate it.
function validatePasswordStrength(password, { isAdminChange = false } = {}) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain a letter.';
  if (!/\d/.test(pw)) return 'Password must contain a number.';
  if (isAdminChange && pw === ADMIN_DEFAULT_PW) return 'Pick a password different from the default.';
  return null; // valid
}

// ── Seed data ──────────────────────────────────────────────────────────────
const SEED_PRODUCTS = [
  // Cereals
  { name:'Quaker Oats',          category:'Cereals',       price:32.50, unit:'1kg',   bestBefore:'2026-12-01', stock:48,  description:'Wholesome rolled oats, great for breakfast porridge.', bestseller:true  },
  { name:'Milo Cereal',          category:'Cereals',       price:28.00, unit:'500g',  bestBefore:'2026-10-15', stock:30,  description:'Malted chocolate cereal loved by kids and adults.',    bestseller:false },
  { name:'Tom Brown',            category:'Cereals',       price:18.50, unit:'1kg',   bestBefore:'2026-11-20', stock:60,  description:'Traditional Ghanaian roasted grain porridge mix.',     bestseller:true  },
  { name:'Weatabix',             category:'Cereals',       price:22.00, unit:'430g',  bestBefore:'2026-09-30', stock:25,  description:'Whole wheat biscuits — filling and nutritious.',        bestseller:false },
  // Dairy
  { name:'Peak Milk (Tin)',      category:'Dairy',         price:38.00, unit:'400g',  bestBefore:'2027-03-01', stock:55,  description:'Full cream evaporated milk, rich and creamy.',         bestseller:true  },
  { name:'Cowbell Milk',         category:'Dairy',         price:15.00, unit:'400g',  bestBefore:'2026-12-10', stock:40,  description:'Fortified powdered milk for the whole family.',        bestseller:false },
  { name:'Yoghurt (Strawberry)', category:'Dairy',         price:12.00, unit:'200ml', bestBefore:'2026-05-20', stock:20,  description:'Fresh cultured yoghurt, chilled and creamy.',          bestseller:false },
  { name:'Fan Ice Vanilla',      category:'Dairy',         price:5.00,  unit:'100ml', bestBefore:'2026-06-01', stock:80,  description:'Classic Ghanaian fan ice cup, vanilla flavour.',       bestseller:false },
  // Detergents
  { name:'Omo Washing Powder',   category:'Detergents',    price:45.00, unit:'2kg',   bestBefore:'2027-06-01', stock:35,  description:'Powerful stain-removing washing powder.',              bestseller:true  },
  { name:'Key Soap',             category:'Detergents',    price:8.50,  unit:'200g',  bestBefore:'2027-01-01', stock:100, description:'Traditional all-purpose bar soap for laundry.',        bestseller:false },
  { name:'Dettol Hand Wash',     category:'Detergents',    price:22.00, unit:'250ml', bestBefore:'2027-08-01', stock:42,  description:'Antibacterial liquid hand wash, original scent.',      bestseller:false },
  { name:'Ariel Liquid',         category:'Detergents',    price:55.00, unit:'1L',    bestBefore:'2027-04-15', stock:18,  description:'Premium concentrated liquid laundry detergent.',       bestseller:false },
  // Rice & Grains
  { name:"Uncle Ben's Rice",     category:'Rice & Grains', price:65.00, unit:'5kg',   bestBefore:'2027-05-01', stock:40,  description:'Long grain parboiled white rice.',                     bestseller:true  },
  { name:'Ofada Rice',           category:'Rice & Grains', price:48.00, unit:'5kg',   bestBefore:'2027-04-01', stock:30,  description:'Local unpolished rice with a nutty flavour.',          bestseller:false },
  { name:'Millet (Ground)',      category:'Rice & Grains', price:20.00, unit:'1kg',   bestBefore:'2026-12-20', stock:50,  description:'Finely ground millet for TZ and porridge.',            bestseller:false },
  { name:'Semolina',             category:'Rice & Grains', price:18.00, unit:'1kg',   bestBefore:'2026-11-15', stock:35,  description:'Fine wheat semolina for light meals.',                 bestseller:false },
  // Cooking Oil
  { name:'Frytol Vegetable Oil', category:'Cooking Oil',   price:72.00, unit:'3L',    bestBefore:'2026-12-31', stock:25,  description:'Refined vegetable oil for frying and cooking.',        bestseller:true  },
  { name:'Gino Olive Oil',       category:'Cooking Oil',   price:85.00, unit:'750ml', bestBefore:'2027-02-01', stock:15,  description:'Pure olive oil blend for healthy cooking.',            bestseller:false },
  { name:'Groundnut Oil',        category:'Cooking Oil',   price:40.00, unit:'1L',    bestBefore:'2026-10-01', stock:30,  description:'Locally pressed groundnut (peanut) oil.',              bestseller:false },
  { name:'Palm Oil (Red)',       category:'Cooking Oil',   price:35.00, unit:'1L',    bestBefore:'2026-09-15', stock:45,  description:'Traditional West African red palm oil.',               bestseller:false },
  // Snacks
  { name:'Pringles Original',    category:'Snacks',        price:32.00, unit:'165g',  bestBefore:'2026-08-01', stock:22,  description:'Crispy stacked potato crisps, original flavour.',      bestseller:false },
  { name:'Crackers (Cabin)',     category:'Snacks',        price:12.00, unit:'200g',  bestBefore:'2026-09-01', stock:55,  description:'Classic cabin biscuits, lightly salted.',              bestseller:true  },
  { name:'Chin Chin',            category:'Snacks',        price:15.00, unit:'250g',  bestBefore:'2026-07-15', stock:40,  description:'Crunchy fried Ghanaian snack, lightly sweetened.',     bestseller:false },
  { name:'Plantain Chips',       category:'Snacks',        price:10.00, unit:'150g',  bestBefore:'2026-07-01', stock:60,  description:'Crispy ripe plantain chips, locally made.',            bestseller:false },
  // Canned Foods
  { name:'Sardines in Tomato',   category:'Canned Foods',  price:18.50, unit:'125g',  bestBefore:'2028-01-01', stock:70,  description:'Atlantic sardines in rich tomato sauce.',              bestseller:true  },
  { name:'Corned Beef (Exeter)', category:'Canned Foods',  price:42.00, unit:'340g',  bestBefore:'2028-06-01', stock:30,  description:'Premium corned beef, great for stews.',                bestseller:false },
  { name:'Baked Beans',          category:'Canned Foods',  price:25.00, unit:'400g',  bestBefore:'2027-10-01', stock:25,  description:'Haricot beans in sweet tomato sauce.',                 bestseller:false },
  { name:'Tomato Paste (Gino)',  category:'Canned Foods',  price:8.00,  unit:'70g',   bestBefore:'2027-05-01', stock:90,  description:'Concentrated tomato paste for soups and stews.',       bestseller:false },
  // Drinks
  { name:'Coca-Cola',            category:'Drinks',        price:8.00,  unit:'500ml', bestBefore:'2026-12-01', stock:100, description:'Refreshing original Coca-Cola.',                       bestseller:true  },
  { name:'Malta Guinness',       category:'Drinks',        price:10.00, unit:'330ml', bestBefore:'2026-11-01', stock:80,  description:'Non-alcoholic malt drink, rich and nutritious.',       bestseller:false },
  { name:'Voltic Water',         category:'Drinks',        price:4.50,  unit:'500ml', bestBefore:'2027-01-01', stock:150, description:'Pure natural spring water, Ghanaian origin.',          bestseller:false },
  { name:'Alvaro (Pineapple)',   category:'Drinks',        price:9.50,  unit:'330ml', bestBefore:'2026-10-20', stock:65,  description:'Sparkling pineapple-flavoured fruit drink.',           bestseller:false },
  // Desserts
  { name:'Digestive Biscuits',   category:'Desserts',      price:22.00, unit:'400g',  bestBefore:'2026-10-01', stock:30,  description:'Semi-sweet wholemeal biscuits, great with tea.',       bestseller:true  },
  { name:'Milo Powder',          category:'Desserts',      price:45.00, unit:'400g',  bestBefore:'2026-12-15', stock:40,  description:'Malted chocolate powder for hot or cold drinks.',      bestseller:false },
  { name:'Scotch Fingers',       category:'Desserts',      price:18.00, unit:'300g',  bestBefore:'2026-09-01', stock:28,  description:'Buttery shortbread finger biscuits.',                  bestseller:false },
  { name:'Cadbury Chocolate',    category:'Desserts',      price:28.00, unit:'100g',  bestBefore:'2026-08-15', stock:20,  description:'Smooth milk chocolate bar by Cadbury.',                bestseller:false },
];

// ── Storage ────────────────────────────────────────────────────────────────
let _store;

function load() {
  if (_store) return _store;
  if (fs.existsSync(DB_FILE)) {
    try {
      _store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return _store;
    } catch (_) {}
  }
  // First run — seed
  let id = 1;
  _store = {
    products: SEED_PRODUCTS.map(p => ({ ...p, id: id++, img: null })),
    orders: [],
    users: [],
    _nextProductId: id,
    _nextUserId: 1,
  };
  save();
  console.log('✅ Database seeded with 36 products');
  return _store;
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(_store, null, 2));
}

// ── Query builder — mirrors better-sqlite3's prepare().run/get/all ─────────
function prepare(sql) {
  const store = load();
  const s = sql.trim().toUpperCase();

  return {
    // Products — all rows
    all() {
      if (s.includes('FROM PRODUCTS')) return [...store.products];
      if (s.includes('FROM ORDERS'))  return [...store.orders];
      return [];
    },
    // Single row by id
    get(id) {
      if (s.includes('FROM PRODUCTS'))
        return store.products.find(p => String(p.id) === String(id)) || null;
      if (s.includes('FROM ORDERS'))
        return store.orders.find(o => String(o.id) === String(id)) || null;
      return null;
    },
    // Mutations
    run(...args) {
      if (s.startsWith('INSERT INTO PRODUCTS')) {
        const [name, category, price, unit, bestBefore, stock, description, bestseller] = args;
        const p = {
          id: store._nextProductId++,
          name, category,
          price: parseFloat(price) || 0,
          unit: unit || '',
          bestBefore: bestBefore || '',
          stock: parseInt(stock) || 0,
          description: description || '',
          bestseller: bestseller === 1 || bestseller === true,
          img: null,
        };
        store.products.push(p);
        save();
        return { lastInsertRowid: p.id };
      }
      if (s.startsWith('UPDATE PRODUCTS')) {
        // UPDATE products SET name=?, ... WHERE id=?
        const id = args[args.length - 1];
        const idx = store.products.findIndex(p => String(p.id) === String(id));
        if (idx !== -1) {
          if (args.length === 9) {
            const [name, category, price, unit, bestBefore, stock, description, bestseller] = args;
            store.products[idx] = {
              ...store.products[idx],
              name, category,
              price: parseFloat(price) || 0,
              unit: unit || '',
              bestBefore: bestBefore || '',
              stock: parseInt(stock) || 0,
              description: description || '',
              bestseller: bestseller === 1 || bestseller === true,
            };
          }
          save();
        }
        return { changes: idx !== -1 ? 1 : 0 };
      }
      if (s.startsWith('DELETE FROM PRODUCTS')) {
        const id = args[0];
        const before = store.products.length;
        store.products = store.products.filter(p => String(p.id) !== String(id));
        save();
        return { changes: before - store.products.length };
      }
      if (s.startsWith('INSERT INTO ORDERS')) {
        const [id, customer, phone, neighborhood, address, items, total, delivery,
               familyMode, recipientName, recipientPhone, recipientAddress,
               giftMessage, payMethod, mapsPin] = args;
        const order = {
          id, customer, phone: phone || '', neighborhood: neighborhood || '',
          address: address || '', items, total: parseFloat(total) || 0,
          delivery: parseFloat(delivery) || 0, status: 'Pending',
          familyMode: familyMode === 1 || familyMode === true,
          recipientName: recipientName || '', recipientPhone: recipientPhone || '',
          recipientAddress: recipientAddress || '', giftMessage: giftMessage || '',
          payMethod: payMethod || 'momo', mapsPin: mapsPin || '',
          createdAt: new Date().toISOString(),
        };
        store.orders.unshift(order);
        save();
        return { lastInsertRowid: id };
      }
      if (s.startsWith('UPDATE ORDERS')) {
        // UPDATE orders SET status = ? WHERE id = ?
        const [status, id] = args;
        const idx = store.orders.findIndex(o => String(o.id) === String(id));
        if (idx !== -1) { store.orders[idx].status = status; save(); }
        return { changes: idx !== -1 ? 1 : 0 };
      }
      return { changes: 0, lastInsertRowid: null };
    },
  };
}

// ── Crypto: scrypt password hashing + random session tokens ───────────────
// Format of stored hash: "<salt-hex>:<hash-hex>".  Cost is the default scrypt
// parameter which is fine for an interactive login (~100ms on commodity HW).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  let test;
  try { test = crypto.scryptSync(String(password || ''), salt, 64).toString('hex'); }
  catch (_) { return false; }
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Sessions (persisted to sdgmart.json; survive server restarts) ────────
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function _ensureSessionStore() {
  const s = load();
  if (!s.sessions || typeof s.sessions !== 'object') s.sessions = {};
}

function _pruneExpiredSessions() {
  const s = load();
  let dirty = false;
  const now = Date.now();
  for (const [tok, sess] of Object.entries(s.sessions || {})) {
    if (!sess || now - sess.createdAt > SESSION_TTL_MS) {
      delete s.sessions[tok];
      dirty = true;
    }
  }
  if (dirty) save();
}

const sessions = {
  create(userId) {
    _ensureSessionStore();
    const s = load();
    const token = genToken();
    s.sessions[token] = { userId, createdAt: Date.now() };
    save();
    return token;
  },
  get(token) {
    if (!token) return null;
    _ensureSessionStore();
    const s = load();
    const sess = s.sessions[token];
    if (!sess) return null;
    if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
      delete s.sessions[token];
      save();
      return null;
    }
    return sess;
  },
  destroy(token) {
    if (!token) return;
    _ensureSessionStore();
    const s = load();
    if (s.sessions[token]) { delete s.sessions[token]; save(); }
  },
  destroyAllForUser(userId) {
    _ensureSessionStore();
    const s = load();
    let dirty = false;
    for (const [tok, sess] of Object.entries(s.sessions)) {
      if (sess && String(sess.userId) === String(userId)) { delete s.sessions[tok]; dirty = true; }
    }
    if (dirty) save();
  },
};

// ── Rate limiting (per-key sliding window, in-memory) ─────────────────────
// Used by /api/auth/login. State is in-memory (lost on restart, which is OK
// — restart drops blocks too, but the window is short anyway).
const _rateState = new Map(); // key -> { hits: [timestamps], blockedUntil: number }

function rateCheck(key, { windowMs, max, blockMs }) {
  const now = Date.now();
  let st = _rateState.get(key);
  if (!st) { st = { hits: [], blockedUntil: 0 }; _rateState.set(key, st); }
  if (st.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((st.blockedUntil - now) / 1000) };
  }
  st.hits = st.hits.filter(t => now - t < windowMs);
  st.hits.push(now);
  if (st.hits.length > max) {
    st.blockedUntil = now + blockMs;
    st.hits = [];
    return { allowed: false, retryAfter: Math.ceil(blockMs / 1000) };
  }
  return { allowed: true, remaining: max - st.hits.length };
}
function rateClear(key) { _rateState.delete(key); }

// ── Email verification tokens ─────────────────────────────────────────────
const _emailTokens = new Map(); // token -> { userId, expiresAt }
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function makeEmailToken(userId) {
  // Prune expired tokens lazily
  const now = Date.now();
  for (const [t, v] of _emailTokens.entries()) if (v.expiresAt < now) _emailTokens.delete(t);
  const token = genToken();
  _emailTokens.set(token, { userId, expiresAt: now + EMAIL_TOKEN_TTL_MS });
  return token;
}
function consumeEmailToken(token) {
  const v = _emailTokens.get(token);
  if (!v) return null;
  _emailTokens.delete(token);
  if (v.expiresAt < Date.now()) return null;
  return v.userId;
}

// ── Users + Squads helpers ────────────────────────────────────────────────
function _ensureUserFields() {
  const s = load();
  if (!Array.isArray(s.users)) s.users = [];
  if (!s._nextUserId) s._nextUserId = 1;
}
function _genCode(name) {
  const base = (name || 'USER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'USER';
  return base + Math.random().toString(36).slice(2, 6).toUpperCase();
}

const users = {
  all() { _ensureUserFields(); return [...load().users]; },
  findByEmail(email) {
    _ensureUserFields();
    if (!email) return null;
    const e = email.trim().toLowerCase();
    return load().users.find(u => (u.email || '').toLowerCase() === e) || null;
  },
  findByCode(code) {
    _ensureUserFields();
    if (!code) return null;
    return load().users.find(u => u.referralCode === code.toUpperCase()) || null;
  },
  get(id) {
    _ensureUserFields();
    return load().users.find(u => String(u.id) === String(id)) || null;
  },
  create({ name, email, phone, password, refCode, role }) {
    _ensureUserFields();
    const s = load();
    if (users.findByEmail(email)) throw new Error('Email already registered');
    if (!password || String(password).length < 4) throw new Error('Password must be at least 4 characters');
    const referralCode = _genCode(name);
    let squadCode = referralCode; // default: own squad
    if (refCode) {
      const referrer = users.findByCode(refCode);
      if (referrer) squadCode = referrer.squadCode || referrer.referralCode;
    }
    const u = {
      id: s._nextUserId++,
      name: name || 'Customer',
      email: (email || '').trim().toLowerCase(),
      phone: phone || '',
      passwordHash: hashPassword(password),
      referralCode,
      squadCode,
      totalSpent: 0,
      discountPending: false,
      role: role || 'customer',
      emailVerified: false,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
    };
    s.users.push(u);
    save();
    return u;
  },
  verifyCredentials(email, password) {
    const u = users.findByEmail(email);
    if (!u) return null;
    if (!verifyPassword(password, u.passwordHash)) return null;
    return u;
  },
  changePassword(id, newPassword) {
    return users.update(id, {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
    });
  },
  markEmailVerified(id) {
    return users.update(id, { emailVerified: true });
  },
  // Find or create a user from a Google sign-in. Google has already verified
  // the email, so emailVerified=true. No password needed (passwordHash stays
  // empty — verifyCredentials will refuse plain-password logins for them).
  findOrCreateGoogle({ email, name, googleId, picture, refCode }) {
    _ensureUserFields();
    const s = load();
    let u = users.findByEmail(email);
    if (u) {
      // Backfill googleId on first Google sign-in for existing accounts.
      const patch = { emailVerified: true };
      if (!u.googleId) patch.googleId = googleId;
      if (picture && !u.picture) patch.picture = picture;
      return users.update(u.id, patch);
    }
    const referralCode = _genCode(name);
    let squadCode = referralCode;
    if (refCode) {
      const referrer = users.findByCode(refCode);
      if (referrer) squadCode = referrer.squadCode || referrer.referralCode;
    }
    u = {
      id: s._nextUserId++,
      name: name || 'Google User',
      email: (email || '').trim().toLowerCase(),
      phone: '',
      passwordHash: '',           // password-less account — must use Google to sign in
      googleId: googleId || null,
      picture: picture || null,
      referralCode,
      squadCode,
      totalSpent: 0,
      discountPending: false,
      role: 'customer',
      emailVerified: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
    };
    s.users.push(u);
    save();
    return u;
  },
  update(id, patch) {
    _ensureUserFields();
    const s = load();
    const idx = s.users.findIndex(u => String(u.id) === String(id));
    if (idx === -1) return null;
    s.users[idx] = { ...s.users[idx], ...patch };
    save();
    return s.users[idx];
  },
};

const squads = {
  // All members in a given squad (by squadCode)
  members(squadCode) {
    if (!squadCode) return [];
    return load().users.filter(u => u.squadCode === squadCode);
  },
  // Apply spend, then check goal: if every member's totalSpent >= 500 → mark
  // discountPending=true on all and reset their totals to 0.
  recordSpend(userId, amount) {
    const s = load();
    const idx = s.users.findIndex(u => String(u.id) === String(userId));
    if (idx === -1) return null;
    s.users[idx].totalSpent = (s.users[idx].totalSpent || 0) + Number(amount || 0);
    save();

    const code = s.users[idx].squadCode;
    const members = s.users.filter(u => u.squadCode === code);
    const GOAL = 500;
    const allMet = members.length > 0 && members.every(m => (m.totalSpent || 0) >= GOAL);
    if (allMet) {
      members.forEach(m => {
        const i = s.users.findIndex(u => u.id === m.id);
        if (i !== -1) {
          s.users[i].discountPending = true;
          s.users[i].totalSpent = 0;
        }
      });
      save();
      return { user: s.users[idx], discountUnlocked: true };
    }
    return { user: s.users[idx], discountUnlocked: false };
  },
  // Consume discount on checkout
  consumeDiscount(userId) {
    const s = load();
    const idx = s.users.findIndex(u => String(u.id) === String(userId));
    if (idx === -1) return false;
    if (!s.users[idx].discountPending) return false;
    s.users[idx].discountPending = false;
    save();
    return true;
  },
};

// ── Bootstrap: migrate plaintext passwords + ensure admin exists ─────────
function bootstrap() {
  _ensureUserFields();
  const s = load();
  let dirty = false;

  // Migrate legacy plaintext `password` → hashed `passwordHash`, ensure new
  // fields exist on existing users.
  s.users.forEach(u => {
    if (u.password && !u.passwordHash) {
      u.passwordHash = hashPassword(u.password);
      delete u.password;
      dirty = true;
    }
    if (!u.role) { u.role = 'customer'; dirty = true; }
    if (u.emailVerified === undefined) {
      // Pre-existing accounts are grandfathered in as verified.
      u.emailVerified = true;
      dirty = true;
    }
    if (u.mustChangePassword === undefined) { u.mustChangePassword = false; dirty = true; }
  });

  // Ensure the admin account exists. Force a password change on first login.
  let admin = users.findByEmail(ADMIN_EMAIL);
  if (!admin) {
    const referralCode = 'ADMIN' + Math.random().toString(36).slice(2, 6).toUpperCase();
    admin = {
      id: s._nextUserId++,
      name: 'Administrator',
      email: ADMIN_EMAIL,
      phone: '',
      passwordHash: hashPassword(ADMIN_DEFAULT_PW),
      referralCode,
      squadCode: referralCode,
      totalSpent: 0,
      discountPending: false,
      role: 'admin',
      emailVerified: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };
    s.users.push(admin);
    dirty = true;
    console.log(`✅ Admin user created: ${ADMIN_EMAIL} (default pw: ${ADMIN_DEFAULT_PW} — change required on first login)`);
  } else {
    if (admin.role !== 'admin') { admin.role = 'admin'; dirty = true; }
    // If the admin still has the default password, force a change.
    if (verifyPassword(ADMIN_DEFAULT_PW, admin.passwordHash) && !admin.mustChangePassword) {
      admin.mustChangePassword = true;
      dirty = true;
    }
  }

  // Prune any expired sessions left over from previous boots.
  _pruneExpiredSessions();

  if (dirty) save();
}

// Initialise on first require
load();
bootstrap();

module.exports = {
  prepare, users, squads, sessions,
  hashPassword, verifyPassword, validatePasswordStrength,
  rateCheck, rateClear,
  makeEmailToken, consumeEmailToken,
  ADMIN_EMAIL, ADMIN_DEFAULT_PW,
};
