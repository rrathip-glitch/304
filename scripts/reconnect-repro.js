// Reproduces the "Start Game loops back to landing" race.
// Bug: user taps Start Game during a brief socket disconnect. Socket.IO
// buffers the event and flushes it on reconnect BEFORE our `connect`
// handler emits `resume`. The server receives startGame on a fresh
// socket with no seat context and returns "no room".
//
// This script simulates that exact sequence against a real server, both
// with the NAIVE client behavior (should fail) and a GATED client
// behavior (should succeed). Run: node scripts/reconnect-repro.js
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3107;
const srv = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
srv.stdout.on('data', () => {});
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); srv.kill('SIGKILL'); process.exit(1); } }

async function runScenario(label, useGate) {
  const { io } = require('socket.io-client');
  const c = io(`http://localhost:${PORT}`, { transports: ['websocket'], reconnection: true, reconnectionDelay: 200 });
  const events = [];
  c.on('roomCreated', (p) => events.push(['roomCreated', p.roomId]));
  c.on('roomJoined', (p) => events.push(['roomJoined', p.seat, p.view && p.view.phase]));
  c.on('view', (p) => events.push(['view', p.view.phase]));
  c.on('actionError', (e) => events.push(['actionError', e.reason]));

  // Gated emit behavior mimicking the client fix.
  let emitReady = true;
  const pending = [];
  function gatedEmit(name, payload) {
    if (useGate) {
      if (emitReady && c.connected) { c.emit(name, payload); return; }
      pending.push([name, payload]);
    } else {
      c.emit(name, payload);
    }
  }
  function openGate() {
    emitReady = true;
    while (pending.length) { const [n, p] = pending.shift(); c.emit(n, p); }
  }
  function closeGate() { emitReady = false; }

  c.on('disconnect', () => { if (useGate) closeGate(); });
  c.on('connect', () => {
    if (useGate) {
      const sess = loadSession();
      if (sess) { closeGate(); c.emit('resume', sess); }
      else openGate();
    }
  });

  let session = null;
  function loadSession() { return session; }
  c.on('roomCreated', (p) => { session = { roomId: p.roomId, name: 'Rath' }; if (useGate) openGate(); });
  c.on('roomJoined', () => { if (useGate) openGate(); });

  // 1) Create room while connected
  await new Promise((r) => c.once('connect', r));
  gatedEmit('createRoom', { name: 'Rath' });
  await new Promise((r) => c.once('roomCreated', r));

  // 2) Force disconnect
  c.io.engine.close();
  await new Promise((r) => setTimeout(r, 30));
  assert(!c.connected, '[' + label + '] socket should be disconnected');

  // 3) User taps Start Game DURING the disconnect
  gatedEmit('startGame');

  // 4) Wait for reconnect + everything to settle
  await new Promise((r) => setTimeout(r, 1500));

  const phases = events.filter((e) => e[0] === 'view').map((e) => e[1]);
  const errors = events.filter((e) => e[0] === 'actionError').map((e) => e[1]);
  console.log(`[${label}]`);
  console.log('  views:  ' + JSON.stringify(phases));
  console.log('  errors: ' + JSON.stringify(errors));
  const gameStarted = phases.includes('bid4');
  console.log('  Start Game reached bid4? ' + gameStarted);
  c.close();
  return { gameStarted, errors };
}

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  const naive = await runScenario('NAIVE (no gate)', false);
  const gated = await runScenario('GATED (fix)', true);

  console.log('\n--- Summary ---');
  console.log('Naive started?', naive.gameStarted, '  errors:', naive.errors);
  console.log('Gated started?', gated.gameStarted, '  errors:', gated.errors);

  srv.kill('SIGKILL');
  // Expect: naive fails OR emits "no room"; gated succeeds with no errors.
  if (!gated.gameStarted) { console.error('FAIL: gated scenario did not reach bid4'); process.exit(1); }
  if (gated.errors.length > 0) { console.error('FAIL: gated scenario had errors:', gated.errors); process.exit(1); }
  console.log('\nOK: emit gate fixes the race.');
  process.exit(0);
})().catch((e) => { console.error(e); srv.kill('SIGKILL'); process.exit(1); });

process.on('exit', () => { try { srv.kill('SIGKILL'); } catch (_) {} });
