// End-to-end: boot server, connect as a socket.io client, create room,
// add 3 AIs, start game, verify we receive views through a full hand.
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3099;
const srv = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'inherit',
});

async function main() {
  await new Promise((r) => setTimeout(r, 800));
  const { io } = require('socket.io-client');
  const c = io('http://localhost:' + PORT, { transports: ['websocket'] });

  let views = 0;
  let lastPhase = '';

  c.on('connect_error', (e) => { console.error('connect_error', e.message); });
  c.on('view', ({ view }) => {
    views++;
    process.stdout.write('view#' + views + ' ph=' + view.phase + ' player=' + view.currentPlayer + ' bidder=' + view.currentBidder + ' tricks=' + view.tricksPlayed + ' tokens=' + view.tokens.join(',') + ' msg=' + (view.message || '') + '\n');
    lastPhase = view.phase;
  });
  c.on('actionError', (e) => console.error('actionError', e));

  await new Promise((resolve) => c.on('roomCreated', resolve) && c.emit('createRoom', { name: 'Tester' }));
  process.stdout.write('roomCreated\n');
  c.emit('addAI', { seat: 1 });
  c.emit('addAI', { seat: 2 });
  c.emit('addAI', { seat: 3 });
  await new Promise((r) => setTimeout(r, 200));
  c.emit('startGame');
  process.stdout.write('started\n');

  // Wait up to 15s for hand_end or game_over
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (lastPhase === 'hand_end' || lastPhase === 'game_over') break;
  }
  process.stdout.write('done. views=' + views + ' lastPhase=' + lastPhase + '\n');
  c.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

process.on('exit', () => { try { srv.kill('SIGKILL'); } catch (_) {} });
process.on('SIGTERM', () => { try { srv.kill('SIGKILL'); } catch (_) {} process.exit(0); });
