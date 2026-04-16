// Integration test for a Socket.IO server on an ephemeral port.
// socket.io-client is installed for tests. If unavailable, skip gracefully.

const { ok, assert } = require('./helpers');

let ioClient;
try {
  ioClient = require('socket.io-client');
} catch (e) {
  process.stdout.write(
    '  server.test.js skipped: socket.io-client not installed. Run `npm install --no-save socket.io-client`\n'
  );
  module.exports = { run: async () => {} };
  return;
}

const http = require('node:http');
const express = require('express');
const { Server: IOServer } = require('socket.io');
const game = require('../src/engine/game');

// Minimal in-test server that mirrors the subset of server.js behavior we
// want to exercise. Keeping this inline avoids import-time PORT binding.
function bootServer() {
  const app = express();
  const srv = http.createServer(app);
  const io = new IOServer(srv);
  const rooms = new Map();
  const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function genCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE[Math.floor(Math.random() * CODE.length)];
    return s;
  }
  function broadcast(room) {
    for (let seat = 0; seat < 4; seat++) {
      const sid = room.sockets.get(seat);
      if (!sid) continue;
      io.to(sid).emit('view', { view: game.viewFor(room.state, seat) });
    }
  }

  io.on('connection', (socket) => {
    socket.data = { roomId: null, seat: null, name: null };

    socket.on('createRoom', ({ name } = {}) => {
      const code = genCode();
      const state = game.createGame(code);
      const room = { code, state, sockets: new Map([[0, null], [1, null], [2, null], [3, null]]) };
      game.seatPlayer(state, { seat: 0, name: name || 'Host', isAI: false });
      rooms.set(code, room);
      room.sockets.set(0, socket.id);
      socket.data = { roomId: code, seat: 0, name: name || 'Host' };
      socket.emit('roomCreated', { roomId: code, seat: 0, view: game.viewFor(state, 0) });
    });

    socket.on('joinRoom', ({ roomId, name } = {}) => {
      const room = rooms.get(String(roomId).toUpperCase());
      if (!room) return socket.emit('actionError', { reason: 'room not found' });
      // Resume by name first.
      for (let s = 0; s < 4; s++) {
        const info = room.state.seats[s];
        if (info && !info.isAI && info.name === name && !room.sockets.get(s)) {
          room.sockets.set(s, socket.id);
          socket.data = { roomId: room.code, seat: s, name };
          socket.emit('roomJoined', { seat: s, view: game.viewFor(room.state, s) });
          return;
        }
      }
      // Else place in 2, 1, 3 order.
      for (const s of [2, 1, 3]) {
        if (!room.state.seats[s]) {
          game.seatPlayer(room.state, { seat: s, name: name || 'P', isAI: false });
          room.sockets.set(s, socket.id);
          socket.data = { roomId: room.code, seat: s, name: name || 'P' };
          socket.emit('roomJoined', { seat: s, view: game.viewFor(room.state, s) });
          broadcast(room);
          return;
        }
      }
      socket.emit('actionError', { reason: 'room full' });
    });

    socket.on('startGame', () => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      if (socket.data.seat !== 0) return socket.emit('actionError', { reason: 'host only' });
      for (let s = 0; s < 4; s++) {
        if (!room.state.seats[s]) game.seatPlayer(room.state, { seat: s, name: 'AI ' + s, isAI: true });
      }
      game.startHand(room.state);
      broadcast(room);
    });

    socket.on('action', (action = {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      const seat = socket.data.seat;
      const state = room.state;
      let actor = null;
      switch (state.phase) {
        case game.PHASES.BID4:
        case game.PHASES.BID8: actor = state.currentBidder; break;
        case game.PHASES.PLAY:
        case game.PHASES.INSPECT: actor = state.currentPlayer; break;
        case game.PHASES.TRUMP_PICK1:
        case game.PHASES.TRUMP_PICK2:
        case game.PHASES.OPEN_CHOICE: actor = state.trumpMaker; break;
        default: actor = null;
      }
      if (actor !== null && actor !== seat) {
        return socket.emit('actionError', { reason: 'not your turn' });
      }
      const res = game.applyAction(state, seat, action);
      if (!res || !res.ok) return socket.emit('actionError', { reason: (res && res.reason) || 'illegal' });
      broadcast(room);
    });

    socket.on('disconnect', () => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      for (let s = 0; s < 4; s++) {
        if (room.sockets.get(s) === socket.id) room.sockets.set(s, null);
      }
    });
  });

  return new Promise((resolve) => {
    srv.listen(0, () => {
      const port = srv.address().port;
      resolve({
        srv, io, port,
        close: () => new Promise((r) => { io.close(); srv.close(() => r()); }),
      });
    });
  });
}

function waitEvent(sock, name, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), timeoutMs);
    sock.once(name, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

// Wait for a view whose payload matches predicate. Drains intermediate views.
function waitView(sock, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      sock.off('view', handler);
      reject(new Error('timeout waiting for matching view'));
    }, timeoutMs);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(t);
        sock.off('view', handler);
        resolve(payload);
      }
    };
    sock.on('view', handler);
  });
}

async function runScenario() {
  const boot = await bootServer();
  const url = `http://127.0.0.1:${boot.port}`;
  const mkClient = () => ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });

  let host, guest;
  try {
    host = mkClient();
    await waitEvent(host, 'connect');
    host.emit('createRoom', { name: 'Alice' });
    const created = await waitEvent(host, 'roomCreated');
    ok('createRoom returns 6-char code and seat 0', () => {
      assert.equal(typeof created.roomId, 'string');
      assert.equal(created.roomId.length, 6);
      assert.equal(created.seat, 0);
    });

    guest = mkClient();
    await waitEvent(guest, 'connect');
    guest.emit('joinRoom', { roomId: created.roomId, name: 'Bob' });
    const joined = await waitEvent(guest, 'roomJoined');
    ok('joinRoom places second socket at seat 2', () => {
      assert.equal(joined.seat, 2);
    });

    const hostView = waitView(host, (p) => p.view && p.view.phase === 'bid4');
    const guestView = waitView(guest, (p) => p.view && p.view.phase === 'bid4');
    host.emit('startGame');
    const [hv, gv] = await Promise.all([hostView, guestView]);
    ok('startGame triggers bid4 phase for both clients', () => {
      assert.equal(hv.view.phase, 'bid4');
      assert.equal(gv.view.phase, 'bid4');
    });

    const errP = waitEvent(host, 'actionError').catch(() => null);
    host.emit('action', { type: 'pass' });
    const err = await errP;
    ok('actions on wrong seat return actionError', () => {
      assert.ok(err && typeof err.reason === 'string', 'got actionError');
    });

    const roomId = created.roomId;
    guest.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    const guest2 = mkClient();
    await waitEvent(guest2, 'connect');
    guest2.emit('joinRoom', { roomId, name: 'Bob' });
    const rejoin = await waitEvent(guest2, 'roomJoined');
    ok('disconnect + reconnect with same name resumes seat', () => {
      assert.equal(rejoin.seat, 2);
    });
    guest2.disconnect();
  } finally {
    if (host) try { host.disconnect(); } catch (e) { /* ignore */ }
    if (guest) try { guest.disconnect(); } catch (e) { /* ignore */ }
    await boot.close();
  }
}

module.exports = { run: runScenario };
