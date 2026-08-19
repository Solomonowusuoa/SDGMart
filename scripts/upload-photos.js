#!/usr/bin/env node
/**
 * Bulk-upload product photos from a local folder to Supabase + set products.img.
 *
 * Usage:
 *   node scripts/upload-photos.js <folder> [--dry-run] [--overwrite] [--white-bg]
 *
 * --white-bg  replace a solid BLACK background with white before uploading
 *             (flood-fills the background-connected black from the edges; black
 *             inside the product — labels/text — is preserved). Use for packshots
 *             that came on a black background.
 *
 * Naming convention: each image file's name must START with the product id.
 *   42.jpg              -> product 42
 *   42-abena-rice.png   -> product 42
 *   060 aunty lulu.webp -> product 60
 * Accepted types: .jpg .jpeg .png .webp .gif .bmp .avif
 *
 * By default a product that already has a photo is skipped (pass --overwrite to replace).
 * Images are compressed to <=900px JPEG (transparent PNGs flattened on white),
 * matching how the app's own uploader stores photos.
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_KEY in SDGMart/.env, and `sharp`
 * (already in node_modules; if missing: npm i --no-save sharp).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.argv[2];
const DRY = process.argv.includes('--dry-run');
const OVERWRITE = process.argv.includes('--overwrite');
const WHITEBG = process.argv.includes('--white-bg');
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

if (!DIR) {
  console.error('Usage: node scripts/upload-photos.js <folder> [--dry-run] [--overwrite]');
  process.exit(1);
}
if (!fs.existsSync(DIR)) { console.error('Folder not found:', DIR); process.exit(1); }

// --- load .env from the project dir ---
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
let sharp, createClient;
try { sharp = require('sharp'); } catch { console.error('Missing sharp. Run: npm i --no-save sharp'); process.exit(1); }
try { ({ createClient } = require('@supabase/supabase-js')); } catch { console.error('Missing @supabase/supabase-js'); process.exit(1); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
// Replace a solid black background with white via edge flood-fill; preserves interior black.
async function floodWhite(inBuf) {
  const TH = 50;
  const { data, info } = await sharp(inBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels, N = W * H;
  const bg = new Uint8Array(N); const stack = [];
  const dark = p => { const i = p * C; return lum(data[i], data[i + 1], data[i + 2]) < TH; };
  const seed = p => { if (!bg[p] && dark(p)) { bg[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) { const p = stack.pop(), x = p % W, y = (p - x) / W;
    if (x > 0) seed(p - 1); if (x < W - 1) seed(p + 1); if (y > 0) seed(p - W); if (y < H - 1) seed(p + W); }
  for (let p = 0; p < N; p++) if (bg[p]) { const i = p * C; data[i] = data[i + 1] = data[i + 2] = 255; }
  for (let pass = 0; pass < 2; pass++) {            // soften dark halo touching the new white
    const touched = [];
    for (let p = 0; p < N; p++) { if (bg[p]) continue; const x = p % W, y = (p - x) / W;
      if (!((x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]))) continue;
      const i = p * C; if (lum(data[i], data[i + 1], data[i + 2]) < 95) touched.push(p); }
    for (const p of touched) { const i = p * C; for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] * 0.5 + 128); bg[p] = 1; }
  }
  return sharp(Buffer.from(data), { raw: { width: W, height: H, channels: C } })
    .resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}
async function toJpeg(inBuf) {
  if (WHITEBG) return floodWhite(inBuf);
  return sharp(inBuf).resize(900, 900, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
}

async function main() {
  // Map filename -> product id
  const files = fs.readdirSync(DIR).filter(f => EXT.has(path.extname(f).toLowerCase()));
  const jobs = [];
  for (const f of files) {
    const m = path.basename(f).match(/^(\d+)/);
    if (!m) { console.log(`SKIP  ${f}  (no leading product id)`); continue; }
    jobs.push({ file: f, id: Number(m[1]) });
  }
  if (!jobs.length) { console.log('No id-named images found in', DIR); return; }

  // Fetch the target products
  const ids = [...new Set(jobs.map(j => j.id))];
  const { data: prods, error } = await sb.from('products').select('id,name,img').in('id', ids);
  if (error) { console.error(error); process.exit(1); }
  const byId = Object.fromEntries(prods.map(p => [p.id, p]));

  console.log(`${jobs.length} image(s) -> ${ids.length} product(s)${DRY ? '  [DRY RUN]' : ''}\n`);
  let ok = 0, skipped = 0, failed = 0;
  const seen = new Set();
  for (const j of jobs) {
    const p = byId[j.id];
    if (!p) { console.log(`SKIP  ${j.file}  -> id ${j.id} not found in catalog`); skipped++; continue; }
    if (seen.has(j.id)) { console.log(`SKIP  ${j.file}  -> id ${j.id} already handled by an earlier file`); skipped++; continue; }
    if (p.img && !OVERWRITE) { console.log(`SKIP  ${j.file}  -> ${p.name} already has a photo (use --overwrite)`); skipped++; continue; }
    seen.add(j.id);
    try {
      const inBuf = fs.readFileSync(path.join(DIR, j.file));
      const outBuf = await toJpeg(inBuf);
      if (DRY) { console.log(`WOULD  ${j.file}  -> ${j.id} ${p.name}  (${Math.round(outBuf.length / 1024)}KB)`); ok++; continue; }
      const key = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
      const up = await sb.storage.from('product-photos').upload(key, outBuf, { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (up.error) throw up.error;
      const { data: pub } = sb.storage.from('product-photos').getPublicUrl(key);
      const upd = await sb.from('products').update({ img: pub.publicUrl }).eq('id', j.id);
      if (upd.error) throw upd.error;
      console.log(`OK    ${j.file}  -> ${j.id} ${p.name}`);
      ok++;
    } catch (e) { console.log(`FAIL  ${j.file}  -> ${j.id}: ${e.message || e}`); failed++; }
  }

  // recount
  const { data: all } = await sb.from('products').select('id,img');
  const missing = all.filter(x => !x.img || String(x.img).trim() === '');
  console.log(`\n${ok} uploaded, ${skipped} skipped, ${failed} failed.`);
  console.log(`Catalog: ${all.length} products, ${all.length - missing.length} with photo, ${missing.length} still missing.`);
  if (!DRY && ok) console.log('Note: the live site refreshes its 60s catalog cache automatically — allow up to a minute.');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
