// 304 - Express + Socket.IO server.
// See docs/API.md and docs/ARCHITECTURE.md. Server-authoritative game state.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const game = require('./src/engine/game');
const { sanitizeName, sanitizeAction } = require('./src/util/sanitize');

// AI module is optional during scaffolding; fall back to a no-op chooser.
let ai;
try {
  ai = require('./src/engine/ai');
} catch (e) {
  ai = {
    chooseAction(state, seat) {
      const legal = game.legalActions(state, seat);
      if (!legal || !legal.length) return null;
      const a = legal[0];
      if (a.type === 'bid') return { type: 'pass' };
      if (a.type === 'pickTrump') return { type: 'pickTrump', cardId: a.cardIds[0] };
      if (a.type === 'playCard') return { type: 'playCard', cardId: a.cardIds[0] };
      if (a.type === 'declareOpen') return { type: 'declareClosed' };
      return { type: a.type };
    },
  };
}

const PHASES = game.PHASES;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SERVER_STARTED_AT = Date.now();

// Stall-fallback grace window. After this many ms with the actor seat's
// socket still null, the AI takes the turn on the human's behalf.
const STALL_FALLBACK_MS = 25000;

// Idle-room GC. A room is dropped if it's been quiet for this long AND
// no humans are seated (or all humans are disconnected).
const IDLE_ROOM_TTL_MS = 30 * 60 * 1000;     // 30 min
const IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 min

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Static assets: client.js / cards.js / styles.css are cache-busted via
// ?v=<marker> query params in index.html, so we can serve them with long
// cache TTLs and still ship updates instantly. Express.static honors ETag
// so changed files still reach the browser, but iOS Safari sometimes ignores
// ETag — the query-param bust is the belt, this is the suspenders.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    }
  },
}));
// index.html MUST NOT be cached — it's the shell that references the
// versioned script URLs. Stale HTML means the old script URLs get re-used.
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/health', (_req, res) => res.status(200).type('text/plain').send('ok'));
const APP_VERSION = require('./package.json').version;
app.get('/version', (_req, res) => res.json({ version: APP_VERSION, startedAt: new Date(SERVER_STARTED_AT).toISOString() }));

// roomId -> { code, state, sockets: Map<seat, socketId|null>, aiQueue: [] }
const rooms = new Map();

function genRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function newRoomCode() {
  for (let tries = 0; tries < 50; tries++) {
    const c = genRoomCode();
    if (!rooms.has(c)) return c;
  }
  throw new Error('room code space exhausted');
}

function broadcastViews(room) {
  for (let seat = 0; seat < 4; seat++) {
    const sid = room.sockets.get(seat);
    if (!sid) continue;
    const view = game.viewFor(room.state, seat);
    io.to(sid).emit('view', { view });
  }
}

function hasAnyHuman(room) {
  return room.state.seats.some((s) => s && !s.isAI);
}

function isSeatAI(room, seat) {
  const s = room.state.seats[seat];
  return !!(s && s.isAI);
}

function firstAISeat(room) {
  for (let s = 0; s < 4; s++) if (isSeatAI(room, s)) return s;
  return null;
}

function hasConnectedSocket(room, seat) {
  return !!room.sockets.get(seat);
}

// Treat a humanless seat (human-occupied but socket disconnected) as an
// AI candidate after the stall window, so a closed-tab player doesn't
// freeze the table for everyone else.
function shouldAIDriveSeat(room, seat) {
  if (isSeatAI(room, seat)) return true;
  // Human seat with no live socket — let the stall fallback handle it.
  return !hasConnectedSocket(room, seat);
}

function touchRoom(room) {
  if (!room) return;
  room.lastTouched = Date.now();
}

function scheduleAITurn(room) {
  if (!room || !rooms.has(room.code)) return;
  const state = room.state;
  if (state.phase === PHASES.WAITING || state.phase === PHASES.GAME_OVER) return;

  const actor = game.whoseTurn(state);

  if (state.phase === PHASES.HAND_END) {
    // If no humans remain, auto-continue as AI promptly.
    // Otherwise, pick an AI seat to fire continue after a longer delay so
    // humans have a chance to acknowledge; any human `continue` is enough.
    const anyHuman = hasAnyHuman(room);
    const aiSeat = firstAISeat(room);
    if (aiSeat === null) return;
    // v2.2.12: with humans present, wait for the hand-won flash (6500 ms)
    // to run its full course plus ~1 s so the trick cards linger on the
    // table after the flash fades. AI-only tables still snap through fast.
    const delay = anyHuman ? 7200 + Math.random() * 400 : 400 + Math.random() * 400;
    const token = {};
    room.aiQueue.push(token);
    setTimeout(() => {
      const idx = room.aiQueue.indexOf(token);
      if (idx >= 0) room.aiQueue.splice(idx, 1);
      if (!rooms.has(room.code)) return;
      if (room.state !== state) return;
      if (state.phase !== PHASES.HAND_END) return;
      const res = game.applyAction(state, aiSeat, { type: 'continue' });
      if (res && res.ok) {
        broadcastViews(room);
        scheduleAITurn(room);
      }
    }, delay);
    return;
  }

  if (actor === null || actor === undefined) return;
  if (!shouldAIDriveSeat(room, actor)) return;

  // Three delay regimes (v2.2.12):
  //  • AI seat, INSPECT phase → 3200–3600 ms, so the trick-won flash
  //    (2400 ms) has time to play AND the trick cards linger for
  //    roughly a second after the flash fades, per user request.
  //  • AI seat, any other phase → snap thinking time (600–1200 ms).
  //  • Human seat with no socket (the "stall fallback") → 25 s grace
  //    period so a human reconnecting from a network blip doesn't get
  //    auto-played-over. If they're still gone after 25 s, AI takes the
  //    turn so the rest of the table isn't stuck.
  const isStallFallback = !isSeatAI(room, actor);
  let delay;
  if (isStallFallback) {
    delay = STALL_FALLBACK_MS;
  } else if (state.phase === PHASES.INSPECT) {
    delay = 3200 + Math.random() * 400;
  } else {
    delay = 600 + Math.random() * 600;
  }
  const token = {};
  room.aiQueue.push(token);
  setTimeout(() => {
    const idx = room.aiQueue.indexOf(token);
    if (idx >= 0) room.aiQueue.splice(idx, 1);
    if (!rooms.has(room.code)) return;
    if (room.state !== state) return;
    const stillActor = game.whoseTurn(state);
    if (stillActor !== actor) return;
    // Re-check at fire time: if a human reconnected, abort the
    // fallback; they get to play their own turn.
    if (!shouldAIDriveSeat(room, actor)) return;
    const action = ai.chooseAction(state, actor);
    if (action) {
      const res = game.applyAction(state, actor, action);
      if (!res || !res.ok) {
        // AI produced an illegal action; fall back to a safe default.
        const legal = game.legalActions(state, actor);
        if (legal && legal.length) {
          const a = legal[0];
          let fallback = null;
          if (a.type === 'bid') fallback = { type: 'pass' };
          else if (a.type === 'pickTrump') fallback = { type: 'pickTrump', cardId: a.cardIds[0] };
          else if (a.type === 'playCard') fallback = { type: 'playCard', cardId: a.cardIds[0] };
          else fallback = { type: a.type };
          game.applyAction(state, actor, fallback);
        }
      }
    }
    if (isStallFallback) {
      console.log(`[stall] room=${room.code} seat=${actor} AI auto-played for disconnected human`);
    }
    touchRoom(room);
    broadcastViews(room);
    scheduleAITurn(room);
  }, delay);
}

function sweepIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const idleMs = now - (room.lastTouched || 0);
    if (idleMs < IDLE_ROOM_TTL_MS) continue;
    const anyConnected = [0, 1, 2, 3].some((s) => hasConnectedSocket(room, s));
    if (anyConnected) continue;
    rooms.delete(code);
    console.log(`[gc] room ${code} dropped after ${Math.round(idleMs / 60000)} min idle`);
  }
}
setInterval(sweepIdleRooms, IDLE_SWEEP_INTERVAL_MS).unref();

function findRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(String(roomId).toUpperCase()) || null;
}

function seatOfSocket(room, socketId) {
  for (let s = 0; s < 4; s++) if (room.sockets.get(s) === socketId) return s;
  return -1;
}

function emitError(socket, reason) {
  socket.emit('actionError', { reason });
}

// Boundary input hardening (v2.2.0): sanitize* live in src/util/sanitize.js
// so they can be unit tested without booting Express.

io.on('connection', (socket) => {
  socket.data = socket.data || { roomId: null, seat: null, name: null };

  socket.on('createRoom', ({ name } = {}) => {
    const playerName = sanitizeName(name);
    const code = newRoomCode();
    const state = game.createGame(code);
    const room = { code, state, sockets: new Map([[0, null], [1, null], [2, null], [3, null]]), aiQueue: [], lastTouched: Date.now() };
    const seatRes = game.seatPlayer(state, { seat: 0, name: playerName, isAI: false });
    if (!seatRes.ok) return emitError(socket, seatRes.reason);
    rooms.set(code, room);
    room.sockets.set(0, socket.id);
    socket.data.roomId = code;
    socket.data.seat = 0;
    socket.data.name = playerName;
    socket.join(code);
    socket.emit('roomCreated', { roomId: code, seat: 0, view: game.viewFor(state, 0) });
  });

  socket.on('joinRoom', ({ roomId, name } = {}) => {
    const room = findRoom(roomId);
    if (!room) return emitError(socket, 'room not found');
    const playerName = sanitizeName(name);
    const order = [2, 1, 3];
    let targetSeat = -1;
    for (const s of order) {
      if (!room.state.seats[s]) { targetSeat = s; break; }
    }
    if (targetSeat < 0) return emitError(socket, 'room full');
    const seatRes = game.seatPlayer(room.state, { seat: targetSeat, name: playerName, isAI: false });
    if (!seatRes.ok) return emitError(socket, seatRes.reason);
    room.sockets.set(targetSeat, socket.id);
    socket.data.roomId = room.code;
    socket.data.seat = targetSeat;
    socket.data.name = playerName;
    socket.join(room.code);
    touchRoom(room);
    socket.emit('roomJoined', { seat: targetSeat, view: game.viewFor(room.state, targetSeat) });
    broadcastViews(room);
  });

  socket.on('resume', ({ roomId, name } = {}) => {
    const room = findRoom(roomId);
    if (!room) return emitError(socket, 'room not found');
    const playerName = sanitizeName(name);
    // Reclaim the first human seat matching this name, even if a stale
    // socket id is still registered (the old connection may not have fired
    // `disconnect` yet). This is the key to surviving a reconnect.
    let found = -1;
    for (let s = 0; s < 4; s++) {
      const info = room.state.seats[s];
      if (info && !info.isAI && info.name === playerName) { found = s; break; }
    }
    if (found < 0) return emitError(socket, 'no seat to resume');
    const priorSid = room.sockets.get(found);
    if (priorSid && priorSid !== socket.id) {
      const prior = io.sockets.sockets.get(priorSid);
      if (prior) { try { prior.leave(room.code); } catch (_) {} prior.data = prior.data || {}; prior.data.roomId = null; prior.data.seat = null; }
    }
    room.sockets.set(found, socket.id);
    socket.data.roomId = room.code;
    socket.data.seat = found;
    socket.data.name = playerName;
    socket.join(room.code);
    touchRoom(room);
    // A reconnect can also abort an in-flight stall fallback for THIS
    // seat: re-running scheduleAITurn will see the seat is now socketed
    // and skip the AI fire (the existing token-aborted-at-fire-time
    // check inside the timeout handles the race cleanly).
    socket.emit('roomJoined', { seat: found, view: game.viewFor(room.state, found) });
    broadcastViews(room);
  });

  socket.on('setSeat', ({ seat } = {}) => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    if (socket.data.seat !== 0) return emitError(socket, 'host only');
    if (room.state.phase !== PHASES.WAITING) return emitError(socket, 'game already started');
    const target = seat | 0;
    if (target < 0 || target > 3) return emitError(socket, 'invalid seat');
    if (target === 0) return emitError(socket, 'host already at seat 0');
    if (room.state.seats[target]) return emitError(socket, 'seat occupied');
    const hostInfo = room.state.seats[0];
    room.state.seats[0] = null;
    room.state.seats[target] = hostInfo;
    const hostSid = room.sockets.get(0);
    room.sockets.set(0, null);
    room.sockets.set(target, hostSid);
    socket.data.seat = target;
    touchRoom(room);
    broadcastViews(room);
  });

  socket.on('addAI', ({ seat } = {}) => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    if (socket.data.seat !== 0) return emitError(socket, 'host only');
    if (room.state.phase !== PHASES.WAITING) return emitError(socket, 'game already started');
    const target = seat | 0;
    if (target < 0 || target > 3) return emitError(socket, 'invalid seat');
    if (room.state.seats[target]) return emitError(socket, 'seat occupied');
    const res = game.seatPlayer(room.state, { seat: target, name: 'AI ' + target, isAI: true });
    if (!res.ok) return emitError(socket, res.reason);
    touchRoom(room);
    broadcastViews(room);
  });

  socket.on('removeAI', ({ seat } = {}) => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    if (socket.data.seat !== 0) return emitError(socket, 'host only');
    if (room.state.phase !== PHASES.WAITING) return emitError(socket, 'game already started');
    const target = seat | 0;
    if (target < 0 || target > 3) return emitError(socket, 'invalid seat');
    const info = room.state.seats[target];
    if (!info || !info.isAI) return emitError(socket, 'seat is not AI');
    game.removeSeat(room.state, target);
    touchRoom(room);
    broadcastViews(room);
  });

  socket.on('startGame', () => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    if (socket.data.seat !== 0) return emitError(socket, 'host only');
    if (room.state.phase !== PHASES.WAITING) return emitError(socket, 'game already started');
    for (let s = 0; s < 4; s++) {
      if (!room.state.seats[s]) {
        game.seatPlayer(room.state, { seat: s, name: 'AI ' + s, isAI: true });
      }
    }
    const res = game.startHand(room.state);
    if (!res.ok) return emitError(socket, res.reason);
    touchRoom(room);
    broadcastViews(room);
    scheduleAITurn(room);
  });

  socket.on('action', (rawAction = {}) => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    const seat = seatOfSocket(room, socket.id);
    if (seat < 0) return emitError(socket, 'not seated');
    const state = room.state;

    // Coerce / validate at the boundary. The engine assumes well-formed
    // shapes; an attacker (or buggy client) could otherwise crash the
    // server with a non-string cardId.
    const action = sanitizeAction(rawAction);
    if (!action) return emitError(socket, 'malformed action');

    // Validate it's this seat's turn, based on phase.
    const actor = game.whoseTurn(state);
    if (state.phase === PHASES.HAND_END) {
      // any seat (human) can fire continue
    } else if (actor === null || actor === undefined) {
      return emitError(socket, 'not your turn');
    } else if (actor !== seat) {
      return emitError(socket, 'not your turn');
    }

    const res = game.applyAction(state, seat, action);
    if (!res || !res.ok) return emitError(socket, (res && res.reason) || 'illegal action');
    touchRoom(room);
    broadcastViews(room);
    scheduleAITurn(room);
  });

  socket.on('disconnect', () => {
    const room = findRoom(socket.data.roomId);
    if (!room) return;
    const seat = seatOfSocket(room, socket.id);
    if (seat >= 0) {
      room.sockets.set(seat, null);
      // If this seat is the current actor and now has no live socket,
      // arm the stall fallback so the table doesn't freeze waiting on a
      // closed tab. scheduleAITurn handles the de-dup if the human
      // reconnects in time.
      scheduleAITurn(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`304 server listening on http://localhost:${PORT}`);
});
