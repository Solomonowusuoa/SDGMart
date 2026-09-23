// Exercise the real database adapter without connecting to Supabase.
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load;
const rows = { orders: [], product_requests: [] };
const reads = [];
Module._load = function (name) {
  if (name !== '@supabase/supabase-js') return originalLoad.apply(this, arguments);
  return { createClient: () => ({ from(table) {
    let inserted = null, columns = '*';
    const filters = [];
    const q = {
      insert(row) { inserted = { id: 1, ...row }; rows[table].push(inserted); return q; },
      select(cols = '*') { columns = cols; return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      in() { return q; }, order() { return q; },
      single: async () => ({ data: inserted, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then(resolve) {
        reads.push({ table, columns, filters });
        const data = (rows[table] || []).map(row => Object.fromEntries(Object.entries(row).filter(([k]) => columns === '*' || columns.split(',').map(s => s.trim()).includes(k))));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  } }) };
};
process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = 'stub-key';
const db = require('../database');
Module._load = originalLoad;

(async () => {
  const list = Array.from({ length: 30 }, (_, i) => `Brand ${i}: 2 packets, 500g`).join('\n');
  const saved = await db.productRequests.create({ name: 'Preview', productName: list });
  assert.equal(rows.product_requests[0].product_name, list);
  assert.equal(saved.productName, list);
  const notes = 'Choose ripe fruit.\nCall at the gate.';
  const order = await db.orders.create({ customerName: 'Preview', orderNotes: notes });
  assert.equal(rows.orders[0].order_notes, notes);
  assert.equal(order.orderNotes, notes);
  const assigned = await db.orders.forRider(7);
  assert.equal(assigned[0].orderNotes, notes);
  assert.deepEqual(reads.find(r => r.table === 'orders').filters, [['rider_id', 7]]);
  console.log('PASS: long item lists and multiline instructions survive database mapping and assigned-rider projection');
})().catch(e => { console.error(e); process.exitCode = 1; });
