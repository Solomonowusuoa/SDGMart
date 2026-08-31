/* SDGMart — STEP 2 automated API-level checks, against the LIVE api.
 *
 * SAFETY RULE FOR THIS FILE: every request here is either read-only, or a
 * request the server is SUPPOSED to reject. Nothing in here can create an
 * order or an account if the fixes work. If a "should be rejected" check
 * FAILS, that itself may have written a row — each such check says so.
 *
 * Deliberately NOT included (they need a decision first):
 *   - login rate-limit tests   (burns the 50/15min per-IP budget, 15 min block)
 *   - forgot-password on a REAL address (sends mail)
 *   - qty-clamp / duplicate-collapse (only provable by placing a real order)
 */
const BASE = process.env.BASE || 'https://sdg-mart.com';
const results = [];
function rec(id, name, pass, detail, danger) {
  results.push({ id, name, pass, detail, danger });
  const tag = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO';
  console.log('  ' + tag + '  [' + id + '] ' + name + (detail ? '\n            ' + detail : ''));
}
const j = async (path, body, extra) => {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(extra || {}) },
    body: JSON.stringify(body),
  });
  let t = ''; try { t = await r.text(); } catch (_) {}
  let parsed = null; try { parsed = JSON.parse(t); } catch (_) {}
  return { status: r.status, text: t, json: parsed, headers: r.headers };
};

(async () => {
  console.log('BASE = ' + BASE + '\n');

  // ── A. Security headers (A-17) ────────────────────────────────────────
  console.log('A. Security headers (A-17)');
  const root = await fetch(BASE + '/', { headers: { 'accept-encoding': 'gzip' } });
  const want = {
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': null,
    'content-security-policy': null,
    'strict-transport-security': null,
  };
  for (const [h, expect] of Object.entries(want)) {
    const got = root.headers.get(h);
    rec('A-17', 'header ' + h, !!got && (!expect || got === expect), got ? String(got).slice(0, 70) : 'ABSENT');
  }
  rec('A-17', 'CSP report-only present', !!root.headers.get('content-security-policy-report-only'),
    (root.headers.get('content-security-policy-report-only') || 'ABSENT').slice(0, 60) + '…');

  // ── B. Secret-file lockdown (A-03) ────────────────────────────────────
  console.log('\nB. Secret-file lockdown (A-03)');
  for (const p of ['/.git/config', '/.git/HEAD', '/.env']) {
    const r = await fetch(BASE + p);
    rec('A-03', p + ' is not served', r.status === 404, 'status ' + r.status +
      (r.status === 200 ? '  *** ROTATE CREDENTIALS ***' : ''));
  }
  const bundle = await fetch(BASE + '/app.bundle.js');
  rec('A-03', '/app.bundle.js still served', bundle.status === 200, 'status ' + bundle.status);

  // ── C. Compression (D-06) ─────────────────────────────────────────────
  console.log('\nC. Compression (D-06)');
  for (const p of ['/', '/api/catalog']) {
    const r = await fetch(BASE + p, { headers: { 'accept-encoding': 'gzip, br' } });
    const enc = r.headers.get('content-encoding');
    rec('D-06', p + ' is compressed', !!enc, 'content-encoding: ' + (enc || 'NONE'));
  }

  // ── D. Health endpoints (E-05) ────────────────────────────────────────
  console.log('\nD. Health endpoints');
  for (const p of ['/healthz', '/readyz']) {
    const r = await fetch(BASE + p);
    rec('E-05', p, r.status === 200, 'status ' + r.status);
  }

  // ── E. Consent enforcement (H-03) ─────────────────────────────────────
  // Sends a well-formed signup with acceptedTerms MISSING. Must be rejected.
  console.log('\nE. Consent enforcement (H-03)');
  const stamp = Date.now();
  const noConsent = await j('/api/auth/signup', {
    name: 'Step2 Check', email: `sdgtest-consent-${stamp}@example.invalid`,
    phone: '0200000000', password: 'Str0ng!Passw0rd42',
  });
  rec('H-03', 'signup without acceptedTerms is refused', noConsent.status === 400,
    'status ' + noConsent.status + ' · ' + (noConsent.json ? noConsent.json.error : noConsent.text).slice(0, 80) +
    (noConsent.status === 201 ? '  *** AN ACCOUNT WAS CREATED — DELETE IT ***' : ''));

  // ── F. Order input validation (C-03, C-04) ────────────────────────────
  // Every basket below is one the server must refuse. A 201 here means a real
  // order row exists and must be deleted.
  console.log('\nF. Order input validation (C-03, C-04)');
  const baseOrder = (items) => ({
    items, name: 'Step2 Check', phone: '0200000000',
    address: 'API check — should never be created', payMethod: 'cash',
  });
  const cases = [
    ['C-03', 'empty basket refused', baseOrder([])],
    ['C-03', 'only-unknown-product-ids refused', baseOrder([{ id: 99999901, qty: 1 }, { id: 99999902, qty: 2 }])],
    ['C-04', 'qty 0 drops the line (basket becomes empty)', baseOrder([{ id: 99999903, qty: 0 }])],
    ['C-04', 'negative qty drops the line', baseOrder([{ id: 99999904, qty: -5 }])],
    ['C-04', '>100 distinct items refused', baseOrder(Array.from({ length: 130 }, (_, i) => ({ id: 90000000 + i, qty: 1 })))],
    ['C-03', 'items not an array refused', { ...baseOrder([]), items: 'not-an-array' }],
    ['C-03', 'no items field at all refused', { name: 'Step2 Check', phone: '0200000000', payMethod: 'cash' }],
  ];
  for (const [id, name, body] of cases) {
    const r = await j('/api/orders', body);
    const created = r.status === 201;
    rec(id, name, r.status >= 400 && r.status < 500,
      'status ' + r.status + ' · ' + String(r.json ? (r.json.error || JSON.stringify(r.json)) : r.text).slice(0, 90) +
      (created ? '  *** ORDER CREATED — DELETE IT ***' : ''), created);
  }

  // ── G. Email enumeration (A-11), non-destructive half ─────────────────
  // Only unknown addresses are used, so no reset mail can be sent to anyone.
  console.log('\nG. Email enumeration — forgot-password (A-11)');
  const probes = [
    ['unknown address', `sdgtest-nobody-${stamp}@example.invalid`],
    ['sql-ish wildcard', "a%"],
    ['another unknown', `sdgtest-nobody2-${stamp}@example.invalid`],
  ];
  const bodies = [];
  for (const [label, email] of probes) {
    const t0 = Date.now();
    const r = await j('/api/auth/forgot-password', { email });
    bodies.push({ label, status: r.status, body: r.text, ms: Date.now() - t0 });
    rec('A-11', 'forgot-password (' + label + ')', r.status === 200,
      'status ' + r.status + ' · body ' + r.text.slice(0, 60) + ' · ' + (Date.now() - t0) + 'ms');
  }
  const identical = bodies.every((b) => b.body === bodies[0].body && b.status === bodies[0].status);
  rec('A-11', 'all unknown-address responses byte-identical', identical,
    identical ? 'all → ' + bodies[0].body : bodies.map((b) => b.label + '=' + b.body).join(' | '));
  rec('A-10', 'no reset link leaked in the response body',
    !/resetLink|\/\?reset=/.test(bodies[0].body), bodies[0].body.slice(0, 80));

  // ── H. Signup enumeration — observation only ──────────────────────────
  console.log('\nH. Signup-endpoint enumeration (observation)');
  const unknownSignup = await j('/api/auth/signup', {
    name: 'Step2 Check', email: `sdgtest-unknown-${stamp}@example.invalid`,
    phone: '0200000000', password: 'short', acceptedTerms: true,
  });
  rec('A-11', 'weak password refused before any account exists', unknownSignup.status === 400,
    'status ' + unknownSignup.status + ' · ' + String(unknownSignup.json ? unknownSignup.json.error : '').slice(0, 80));

  // ── Summary ───────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false);
  const danger = results.filter((r) => r.danger);
  console.log('\n' + '='.repeat(64));
  console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
  if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  if (danger.length) console.log('\n*** ' + danger.length + ' check(s) may have written data — clean up. ***');
  require('fs').writeFileSync(require('path').join(__dirname, 'step2-results.json'), JSON.stringify(results, null, 2));
})();
