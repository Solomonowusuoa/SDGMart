const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

// Exercise the actual component's input handlers and add action without a DB.
const state = [];
let cursor = 0, added = 0;
const bundle = { id: 'bundle:test', name: 'Test bundle', category: 'Breakfast', valid: true, active: true, stock: 4, price: 20, regularTotal: 25, saving: 5, contents: [] };
const context = {
  window: { BUNDLES: [bundle], SHOW_STOCK: false },
  useMobile: () => false,
  React: {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { state[i] = value; }];
    },
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
  },
};
vm.createContext(context);
vm.runInContext(transformSync(fs.readFileSync(path.join(__dirname, '../components/BundleComponents.jsx'), 'utf8'), { loader: 'jsx' }).code, context);
function render() {
  cursor = 0;
  const root = context.window.BundleProductPage({ product: bundle, onAdd: () => added++, onView() {}, setPage() {} });
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    nodes.push(node); walk(node.props.children);
  }
  walk(root);
  return {
    input: nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Number of bundles'),
    add: nodes.find(n => n.type === 'button' && n.props.children.some(c => c === 'Add bundle' || c === 'Add another')),
  };
}
function change(value) { render().input.props.onChange({ target: { value } }); return render(); }
assert.equal(render().input.props.value, '1');
assert.equal(change('').input.props.value, '', 'Backspace must leave the field empty while editing');
let view = change('2');
assert.equal(view.input.props.value, '2');
assert.ok(view.add.props.children.includes('40.00'), 'The total must reflect the replacement quantity');
view.add.props.onClick();
assert.equal(added, 2, 'Clearing 1 then typing 2 must add two bundles, not twelve');
change('').input.props.onBlur();
assert.equal(render().input.props.value, '1', 'An empty field defaults to one on blur');
for (const [raw, expected] of [['0','1'], ['-2','1'], ['2.8','2'], ['999','99']]) {
  change(raw).input.props.onBlur();
  assert.equal(render().input.props.value, expected);
}
context.window.SHOW_STOCK = true;
view = change('9');
assert.equal(view.input.props.max, 4);
const before = added;
view.add.props.onClick();
assert.equal(added - before, 4, 'The add action must respect the stock limit');
assert.equal(render().input.props.value, '4');
console.log('PASS: bundle quantity can be cleared and replaced; blur, totals and add respect whole-number limits');
