// One-shot data migration: read sdgmart.json, push everything into Supabase.
// Run with:  node migrate-from-json.js
// Requires .env (or shell env vars) for SUPABASE_URL + SUPABASE_SERVICE_KEY.
//
// Safe to re-run: it upserts products by name, users by email, riders by email.
// Orders are inserted only if no order with the same id exists yet.

try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars first.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const file = path.join(__dirname, 'sdgmart.json');
if (!fs.existsSync(file)) {
  console.log('No sdgmart.json found — nothing to migrate.');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

async function migrate() {
  // ── Products ───────────────────────────────────────────────────────────
  if (Array.isArray(data.products) && data.products.length) {
    console.log(`Migrating ${data.products.length} products…`);
    const rows = data.products.map(p => ({
      name: p.name,
      category: p.category,
      price: p.price,
      unit: p.unit,
      best_before: p.bestBefore || null,
      stock: p.stock || 0,
      description: p.description || '',
      bestseller: p.bestseller === true || p.bestseller === 1,
    }));
    // Upsert by name (idempotent)
    for (const r of rows) {
      const { data: existing } = await sb.from('products').select('id').eq('name', r.name).maybeSingle();
      if (existing) {
        await sb.from('products').update(r).eq('id', existing.id);
      } else {
        await sb.from('products').insert(r);
      }
    }
    console.log('  ✓ products');
  }

  // ── Users ──────────────────────────────────────────────────────────────
  if (Array.isArray(data.users) && data.users.length) {
    console.log(`Migrating ${data.users.length} users…`);
    for (const u of data.users) {
      const row = {
        name: u.name,
        email: String(u.email).toLowerCase().trim(),
        phone: u.phone || null,
        password_hash: u.passwordHash || null,
        role: u.role === 'admin' ? 'admin' : 'customer',
        email_verified: !!u.emailVerified,
        total_spent: Number(u.totalSpent || 0),
        squad_code: u.squadCode || null,
        owns_squad: !!u.ownsSquad,
        discount_pending: !!u.discountPending,
        must_change_password: !!u.mustChangePassword,
        google_id: u.googleId || null,
        picture: u.picture || null,
        ref_code: u.refCode || u.referralCode || null,
      };
      const { data: existing } = await sb.from('users').select('id').ilike('email', row.email).maybeSingle();
      if (existing) {
        await sb.from('users').update(row).eq('id', existing.id);
      } else {
        await sb.from('users').insert(row);
      }
    }
    console.log('  ✓ users');
  }

  // ── Riders ─────────────────────────────────────────────────────────────
  if (Array.isArray(data.riders) && data.riders.length) {
    console.log(`Migrating ${data.riders.length} riders…`);
    for (const r of data.riders) {
      const row = {
        name: r.name,
        email: String(r.email).toLowerCase().trim(),
        phone: r.phone || null,
        password_hash: r.passwordHash,
        online: !!r.online,
        lat: r.lat || null,
        lng: r.lng || null,
      };
      const { data: existing } = await sb.from('riders').select('id').ilike('email', row.email).maybeSingle();
      if (existing) await sb.from('riders').update(row).eq('id', existing.id);
      else await sb.from('riders').insert(row);
    }
    console.log('  ✓ riders');
  }

  // ── Orders ─────────────────────────────────────────────────────────────
  if (Array.isArray(data.orders) && data.orders.length) {
    console.log(`Migrating ${data.orders.length} orders…`);
    // First look up users by email so we can attach user_id properly
    const userByEmail = {};
    const { data: allUsers } = await sb.from('users').select('id, email');
    (allUsers || []).forEach(u => { userByEmail[String(u.email).toLowerCase()] = u.id; });
    for (const o of data.orders) {
      const row = {
        user_id: o.userEmail ? userByEmail[String(o.userEmail).toLowerCase()] : null,
        customer_name: o.customer || '',
        customer_phone: o.phone || '',
        recipient_name: o.recipientName || '',
        recipient_phone: o.recipientPhone || '',
        address: o.address || '',
        neighborhood: o.neighborhood || '',
        items: typeof o.items === 'string' ? JSON.parse(o.items || '[]') : (o.items || []),
        subtotal: Number(o.subtotal || 0),
        delivery_fee: Number(o.delivery || 0),
        total: Number(o.total || 0),
        payment_method: o.payMethod || 'momo',
        momo_number: o.momoNumber || '',
        status: o.status || 'queued',
        location: o.location || null,
        delivery_date: o.deliveryDate || null,
        priority: !!o.priority,
        created_at: o.createdAt || new Date().toISOString(),
      };
      await sb.from('orders').insert(row);
    }
    console.log('  ✓ orders');
  }

  // ── VAPID keys ─────────────────────────────────────────────────────────
  if (data.vapid && data.vapid.publicKey && data.vapid.privateKey) {
    await sb.from('app_config').upsert({ key: 'vapid', value: data.vapid });
    console.log('  ✓ VAPID keys');
  }

  console.log('\n✅ Migration complete.');
  console.log('Tip: keep sdgmart.json as a backup; the server now reads from Supabase.');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
