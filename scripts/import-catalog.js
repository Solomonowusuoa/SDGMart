#!/usr/bin/env node
// One-off catalog importer — wipes placeholder products and loads the real
// catalog from the triaged sheet (exported as CSV from SDGMart-catalog-triage.xlsx).
//
// Usage:
//   node scripts/import-catalog.js <catalog.csv> [--wipe] [--dry-run] [--stock 100] [--images-dir <dir>]
//
//   --wipe        delete ALL existing products first (required for the full replace)
//   --dry-run     parse + report what would happen; touches nothing
//   --stock N     initial stock for every product (default 100; stock 0 shows "Sold out")
//   --images-dir  folder of image files named <row#>.jpg/png or a slug of the
//                 product name; used when the Image URL column is blank
//
// Expected CSV columns (header row, order-insensitive):
//   Category, Product Name, Price (GHS), Unit, Keep? (Y/N), Bestseller? (Y/N), Image URL, Your Notes
// Only rows with Keep = Y are imported.
//
// Images: an http(s) Image URL is downloaded; a non-URL value is treated as a
// local file path. If the optional `sharp` package is installed
// (npm i --no-save sharp) images are resized to 900px JPEG q80 before upload,
// matching the admin panel's client-side compression; otherwise uploaded as-is.
//
// ⚠️ AFTER a full replace (see HANDOFF.md):
//   1. Update the `categories` array in server.js to the new category set.
//   2. Re-point the `essentials` product ids in server.js (ids change on reinsert).
//   3. Bump sw.js CACHE_NAME and deploy.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../database.js');

let sharp = null;
try { sharp = require('sharp'); } catch (_) {}

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
if (!csvPath) {
  console.error('Usage: node scripts/import-catalog.js <catalog.csv> [--wipe] [--dry-run] [--stock 100] [--images-dir <dir>]');
  process.exit(1);
}
const WIPE = flag('wipe');
const DRY = flag('dry-run');
const STOCK = parseInt(opt('stock', '100'), 10);
const IMAGES_DIR = opt('images-dir', null);

// ── tiny RFC-4180 CSV parser (quoted fields, embedded commas/newlines) ────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function findLocalImage(name, rowNum) {
  if (!IMAGES_DIR) return null;
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const bases = [String(rowNum), slug(name)];
  for (const b of bases) for (const e of exts) {
    const p = path.join(IMAGES_DIR, b + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function getImageBuffer(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { 'User-Agent': 'SDGMart-importer/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return { buf: Buffer.from(await res.arrayBuffer()), mime };
  }
  const ext = path.extname(src).toLowerCase();
  return { buf: fs.readFileSync(src), mime: MIME[ext] || 'image/jpeg' };
}

async function compress(buf) {
  if (!sharp) return null;
  return sharp(buf).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (frag) => header.findIndex((h) => h.includes(frag));
  const iCat = col('category'), iName = col('product name'), iPrice = col('price'),
        iUnit = col('unit'), iKeep = col('keep'), iBest = col('bestseller'),
        iImg = col('image'), iNotes = col('notes');
  if (iCat < 0 || iName < 0 || iPrice < 0 || iKeep < 0) {
    console.error(`Missing required columns. Found header: ${header.join(' | ')}`);
    process.exit(1);
  }

  const kept = [], skipped = [], bad = [];
  rows.forEach((r, idx) => {
    const keep = String(r[iKeep] || '').trim().toUpperCase();
    const name = String(r[iName] || '').trim();
    if (keep !== 'Y') { skipped.push(name); return; }
    const price = parseFloat(String(r[iPrice]).replace(/[^\d.]/g, ''));
    if (!name || !Number.isFinite(price) || price <= 0) { bad.push(`row ${idx + 2}: "${name}" price="${r[iPrice]}"`); return; }
    kept.push({
      rowNum: idx + 2,
      name,
      category: String(r[iCat] || '').trim(),
      price,
      unit: iUnit >= 0 ? String(r[iUnit] || '').trim() : '',
      bestseller: iBest >= 0 && String(r[iBest] || '').trim().toUpperCase() === 'Y',
      imageSrc: iImg >= 0 ? String(r[iImg] || '').trim() : '',
      notes: iNotes >= 0 ? String(r[iNotes] || '').trim() : '',
    });
  });

  const categories = [...new Set(kept.map((p) => p.category))];
  console.log(`Parsed ${rows.length} rows → ${kept.length} to import (Keep=Y), ${skipped.length} dropped, ${bad.length} invalid.`);
  if (bad.length) { console.log('Invalid rows (fix or mark N):'); bad.forEach((b) => console.log('  - ' + b)); }
  console.log(`Categories (${categories.length}): ${categories.join(', ')}`);
  console.log(`Images: ${sharp ? 'sharp compression ON (900px JPEG q80)' : '⚠ sharp not installed — uploading as-is (npm i --no-save sharp)'}`);

  if (DRY) { console.log('\n--dry-run: nothing written.'); return; }
  if (bad.length) { console.error('\nAborting: fix the invalid rows first (or mark them N).'); process.exit(1); }

  const existing = await db.products.list();
  if (WIPE) {
    console.log(`\nWiping ${existing.length} existing products…`);
    const { error } = await db.sb.from('products').delete().gte('id', 0);
    if (error) throw error;
  } else if (existing.length) {
    console.error(`\n${existing.length} products already exist. Pass --wipe for the full replace, per the agreed plan.`);
    process.exit(1);
  }

  let ok = 0, imgOk = 0, imgFail = [];
  for (const p of kept) {
    let img = null;
    const src = p.imageSrc || findLocalImage(p.name, p.rowNum);
    if (src) {
      try {
        const { buf, mime } = await getImageBuffer(src);
        const small = await compress(buf);
        img = await db.uploadProductPhoto(small || buf, small ? 'image/jpeg' : mime);
        imgOk++;
      } catch (e) {
        imgFail.push(`${p.name}: ${e.message}`);
      }
    }
    const created = await db.products.create({
      name: p.name, category: p.category, price: p.price, unit: p.unit || null,
      stock: STOCK, description: '', bestseller: p.bestseller, ...(img ? { img } : {}),
    });
    ok++;
    if (ok % 25 === 0) console.log(`  …${ok}/${kept.length} (last id ${created.id})`);
  }

  console.log(`\n✅ Imported ${ok} products (${imgOk} with images).`);
  if (imgFail.length) { console.log(`⚠ ${imgFail.length} image failures (products created WITHOUT photo):`); imgFail.forEach((f) => console.log('  - ' + f)); }
  console.log('\nNEXT (HANDOFF.md §latest): update server.js `categories` to the list above,');
  console.log('re-point the `essentials` ids, bump sw.js CACHE_NAME, commit + push.');
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
