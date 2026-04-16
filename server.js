// 304 - Express + Socket.IO server.
// See docs/API.md and docs/ARCHITECTURE.md. Server-authoritative game state.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const game = require('./src/engine/game');

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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (_req, res) => res.status(200).type('text/plain').send('ok'));

// roomId -> { code, state, sockets: Map<seat, socketId|null>, aiQueue: [], clientIds: Map<seat, clientId|null> }
const rooms = new Map();
// clientId -> { roomCode, seat }
const clients = new Map();

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

function whoseTurn(state) {
  switch (state.phase) {
    case PHASES.BID4: return state.currentBidder;
    case PHASES.BID8: return state.currentBidder;
    case PHASES.TRUMP_PICK1: return state.trumpMaker;
    case PHASES.TRUMP_PICK2: return state.trumpMaker;
    case PHASES.OPEN_CHOICE: return state.trumpMaker;
    case PHASES.PLAY: return state.currentPlayer;
    case PHASES.INSPECT: return state.currentPlayer;
    case PHASES.HAND_END: return null;
    default: return null;
  }
}

function broadcastViews(room) {
  // Track turn start (per phase + actor) so clients can render a timer.
  const state = room.state;
  const actor = whoseTurn(state);
  const turnKey = state.phase + ':' + (actor == null ? '-' : actor);
  if (room.lastTurnKey !== turnKey) {
    room.lastTurnKey = turnKey;
    room.turnStartedAt = Date.now();
  }
  for (let seat = 0; seat < 4; seat++) {
    const sid = room.sockets.get(seat);
    if (!sid) continue;
    const view = game.viewFor(room.state, seat);
    view.turnStartedAt = room.turnStartedAt || Date.now();
    view.serverNow = Date.now();
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

function scheduleAITurn(room) {
  if (!room || !rooms.has(room.code)) return;
  const state = room.state;
  if (state.phase === PHASES.WAITING || state.phase === PHASES.GAME_OVER) return;

  const actor = whoseTurn(state);

  if (state.phase === PHASES.HAND_END) {
    // If no humans remain, auto-continue as AI promptly.
    // Otherwise, pick an AI seat to fire continue after a longer delay so
    // humans have a chance to acknowledge; any human `continue` is enough.
    const anyHuman = hasAnyHuman(room);
    const aiSeat = firstAISeat(room);
    if (aiSeat === null) return;
    const delay = anyHuman ? 1500 + Math.random() * 500 : 400 + Math.random() * 400;
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
  if (!isSeatAI(room, actor)) return;

  const delay = 600 + Math.random() * 600;
  const token = {};
  room.aiQueue.push(token);
  setTimeout(() => {
    const idx = room.aiQueue.indexOf(token);
    if (idx >= 0) room.aiQueue.splice(idx, 1);
    if (!rooms.has(room.code)) return;
    if (room.state !== state) return;
    const stillActor = whoseTurn(state);
    if (stillActor !== actor) return;
    if (!isSeatAI(room, actor)) return;
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
    broadcastViews(room);
    scheduleAITurn(room);
  }, delay);
}

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

function attachClient(room, seat, clientId) {
  if (!clientId) return;
  room.clientIds.set(seat, clientId);
  clients.set(clientId, { roomCode: room.code, seat });
}

function autoReconnect(socket, clientId) {
  const bind = clients.get(clientId);
  if (!bind) return false;
  const room = rooms.get(bind.roomCode);
  if (!room) { clients.delete(clientId); return false; }
  const seat = bind.seat;
  const info = room.state.seats[seat];
  if (!info || info.isAI) return false;
  room.sockets.set(seat, socket.id);
  socket.data.roomId = room.code;
  socket.data.seat = seat;
  socket.data.name = info.name;
  socket.data.clientId = clientId;
  socket.join(room.code);
  socket.emit('roomJoined', { seat, view: game.viewFor(room.state, seat), resumed: true });
  broadcastViews(room);
  return true;
}

io.on('connection', (socket) => {
  socket.data = socket.data || { roomId: null, seat: null, name: null, clientId: null };
  const auth = socket.handshake && socket.handshake.auth;
  if (auth && auth.clientId) {
    socket.data.clientId = String(auth.clientId).slice(0, 64);
    autoReconnect(socket, socket.data.clientId);
  }

  socket.on('createRoom', ({ name, clientId } = {}) => {
    const playerName = (name && String(name).trim()) || 'Player';
    const code = newRoomCode();
    const state = game.createGame(code);
    const room = {
      code, state,
      sockets: new Map([[0, null], [1, null], [2, null], [3, null]]),
      clientIds: new Map([[0, null], [1, null], [2, null], [3, null]]),
      aiQueue: [],
    };
    const seatRes = game.seatPlayer(state, { seat: 0, name: playerName, isAI: false });
    if (!seatRes.ok) return emitError(socket, seatRes.reason);
    rooms.set(code, room);
    room.sockets.set(0, socket.id);
    const cid = (clientId && String(clientId).slice(0, 64)) || socket.data.clientId || null;
    attachClient(room, 0, cid);
    socket.data.roomId = code;
    socket.data.seat = 0;
    socket.data.name = playerName;
    socket.data.clientId = cid;
    socket.join(code);
    socket.emit('roomCreated', { roomId: code, seat: 0, view: game.viewFor(state, 0) });
  });

  socket.on('joinRoom', ({ roomId, name, clientId } = {}) => {
    const room = findRoom(roomId);
    if (!room) return emitError(socket, 'room not found');
    const cid = (clientId && String(clientId).slice(0, 64)) || socket.data.clientId || null;
    // If this clientId is already bound to a seat in this room, resume there.
    if (cid) {
      const bound = clients.get(cid);
      if (bound && bound.roomCode === room.code) {
        const seat = bound.seat;
        const info = room.state.seats[seat];
        if (info && !info.isAI) {
          room.sockets.set(seat, socket.id);
          socket.data.roomId = room.code;
          socket.data.seat = seat;
          socket.data.name = info.name;
          socket.data.clientId = cid;
          socket.join(room.code);
          socket.emit('roomJoined', { seat, view: game.viewFor(room.state, seat), resumed: true });
          broadcastViews(room);
          return;
        }
      }
    }
    const playerName = (name && String(name).trim()) || 'Player';
    const order = [2, 1, 3];
    let targetSeat = -1;
    for (const s of order) {
      if (!room.state.seats[s]) { targetSeat = s; break; }
    }
    if (targetSeat < 0) return emitError(socket, 'room full');
    const seatRes = game.seatPlayer(room.state, { seat: targetSeat, name: playerName, isAI: false });
    if (!seatRes.ok) return emitError(socket, seatRes.reason);
    room.sockets.set(targetSeat, socket.id);
    attachClient(room, targetSeat, cid);
    socket.data.roomId = room.code;
    socket.data.seat = targetSeat;
    socket.data.name = playerName;
    socket.data.clientId = cid;
    socket.join(room.code);
    socket.emit('roomJoined', { seat: targetSeat, view: game.viewFor(room.state, targetSeat) });
    broadcastViews(room);
  });

  socket.on('resume', ({ roomId, name } = {}) => {
    const room = findRoom(roomId);
    if (!room) return emitError(socket, 'room not found');
    const playerName = (name && String(name).trim()) || '';
    let found = -1;
    for (let s = 0; s < 4; s++) {
      const info = room.state.seats[s];
      if (info && !info.isAI && info.name === playerName && !room.sockets.get(s)) { found = s; break; }
    }
    if (found < 0) return emitError(socket, 'no seat to resume');
    room.sockets.set(found, socket.id);
    socket.data.roomId = room.code;
    socket.data.seat = found;
    socket.data.name = playerName;
    socket.join(room.code);
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
    broadcastViews(room);
    scheduleAITurn(room);
  });

  socket.on('action', (action = {}) => {
    const room = findRoom(socket.data.roomId);
    if (!room) return emitError(socket, 'no room');
    const seat = seatOfSocket(room, socket.id);
    if (seat < 0) return emitError(socket, 'not seated');
    const state = room.state;

    // Validate it's this seat's turn, based on phase.
    const actor = whoseTurn(state);
    if (state.phase === PHASES.HAND_END) {
      // any seat (human) can fire continue
    } else if (actor === null || actor === undefined) {
      return emitError(socket, 'not your turn');
    } else if (actor !== seat) {
      return emitError(socket, 'not your turn');
    }

    const res = game.applyAction(state, seat, action);
    if (!res || !res.ok) return emitError(socket, (res && res.reason) || 'illegal action');
    broadcastViews(room);
    scheduleAITurn(room);
  });

  socket.on('disconnect', () => {
    const room = findRoom(socket.data.roomId);
    if (!room) return;
    const seat = seatOfSocket(room, socket.id);
    if (seat >= 0) {
      room.sockets.set(seat, null);
      // Leave clientId binding intact so they can resume seamlessly.
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`304 server listening on http://localhost:${PORT}`);
});
