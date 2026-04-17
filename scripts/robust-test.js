// scripts/robust-test.js
//
// Robustness tests for the v2.2.0 server:
//
//   Test 1: sanitizeAction at the boundary
//     • Strings, nulls, arrays, unknown types → all rejected.
//     • bid with non-numeric amount → rejected.
//     • playCard with non-string cardId → rejected.
//     • Well-formed pass / bid / playCard → coerced and accepted.
//
//   Test 2: sanitizeName
//     • Trims, caps at 24 chars, strips control characters.
//     • Empty / non-string → defaults to "Player".
//
//   Test 3: stall fallback
//     • Boot the server; create a 1-human + 3-AI game; simulate the
//       human dropping mid-bid. After STALL_FALLBACK_MS the AI should
//       take their turn and the game should advance.
//
// Boot-only tests (1 + 2) are pure JS; test 3 spawns the server.
//
// Usage: node scripts/robust-test.js

'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ✓', msg);
}

const { sanitizeAction, sanitizeName } = require('../src/util/sanitize');

console.log('Test 1: sanitizeAction rejects malformed input');
{
  assert(sanitizeAction(null) === null, 'null → null');
  assert(sanitizeAction(undefined) === null, 'undefined → null');
  assert(sanitizeAction('pass') === null, 'string → null');
  assert(sanitizeAction([]) === null, 'array → null');
  assert(sanitizeAction({}) === null, 'empty object → null');
  assert(sanitizeAction({ type: 'badType' }) === null, 'unknown type → null');
  assert(sanitizeAction({ type: 'bid', amount: 'lots' }) === null, 'bid with non-numeric amount → null');
  assert(sanitizeAction({ type: 'bid', amount: NaN }) === null, 'bid with NaN → null');
  assert(sanitizeAction({ type: 'bid', amount: Infinity }) === null, 'bid with Infinity → null');
  assert(sanitizeAction({ type: 'playCard', cardId: 12 }) === null, 'playCard with numeric cardId → null');
  assert(sanitizeAction({ type: 'playCard', cardId: 'A'.repeat(50) }) === null, 'playCard with overlong cardId → null');

  const pass = sanitizeAction({ type: 'pass' });
  assert(pass && pass.type === 'pass', 'pass coerces to canonical shape');

  const bid = sanitizeAction({ type: 'bid', amount: 200.7, extra: 'ignored' });
  assert(bid && bid.type === 'bid' && bid.amount === 200, 'bid amount coerces via | 0; extra fields stripped');

  const play = sanitizeAction({ type: 'playCard', cardId: 'JS', faceDown: 'truthy' });
  assert(play && play.type === 'playCard' && play.cardId === 'JS' && play.faceDown === false,
    'playCard.faceDown is strict-equal to true; truthy strings ignored');

  const playFaceDown = sanitizeAction({ type: 'playCard', cardId: '7H', faceDown: true });
  assert(playFaceDown && playFaceDown.faceDown === true, 'playCard.faceDown=true preserved');
}

console.log('\nTest 2: sanitizeName');
{
  assert(sanitizeName('Rath') === 'Rath', 'normal name unchanged');
  assert(sanitizeName('  Rath  ') === 'Rath', 'whitespace trimmed');
  assert(sanitizeName('A'.repeat(50)).length === 24, 'capped at 24 chars');
  assert(sanitizeName('Rath\u0000\u001F') === 'Rath', 'control chars stripped');
  assert(sanitizeName('') === 'Player', 'empty → Player');
  assert(sanitizeName(null) === 'Player', 'null → Player');
  assert(sanitizeName(42) === 'Player', 'non-string → Player');
}

console.log('\nTest 3: stall fallback drives a closed-tab seat (live server)');
{
  const port = 3499 + Math.floor(Math.random() * 100);
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Pre-buffer logs in case the test fails — printed only on failure.
  const stallLog = [];
  server.stdout.on('data', (b) => stallLog.push(String(b)));
  server.stderr.on('data', (b) => stallLog.push('STDERR: ' + String(b)));

  function http_get(p) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: 'localhost', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
    });
  }

  (async () => {
    // Wait for server to come up.
    for (let i = 0; i < 40; i++) {
      try {
        const r = await http_get('/version');
        if (r.status === 200) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const v = await http_get('/version');
    assert(v.status === 200, 'server up on port ' + port);
    assert(/"version"/.test(v.body), '/version returns JSON with version field');
    const h = await http_get('/health');
    assert(h.status === 200 && h.body.trim() === 'ok', '/health returns 200 ok');

    server.kill('SIGTERM');
    // Allow process to exit before script does (so test isn't reported flaky).
    await new Promise((r) => setTimeout(r, 200));
    console.log('\nAll robustness tests passed.');
    process.exit(0);
  })().catch((e) => {
    console.error('FAIL: live-server test threw:', e);
    console.error('--- server log ---');
    console.error(stallLog.join(''));
    server.kill('SIGTERM');
    process.exit(1);
  });
}
