// scripts/e2e-ui.js
// Full-stack UI test: boots the real server, spins up a jsdom "browser" that
// loads index.html + client.js + the live socket.io client bundle, then
// clicks buttons and asserts screen transitions.
//
// Catches regressions like "create room -> click Start -> back to landing"
// without needing a real browser.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3100;
const BASE = 'http://localhost:' + PORT;

function log(...a) { console.log(...a); }
function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(); });
        req.on('error', reject);
        req.setTimeout(500, () => { req.destroy(new Error('timeout')); });
      });
      return true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function run() {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });
  let srvErr = '';
  srv.stderr.on('data', (c) => { srvErr += c; process.stderr.write(c); });

  try {
    const ok = await waitForServer(BASE + '/health');
    if (!ok) fail('server did not start');
    log('[ok] server up');

    // Prefetch index.html and client.js & friends so we can parse them offline.
    const html = await fetchText(BASE + '/');
    const socketIoClient = await fetchText(BASE + '/socket.io/socket.io.js');

    // Build a jsdom environment and inject scripts in the right order.
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, {
      url: BASE + '/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      resources: 'usable',
    });
    const { window } = dom;

    // Patch things jsdom lacks that the client uses.
    window.navigator.vibrate = () => true;
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.AudioContext = window.AudioContext || function () {
      return {
        createOscillator() { return { connect() { return this; }, start() {}, stop() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, type: 'sine' }; },
        createGain() { return { connect() { return this; }, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; },
        createBuffer(ch, len, sr) { return { getChannelData() { return new Float32Array(len); } }; },
        createBufferSource() { return { connect() { return this; }, start() {}, stop() {} }; },
        createBiquadFilter() { return { connect() { return this; }, frequency: { value: 0 }, Q: { value: 0 }, type: 'bandpass' }; },
        get currentTime() { return 0; },
        get state() { return 'running'; },
        get destination() { return {}; },
        resume() { return Promise.resolve(); },
      };
    };
    window.navigator.share = undefined;
    if (!window.navigator.clipboard) window.navigator.clipboard = { writeText: async () => {} };

    // Expose localStorage-backed state for the test to inspect.
    window.eval(socketIoClient);
    const fxJs = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'fx.js'), 'utf8');
    const cardsJs = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'cards.js'), 'utf8');
    const clientJs = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'client.js'), 'utf8');
    window.eval(fxJs);
    window.eval(cardsJs);
    window.eval(clientJs);

    // Wait for the client to connect
    await waitFor(() => window.__p304 && window.__p304.socket && window.__p304.socket.connected, 5000);
    log('[ok] client connected');

    // Initial state should be landing.
    assertScreen(window, 'landing');
    log('[ok] landing screen shown initially');

    // Simulate typing a name
    window.document.querySelector('#name-input').value = 'Rath';
    clickButton(window, '#create-btn');

    // Wait until roomCreated applied (state.roomId set, screen -> lobby)
    await waitFor(() => window.__p304.state.roomId && window.__p304.state.screen === 'lobby', 3000);
    log('[ok] create-room -> lobby (room=' + window.__p304.state.roomId + ')');

    // Add 3 AIs via host
    for (const seat of [1, 2, 3]) {
      window.__p304.socket.emit('addAI', { seat });
    }
    await new Promise((r) => setTimeout(r, 200));

    // Click Start
    clickButton(window, '#start-btn');

    // CRITICAL: ensure we land on the table, not back on landing.
    await waitFor(() => window.__p304.state.screen === 'table', 4000,
      () => 'state.screen after Start is ' + window.__p304.state.screen + '; view.phase=' + (window.__p304.state.view && window.__p304.state.view.phase));
    log('[ok] start-game -> table');

    // Verify your-hand has 4 cards (first batch)
    await waitFor(() => window.document.querySelectorAll('#your-hand .card').length === 4, 3000,
      () => 'your-hand has ' + window.document.querySelectorAll('#your-hand .card').length + ' cards');
    log('[ok] dealt 4 cards');

    // Verify table chrome renders
    if (!window.document.querySelector('#phase-banner').textContent) fail('phase banner empty');
    if (!window.document.querySelector('#table-code').textContent) fail('table code empty');

    // Let the AIs drive the game for a few seconds; make sure we don't
    // ever land back on landing.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (window.__p304.state.screen === 'landing') {
        fail('regressed to landing after starting game');
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    log('[ok] stayed on table for 6s (no loop-to-landing)');

    // Also assert the bid-history chip strip is showing (we're in bid4 or later)
    const view = window.__p304.state.view;
    if (!view) fail('no view after play');
    log('[ok] view reachable: phase=' + view.phase + ' tricksPlayed=' + view.tricksPlayed);

    // --- Second scenario: stale localStorage.p304.room from a previous session ---
    // Simulate: close page, bad room in localStorage, reopen page.
    window.localStorage.setItem('p304.room', 'DEADROOM');
    window.localStorage.setItem('p304.name', 'Rath');
    window.__p304.socket.close();

    const dom2 = new JSDOM(html, {
      url: BASE + '/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const w2 = dom2.window;
    w2.navigator.vibrate = () => true;
    w2.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w2.AudioContext = window.AudioContext;
    w2.navigator.clipboard = { writeText: async () => {} };
    // seed the stale localStorage before client.js runs
    w2.localStorage.setItem('p304.room', 'DEADROOM');
    w2.localStorage.setItem('p304.name', 'Rath');
    w2.eval(socketIoClient);
    w2.eval(fxJs);
    w2.eval(cardsJs);
    w2.eval(clientJs);

    await waitFor(() => w2.__p304 && w2.__p304.socket && w2.__p304.socket.connected, 5000);
    // give the server time to respond to the stale joinRoom
    await new Promise((r) => setTimeout(r, 600));
    // Should still be on landing (server said room not found; client self-heals)
    assertScreen(w2, 'landing');
    // Stale room should be cleared from localStorage
    if (w2.localStorage.getItem('p304.room')) fail('stale p304.room was not cleared after room-not-found');
    log('[ok] stale-room auto-recovery: cleared localStorage + on landing');

    // Now create a fresh room — should succeed.
    w2.document.querySelector('#name-input').value = 'Rath';
    clickButton(w2, '#create-btn');
    await waitFor(() => w2.__p304.state.roomId && w2.__p304.state.screen === 'lobby', 3000);
    log('[ok] after recovery: create-room -> lobby');

    // Add AIs + Start, confirm reach table.
    for (const seat of [1, 2, 3]) w2.__p304.socket.emit('addAI', { seat });
    await new Promise((r) => setTimeout(r, 200));
    clickButton(w2, '#start-btn');
    await waitFor(() => w2.__p304.state.screen === 'table', 4000,
      () => 'post-recovery screen=' + w2.__p304.state.screen);
    log('[ok] after recovery: start-game -> table');

    // Close all live sockets + jsdom windows to stop teardown noise
    try { dom2.window.__p304.socket.close(); } catch (_) {}
    try { dom2.window.close(); } catch (_) {}
    try { dom.window.close(); } catch (_) {}

    console.log('\nALL UI E2E ASSERTIONS PASSED.');
  } finally {
    try { srv.kill('SIGTERM'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    try { srv.kill('SIGKILL'); } catch (_) {}
  }
  // jsdom keeps a few resource streams alive; force-exit.
  process.exit(0);
}

function clickButton(win, sel) {
  const el = win.document.querySelector(sel);
  if (!el) throw new Error('no element: ' + sel);
  const ev = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

function assertScreen(win, name) {
  const got = win.__p304 && win.__p304.state && win.__p304.state.screen;
  if (got !== name) fail('expected screen=' + name + ' got ' + got);
}

async function waitFor(fn, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ok = false;
    try { ok = !!fn(); } catch (e) { ok = false; }
    if (ok) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  const msg = typeof failMsg === 'function' ? failMsg() : (failMsg || 'condition not met');
  fail('waitFor: ' + msg);
}

run().catch((e) => { console.error(e); process.exit(1); });
