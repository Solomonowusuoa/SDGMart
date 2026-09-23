// Shared bundle rules: prices in integer pesewas, fixed membership, real product IDs.
(function (root) {
  const member = (productId, quantity = 1, label = '') => ({ productId, quantity, label });
  const DEFAULTS = [
    { id: 'breakfast-basics', group: 'Breakfast', name: 'Breakfast Basics', saving: 5, members: [member(134,1,'25 tea bags'),member(81,2),member(126),member(131)] },
    { id: 'breakfast-favourites', group: 'Breakfast', name: 'Breakfast Favourites', saving: 10, members: [member(191),member(81,4),member(129),member(123),member(127)] },
    { id: 'family-breakfast', group: 'Breakfast', name: 'Family Breakfast', saving: 15, members: [member(132),member(134,1,'25 tea bags'),member(81,6),member(125),member(131),member(189),member(194),member(129)] },
    { id: 'everyday-home', group: 'Home Essentials', name: 'Everyday Home', saving: 5, members: [member(208),member(183,2),member(180),member(186),member(187)] },
    { id: 'family-home', group: 'Home Essentials', name: 'Family Home', saving: 10, members: [member(208,2),member(183,4),member(180,2),member(186,2),member(187),member(211)] },
    { id: 'cooking-basics', group: 'Cooking Essentials', name: 'Cooking Basics', saving: 5, members: [member(42),member(38,2),member(46),member(227,2),member(75,1,'12 sachets × 10g'),member(72)] },
    { id: 'everyday-cooking', group: 'Cooking Essentials', name: 'Everyday Cooking', saving: 10, members: [member(43),member(38,3),member(46,2),member(228),member(222),member(75,1,'12 sachets × 10g'),member(72)] },
    { id: 'family-cooking', group: 'Cooking Essentials', name: 'Family Cooking', saving: 15, members: [member(223),member(38,4),member(204),member(228),member(222,2),member(76),member(72)] },
  ].map(d => ({ ...d, active: true, version: 1, img: '', description: 'A fixed selection, with a saving when bought together.' }));
  const cents = n => Math.round(Number(n) * 100);
  const isBundle = item => typeof item?.id === 'string' && item.id.startsWith('bundle:');
  function resolve(def, products) {
    const byId = new Map(products.map(p => [Number(p.id), p]));
    const contents = def.members.map(m => {
      const p = byId.get(m.productId);
      return { ...m, name: p?.name || 'Product unavailable', unit: m.label || p?.unit || 'each', price: Number(p?.price || 0), img: p?.img || '', category: p?.category || '', stock: Number(p?.stock || 0), missing: !p };
    });
    const regular = contents.reduce((n, p) => n + cents(p.price) * p.quantity, 0);
    const saving = cents(def.saving);
    const valid = !contents.some(p => p.missing) && saving >= 0 && regular > saving;
    const stock = valid && def.active ? Math.max(0, Math.min(...contents.map(p => Math.floor(p.stock / p.quantity)))) : 0;
    return { id: 'bundle:' + def.id, bundleId: def.id, bundleVersion: def.version, isBundle: true, name: def.name, category: def.group,
      description: def.description, img: def.img || '', unit: 'fixed bundle', price: (regular - saving) / 100,
      regularTotal: regular / 100, saving: saving / 100, contents, stock, active: def.active, valid };
  }
  // Allocate the bundle price across the actual units, preserving exact cents.
  // Orders keep these immutable lines so packing, stock, refunds and receipts
  // all use the quantities and prices bought, even after an Admin edit.
  function orderLines(bundle, quantity) {
    let running = 0, allocated = 0;
    const lines = [];
    for (const p of bundle.contents) {
      const split = new Map();
      for (let unit = 0; unit < p.quantity; unit++) {
        running += cents(p.price);
        const cumulative = Math.round(running * cents(bundle.price) / cents(bundle.regularTotal));
        const price = cumulative - allocated;
        allocated = cumulative;
        split.set(price, (split.get(price) || 0) + quantity);
      }
      for (const [price, qty] of split) lines.push({ id: p.productId, name: p.name, unit: p.unit, category: p.category, price: price / 100, qty,
        bundleId: bundle.bundleId, bundleName: bundle.name, bundleQuantity: quantity, bundleVersion: bundle.bundleVersion,
        bundlePrice: bundle.price, bundleRegularTotal: bundle.regularTotal, bundleSaving: bundle.saving });
    }
    return lines;
  }
  function cartFromOrder(items, bundles, products) {
    const result = new Map(), skipped = [];
    for (const item of items || []) {
      if (item.birthdayGift) continue;
      const id = item.bundleId ? 'bundle:' + item.bundleId : item.id;
      if (item.bundleId && result.has(id)) continue;
      const fresh = (item.bundleId ? bundles : products).find(p => p.id === id);
      if (!fresh || fresh.stock <= 0 || fresh.active === false) { if (!skipped.includes(item.bundleName || item.name)) skipped.push(item.bundleName || item.name); continue; }
      const qty = item.bundleId ? item.bundleQuantity : (result.get(id)?.qty || 0) + item.qty;
      result.set(id, { ...fresh, qty });
    }
    return { items: [...result.values()], skipped };
  }
  const api = { DEFAULTS, resolve, orderLines, cartFromOrder, cents, isBundle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BundleRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
