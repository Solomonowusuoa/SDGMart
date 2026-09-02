// E-06: the process must EXIT on an uncaught exception, not limp on.
//
// After an uncaught exception the stack has unwound from somewhere unknown,
// leaving work half-finished; carrying on serves subtly wrong results
// indefinitely. Render restarts an exited process in seconds, so losing the
// in-flight requests is the cheaper trade.
//
// WHY THIS RUNS IN A CHILD PROCESS RATHER THAN AGAINST THE LIVE SHOP.
// The checklist says "force a crash on staging". There is no staging, and
// crashing production to watch it come back costs real downtime for a fact that
// is already evidenced: Render has restarted this service on every one of the
// day's deploys, and it came back each time. What is NOT otherwise proven is
// that server.js's own uncaughtException handler fires, records the crash, and
// calls process.exit(1) — rather than the error being swallowed and the process
// continuing in an unknown state. That is what this proves, for real, against
// the real server.js.
//
//     node tests/crash.test.js

const { spawn } = require('child_process');
const path = require('path');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  if (!ok) failures++;
};

console.log('\n=== E-06. An uncaught exception stops the process ===');

const child = spawn(process.execPath, [path.join(__dirname, '_crash-child.js')], {
  env: { ...process.env, CRASH_PORT: '4021' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { out += d.toString(); });

const timer = setTimeout(() => {
  console.log('  FAIL  the process was still running 10s after the fault — it did not exit');
  failures++;
  child.kill('SIGKILL');
}, 10000);

child.on('exit', (code, signal) => {
  clearTimeout(timer);

  check('the process exits rather than carrying on', typeof code === 'number' && code !== null, true);
  check('it exits NON-ZERO, so the platform treats it as a fault', code, 1);
  check('it was not merely killed by a signal', signal, null);
  check('the fault reached our handler, not just Node\'s default',
    /Uncaught exception/.test(out), true);
  check('the crash is RECORDED before the process dies',
    /ERRORLOG .*uncaughtException/.test(out), true);
  check('the recorded crash names the fault',
    /E-06 deliberate crash/.test(out), true);
  // Not cosmetic. Without a status and path a crash lands in Admin → Errors as
  // status null / path null — the most serious row in the table and the only one
  // that cannot be filtered for. An earlier version of this test asserted the
  // 500, FAILED, and that is how the gap was found.
  check('it is recorded as a 500, so it is findable in Admin → Errors',
    /"status":500/.test(out), true);
  check('and attributed to the process rather than left path-less',
    /"path":"process"/.test(out), true);

  console.log('');
  console.log('  Render restarting an exited process is separately evidenced: the service');
  console.log('  restarted on every deploy today and came back each time. What this test adds');
  console.log('  is that the handler fires, logs, and exits — instead of swallowing the fault.');
  console.log('');
  if (failures) { console.log('  ' + failures + ' failure(s)'); process.exitCode = 1; }
});
