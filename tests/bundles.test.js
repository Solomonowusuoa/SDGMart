const assert = require('node:assert/strict');
const B = require('../bundles');
const prices = {134:20.5,81:11.5,126:26,131:20,191:45,129:80,123:15,127:40,132:70,125:35,189:23,194:70,208:20,183:13,180:20,186:25,187:40,211:105,42:70,38:10.5,46:32,227:11,75:12,72:12,43:75,228:39.5,222:12,223:90,204:130,76:45};
const products = Object.entries(prices).map(([id,price])=>({id:Number(id),name:'Product '+id,price,stock:99,unit:'pack',img:'photo.jpg'}));
const bundles = B.DEFAULTS.map(d=>B.resolve(d,products));
assert.deepEqual(bundles.map(b=>b.price),[84.5,216,372.5,126,317,164,236,367.5]);
for(const b of bundles) {
  assert.ok(b.valid && b.active);
  for(const quantity of [1,2,3,9]) {
    const lines=B.orderLines(b,quantity);
    assert.equal(lines.reduce((s,l)=>s+B.cents(l.price)*l.qty,0),B.cents(b.price)*quantity);
    for(const p of b.contents) assert.equal(lines.filter(l=>l.id===p.productId).reduce((s,l)=>s+l.qty,0),p.quantity*quantity);
    const restored=B.cartFromOrder(lines,bundles,products);
    assert.equal(restored.items.length,1);
    assert.equal(restored.items[0].qty,quantity);
  }
}
const breakfast=bundles[0], milk=products.find(p=>p.id===81);
const mixed=B.cartFromOrder([...B.orderLines(breakfast,2),{...milk,qty:3}],bundles,products);
assert.equal(mixed.items.length,2);
assert.equal(mixed.items.find(i=>i.id===81).qty,3);
assert.equal(mixed.items.find(i=>i.isBundle).qty,2);
assert.equal(B.cartFromOrder(B.orderLines(breakfast,1),[],products).items.length,0);
assert.equal(B.resolve({...B.DEFAULTS[0],active:false},products).stock,0);
assert.equal(B.resolve(B.DEFAULTS[0],products.filter(p=>p.id!==81)).valid,false);
const missingStock=products.map(p=>p.id===81?{...p,stock:3}:p);
assert.equal(B.resolve(B.DEFAULTS[0],missingStock).stock,1);
assert.equal(bundles[2].contents.find(p=>p.productId===194).quantity,1);
assert.ok(!bundles[2].contents.some(p=>p.productId===127));
for(const b of bundles.filter(b=>['cooking-basics','everyday-cooking'].includes(b.bundleId))) {
  const remie=b.contents.find(p=>p.productId===75);
  assert.equal(remie.quantity,1); assert.equal(remie.unit,'12 sachets × 10g');
}
console.log('PASS: all eight agreed bundle prices, cent-exact allocation, fixed quantities, stock, separate extras and safe reorders');
