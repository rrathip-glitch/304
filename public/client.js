// public/client.js — Socket.IO client for 304.
// Talks to server via the protocol in docs/API.md. No framework.

(function () {
  'use strict';

  const socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 400 });

  // ---- UI state -------------------------------------------------------------
  const state = {
    screen: 'landing',     // 'landing' | 'lobby' | 'table'
    name: '',
    roomId: null,
    yourSeat: null,
    view: null,            // last PlayerView from server
    startPending: false,   // Start Game button debounce
  };

  // ---- Build stamp & debug overlay -----------------------------------------
  // Standard semver. Bumped on every shipped build so the in-app diagnostics
  // overlay (and /version endpoint) clearly identifies which client is live.
  const BUILD = '2.2.17';
  console.log('[304] client build =', BUILD);
  const dbgEvents = [];
  function dbg(msg) {
    const t = new Date().toISOString().slice(11, 23);
    dbgEvents.push(t + ' ' + msg);
    if (dbgEvents.length > 30) dbgEvents.shift();
    renderDebug();
  }
  function renderDebug() {
    const ov = document.getElementById('debug-overlay');
    if (!ov) return;
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('dbg-build', BUILD);
    setText('dbg-sock', socket && socket.connected ? 'connected (' + (socket.id || '?') + ')' : 'disconnected');
    setText('dbg-gate', emitReady ? 'OPEN' : 'CLOSED');
    setText('dbg-pending', String(pendingEmits.length));
    const sess = loadSession();
    setText('dbg-session', sess ? (sess.roomId + ' / ' + sess.name) : 'none');
    const list = document.getElementById('dbg-events');
    if (list) {
      list.innerHTML = '';
      for (let i = dbgEvents.length - 1; i >= 0; i--) {
        const li = document.createElement('li');
        li.textContent = dbgEvents[i];
        list.appendChild(li);
      }
    }
  }
  // Toggle overlay by tapping the build marker on the landing screen.
  setTimeout(() => {
    const marker = document.getElementById('build-marker');
    const overlay = document.getElementById('debug-overlay');
    if (marker && overlay) {
      marker.classList.add('tappable');
      marker.addEventListener('click', () => {
        overlay.classList.toggle('hidden');
        overlay.classList.toggle('visible');
        renderDebug();
      });
    }
  }, 0);

  // ---- Emit gate ------------------------------------------------------------
  // Prevents the "Start Game loops to landing" class of bugs. When the socket
  // briefly disconnects (Railway proxy / mobile backgrounding) and the user
  // taps a button during the gap, Socket.IO's default behavior is to buffer
  // the event and flush it on reconnect BEFORE our `connect` handler emits
  // `resume`. The server receives the action on a fresh socket with no seat
  // context and returns "no room", which surfaces to the user as a dead UI.
  //
  // The gate holds all application emits until we know the server has bound
  // our socket to a seat (roomCreated / roomJoined). On disconnect we close
  // the gate so fresh user taps queue locally instead of going into
  // Socket.IO's buffer. `resume` itself bypasses the gate — it's the only
  // thing allowed to talk to a naked socket.
  let emitReady = true;
  const pendingEmits = [];
  function openGate() {
    emitReady = true;
    const flushed = pendingEmits.length;
    while (pendingEmits.length) {
      const [name, payload] = pendingEmits.shift();
      socket.emit(name, payload);
    }
    if (flushed) dbg('gate open, flushed ' + flushed);
    else dbg('gate open');
    renderDebug();
  }
  function closeGate() { emitReady = false; dbg('gate close'); renderDebug(); }
  function gatedEmit(name, payload) {
    if (emitReady && socket.connected) {
      dbg('emit ' + name);
      socket.emit(name, payload);
      renderDebug();
      return;
    }
    // Dedup: if the user mashes a button, don't stack identical emits.
    const last = pendingEmits[pendingEmits.length - 1];
    if (last && last[0] === name && JSON.stringify(last[1]) === JSON.stringify(payload)) {
      dbg('dedup ' + name);
      renderDebug();
      return;
    }
    pendingEmits.push([name, payload]);
    dbg('queue ' + name + ' (' + pendingEmits.length + ')');
    renderDebug();
  }

  // ---- Session persistence (survives reloads & socket reconnects) ----------
  const SESSION_KEY = 'p304.session';
  function saveSession() {
    try {
      if (state.roomId && state.name) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          roomId: state.roomId, name: state.name, seat: state.yourSeat,
        }));
      }
    } catch (e) { /* private mode, ignore */ }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  const SEAT_LABELS = ['North', 'East', 'South', 'West']; // fallback labels
  const PHASE_LABELS = {
    waiting: 'Waiting',
    bid4: '4-card bidding',
    trump_pick1: 'Pick trump indicator',
    bid8: '8-card bidding',
    trump_pick2: 'Pick trump indicator',
    open_choice: 'Open or closed?',
    play: 'Playing tricks',
    inspect: 'Inspecting trick',
    hand_end: 'Hand complete',
    game_over: 'Game over',
  };

  // ---- Flash overlay (v2.2.8+) ---------------------------------------------
  // Shows a brief centered banner when a meaningful table event lands in
  // the next view. Four kinds, detected by comparing the incoming view
  // against the tracked baselines below:
  //   • trump reveal → 2 000 ms, big suit glyph + "Trump is <name>"
  //   • trick won    → 1 300 ms, "Won by us" / "Won by them"
  //   • hand won     → 3 200 ms, "Hand won" / "Hand lost" + "+N tokens"
  //                    (v2.2.10; detects tokens change between views)
  //   • match won    → 4 000 ms, "Match won" / "Match lost" on a team
  //                    reaching 22. Takes priority over the hand flash.
  let prevTrumpOpen = null;      // null = baseline not yet set
  let prevTricksPlayed = null;
  let prevTokens = null;         // [t0, t1] | null
  let prevPhase = null;
  let flashTimer = null;
  // v2.2.14: flashes run SEQUENTIALLY via a queue. Previously, if two
  // events landed in the same view update (most commonly an auto-open
  // trump reveal on the same trick that early-finalised the hand), the
  // second flash cancelled the first — the user never saw the trump
  // reveal. Now we enqueue and play back-to-back with a short gap, so
  // the order of narration matches the order of events (trump first,
  // hand won second).
  const flashQueue = [];
  let flashActive = false;
  const SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  const SUIT_FULL = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

  function showFlash(opts) {
    // Dedup a flash that's already queued with the same kind+us signature.
    // Guards against redundant enqueues if a view is replayed.
    const key = (opts.kind || '') + ':' + (opts.us ? 'us' : 'them');
    if (flashQueue.some((q) => q._key === key)) return;
    opts._key = key;
    flashQueue.push(opts);
    if (!flashActive) runNextFlash();
  }

  function runNextFlash() {
    if (flashQueue.length === 0) {
      flashActive = false;
      return;
    }
    flashActive = true;
    renderFlash(flashQueue.shift());
  }

  function renderFlash(opts) {
    const el = document.getElementById('flash-overlay');
    if (!el) { runNextFlash(); return; }
    // Reset any in-flight flash cleanly before starting the next.
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    el.className = 'flash-overlay hidden';
    el.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'flash-card';
    if (opts.kind === 'trump') {
      el.classList.add('trump');
      const suit = document.createElement('span');
      const isRed = opts.suit === 'H' || opts.suit === 'D';
      suit.className = 'flash-suit color-' + (isRed ? 'red' : 'black');
      suit.textContent = SUIT_GLYPH[opts.suit] || '?';
      card.appendChild(suit);
      const text = document.createElement('span');
      text.className = 'flash-text';
      text.textContent = 'Trump is ' + (SUIT_FULL[opts.suit] || opts.suit);
      card.appendChild(text);
    } else if (opts.kind === 'trick') {
      el.classList.add(opts.us ? 'trick-us' : 'trick-them');
      const heading = document.createElement('span');
      heading.className = 'flash-heading';
      heading.textContent = 'Trick';
      card.appendChild(heading);
      const text = document.createElement('span');
      text.className = 'flash-text';
      text.textContent = opts.us ? 'Won by us' : 'Won by them';
      card.appendChild(text);
    } else if (opts.kind === 'hand') {
      // Large hand-won banner with the token swing in big type, plus
      // context rows: caller + bid + per-team displayed points.
      el.classList.add(opts.us ? 'hand-us' : 'hand-them');
      const heading = document.createElement('span');
      heading.className = 'flash-heading';
      heading.textContent = opts.us ? 'Hand won' : 'Hand lost';
      card.appendChild(heading);
      const tokens = document.createElement('span');
      tokens.className = 'flash-tokens';
      const sign = opts.us ? '+' : '−';
      tokens.textContent = sign + opts.tokens + ' token' + (opts.tokens === 1 ? '' : 's');
      card.appendChild(tokens);
      if (opts.caller) {
        const call = document.createElement('span');
        call.className = 'flash-detail';
        call.textContent = opts.caller + ' called ' + opts.bidDisplay;
        card.appendChild(call);
      }
      if (opts.usPts != null && opts.themPts != null) {
        const pts = document.createElement('span');
        pts.className = 'flash-detail flash-detail-pts';
        pts.textContent = 'US ' + opts.usPts + ' · THEM ' + opts.themPts;
        card.appendChild(pts);
      }
    } else if (opts.kind === 'bid') {
      // Betting-settled flash — fires when bid4 auto-resolves to a
      // winning bid (either everyone else passed, or partner-lockout
      // short-circuit). Shows caller + bid.
      el.classList.add(opts.us ? 'bid-us' : 'bid-them');
      const heading = document.createElement('span');
      heading.className = 'flash-heading';
      heading.textContent = 'Bid won';
      card.appendChild(heading);
      const text = document.createElement('span');
      text.className = 'flash-text';
      text.textContent = opts.caller + ' · ' + opts.bidDisplay;
      card.appendChild(text);
      const hint = document.createElement('span');
      hint.className = 'flash-detail';
      hint.textContent = opts.us ? 'your team calls trump' : 'they call trump';
      card.appendChild(hint);
    } else if (opts.kind === 'match') {
      el.classList.add(opts.us ? 'match-us' : 'match-them');
      const heading = document.createElement('span');
      heading.className = 'flash-heading';
      heading.textContent = 'Match';
      card.appendChild(heading);
      const text = document.createElement('span');
      text.className = 'flash-text';
      text.textContent = opts.us ? 'Won by us' : 'Won by them';
      card.appendChild(text);
    }
    el.appendChild(card);
    el.classList.remove('hidden');
    // requestAnimationFrame ensures the transition from .hidden → .visible
    // actually animates instead of being collapsed by the browser.
    requestAnimationFrame(() => el.classList.add('visible'));

    // v2.2.11: flashes linger longer so table talk catches up with the UI.
    // Roughly 1.6–1.8× the prior durations across the board.
    const duration =
      opts.kind === 'match' ? 7500 :
      opts.kind === 'hand'  ? 6500 :
      opts.kind === 'bid'   ? 4000 :
      opts.kind === 'trump' ? 3500 :
                              2400;
    flashTimer = setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => {
        el.classList.add('hidden');
        el.className = 'flash-overlay hidden';
        el.innerHTML = '';
        // v2.2.14: kick the next queued flash (short breathing gap of
        // ~260 ms between flashes so the user sees the overlay drop
        // before the next one rises).
        setTimeout(runNextFlash, 260);
      }, 280);
    }, duration);
  }

  function maybeFlashEvents(v) {
    if (!v) return;
    const yourTeam = state.yourSeat != null ? state.yourSeat % 2 : null;

    // --- Bid settled (earliest possible point) -----------------------------
    // Fires on phase transition bid4/bid8 → trump_pick1. Detects the
    // moment the engine resolves the 4-card round, whether via three
    // passes, partner auto-pass, or the partner-lockout short-circuit.
    if (prevPhase !== 'trump_pick1' && v.phase === 'trump_pick1' &&
        v.highBid && v.seats && yourTeam != null) {
      const bidderSeat = v.highBid.bidder;
      const caller = (v.seats[bidderSeat] && v.seats[bidderSeat].name) || ('Seat ' + bidderSeat);
      const bidderTeam = bidderSeat % 2;
      showFlash({
        kind: 'bid',
        us: bidderTeam === yourTeam,
        caller: caller,
        bidDisplay: displayBid(v.highBid.amount),
      });
    }

    // --- Trump reveal ------------------------------------------------------
    const trumpOpen = !!(v.isOpenTrump || v.trumpRevealed);
    if (prevTrumpOpen === null) prevTrumpOpen = trumpOpen;
    else if (trumpOpen && !prevTrumpOpen && v.trumpSuit) {
      showFlash({ kind: 'trump', suit: v.trumpSuit });
    }
    const trumpJustOpened = (trumpOpen && !prevTrumpOpen);
    prevTrumpOpen = trumpOpen;

    // --- Hand-won / Match-won ---------------------------------------------
    // Detected via tokens delta. Priority: match > hand > trick.
    const tokens = Array.isArray(v.tokens) ? v.tokens.slice() : null;
    let handFlashed = false;
    if (tokens && prevTokens !== null && yourTeam != null) {
      const d0 = tokens[0] - prevTokens[0];
      const d1 = tokens[1] - prevTokens[1];
      if (d0 !== 0 || d1 !== 0) {
        const winnerTeam = d0 > 0 ? 0 : 1;
        const delta = Math.abs(d0);
        const us = winnerTeam === yourTeam;
        if (v.phase === 'game_over' || tokens[winnerTeam] >= 22) {
          showFlash({ kind: 'match', us: us });
        } else {
          // Compute per-team display points from the view's trickPoints.
          // v.trickPoints is [team0, team1] in internal units (×10).
          let usPts = null, themPts = null;
          if (Array.isArray(v.trickPoints) && v.trickPoints.length === 2) {
            const yP = v.trickPoints[yourTeam] || 0;
            const tP = v.trickPoints[1 - yourTeam] || 0;
            usPts = displayPoints(yP);
            themPts = displayPoints(tP);
          }
          const caller = (v.highBid && v.seats && v.seats[v.highBid.bidder])
            ? v.seats[v.highBid.bidder].name : null;
          const bidDisplay = v.highBid ? displayBid(v.highBid.amount) : null;
          showFlash({
            kind: 'hand',
            us: us,
            tokens: delta,
            caller: caller,
            bidDisplay: bidDisplay,
            usPts: usPts,
            themPts: themPts,
          });
        }
        handFlashed = true;
      }
    }
    if (tokens) prevTokens = tokens;

    // --- Trick won --------------------------------------------------------
    const tp = v.tricksPlayed || 0;
    if (prevTricksPlayed === null) prevTricksPlayed = tp;
    else if (tp > prevTricksPlayed && v.trickLeader != null && yourTeam != null && !handFlashed) {
      const winnerTeam = v.trickLeader % 2;
      if (!(trumpJustOpened && v.cutResolved)) {
        showFlash({ kind: 'trick', us: winnerTeam === yourTeam });
      }
    }
    prevTricksPlayed = tp;
    prevPhase = v.phase || null;
  }

  // Reset the flash baselines when a new hand starts so we re-flash the
  // next hand's trump reveal and trick wins. Called from renderTable.
  // Tokens baseline is NOT reset here — it carries across hands so the
  // next token change fires a hand-won flash as expected.
  function resetFlashBaselinesIfHandChanged(v) {
    if (!v) return;
    const handKey = (v.handNumber || 0) + ':' + (v.phase === 'hand_end' ? 'end' : 'live');
    if (resetFlashBaselinesIfHandChanged._lastHandKey !== handKey &&
        (v.phase === 'bid4' || v.phase === 'waiting')) {
      // Entered a fresh hand's bidding — re-baseline so next reveal fires.
      prevTrumpOpen = false;
      prevTricksPlayed = 0;
    }
    resetFlashBaselinesIfHandChanged._lastHandKey = handKey;
  }

  // ---- DOM lookups ----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const screens = {
    landing: $('#landing'),
    lobby: $('#lobby'),
    table: $('#table'),
  };
  const toastEl = $('#toast');
  let toastTimer = null;

  function setScreen(name) {
    state.screen = name;
    for (const [k, el] of Object.entries(screens)) {
      el.classList.toggle('active', k === name);
    }
    app.className = 'screen-' + name;
  }
  // If we have a saved session, stay on landing only until the resume
  // handshake comes back. Otherwise landing is the default.
  setScreen('landing');
  {
    const sess = loadSession();
    if (sess && sess.roomId && sess.name) {
      // Show a brief "reconnecting" hint so the user knows their seat is
      // being restored (prevents the perceived "looping back to start").
      setTimeout(() => {
        if (state.screen === 'landing' && !state.view) toast('Reconnecting to your game…', false);
      }, 300);
    }
  }

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.style.background = isError === false ? '#2f7d4b' : 'var(--danger)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // Persistent banner for disconnected state. Different from toast: stays
  // visible until resolved, so the user understands why taps aren't firing.
  function setConnBanner(disconnected) {
    let el = document.getElementById('conn-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'conn-banner';
      el.className = 'conn-banner';
      el.textContent = 'Reconnecting…';
      document.body.appendChild(el);
    }
    el.classList.toggle('visible', !!disconnected);
  }

  // ---- Landing handlers -----------------------------------------------------
  const nameInput = $('#name-input');
  const codeInput = $('#code-input');
  // Pre-populate name if previously used
  try {
    const saved = localStorage.getItem('p304.name');
    if (saved) nameInput.value = saved;
  } catch (e) { /* ignore */ }

  $('#create-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Enter your name first'); return; }
    state.name = name;
    try { localStorage.setItem('p304.name', name); } catch (e) {}
    gatedEmit('createRoom', { name });
  });

  $('#join-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    const roomId = codeInput.value.toUpperCase().trim();
    if (!name) { toast('Enter your name first'); return; }
    if (!roomId) { toast('Enter a room code'); return; }
    state.name = name;
    try { localStorage.setItem('p304.name', name); } catch (e) {}
    gatedEmit('joinRoom', { roomId, name });
  });

  // ---- Socket listeners -----------------------------------------------------
  // On every connect (initial OR reconnect): if we have a saved session,
  // ask the server to re-bind this socket to our seat. This is what keeps
  // Railway proxy reconnects from kicking us back to the landing screen.
  socket.on('connect', () => {
    dbg('connect sid=' + (socket.id || '?'));
    setConnBanner(false);
    const sess = loadSession();
    if (sess && sess.roomId && sess.name) {
      // Close the gate until the server confirms our seat via roomJoined.
      // Any user tap that arrives in this window queues locally and flushes
      // after resume — it never hits a naked socket.
      closeGate();
      state.roomId = sess.roomId;
      state.name = sess.name;
      if (typeof sess.seat === 'number') state.yourSeat = sess.seat;
      dbg('emit resume');
      socket.emit('resume', { roomId: sess.roomId, name: sess.name });
    } else {
      // Fresh connection with no session — open the gate so createRoom /
      // joinRoom can flow.
      openGate();
    }
    renderDebug();
  });

  socket.on('disconnect', (reason) => {
    dbg('disconnect ' + (reason || ''));
    // Close the gate immediately so nothing the user taps during the blip
    // ends up in Socket.IO's buffer (where it would race past resume on
    // reconnect). Show a small persistent banner instead of a fleeting toast
    // so the user knows we're working on it.
    closeGate();
    setConnBanner(true);
    renderDebug();
  });
  socket.io.on('reconnect_attempt', () => { /* silent */ });
  socket.on('connect_error', (err) => { console.warn('connect_error', err && err.message); });

  socket.on('roomCreated', (payload) => {
    dbg('roomCreated ' + payload.roomId);
    state.roomId = payload.roomId;
    state.yourSeat = payload.seat;
    state.view = payload.view || null;
    saveSession();
    openGate();
    setScreen('lobby');
    renderLobby();
  });

  socket.on('roomJoined', (payload) => {
    dbg('roomJoined seat=' + payload.seat + ' phase=' + (payload.view && payload.view.phase));
    state.yourSeat = payload.seat;
    state.view = payload.view || null;
    if (state.view && state.view.roomId) state.roomId = state.view.roomId;
    saveSession();
    // Server has confirmed our seat — open the gate and flush any user
    // actions that queued during a reconnect.
    openGate();
    if (state.view && state.view.phase && state.view.phase !== 'waiting') {
      setScreen('table');
      safeRender(renderTable);
    } else {
      setScreen('lobby');
      safeRender(renderLobby);
    }
  });

  socket.on('view', (payload) => {
    const view = payload && payload.view ? payload.view : payload;
    dbg('view phase=' + (view && view.phase));
    // Reset the trump/trick-flash baselines if a new hand has started
    // (so we flash again next hand), then detect event transitions
    // against the incoming view. Both must happen BEFORE state.view is
    // swapped so the baseline comparisons are meaningful.
    resetFlashBaselinesIfHandChanged(view);
    if (view && typeof view.yourSeat === 'number') state.yourSeat = view.yourSeat;
    maybeFlashEvents(view);
    state.view = view;
    if (view && view.roomId) state.roomId = view.roomId;
    saveSession();
    // A view always clears any pending Start Game spinner.
    if (state.startPending) resetStartButton();
    if (view && view.phase === 'waiting') {
      setScreen('lobby');
      safeRender(renderLobby);
    } else {
      setScreen('table');
      safeRender(renderTable);
    }
  });

  socket.on('actionError', (p) => {
    const reason = (p && p.reason) || 'Illegal action';
    dbg('actionError ' + reason);
    // If our session is stale (server restarted, room GC'd), clear it and
    // return to landing — but only for session-invalidating reasons, not
    // for ordinary in-game illegal moves.
    if (reason === 'room not found' || reason === 'no seat to resume') {
      clearSession();
      state.roomId = null;
      state.yourSeat = null;
      state.view = null;
      // Resume failed — open the gate so the user can Create/Join fresh.
      openGate();
      setScreen('landing');
      toast('Session expired — create a new room');
      return;
    }
    // "no room" on a connected socket means server lost our binding. This
    // is exactly the race the emit gate is supposed to prevent; if we see
    // it anyway (stale buffered event), trigger a resume rather than
    // bubbling the error to the user.
    if (reason === 'no room' && loadSession()) {
      closeGate();
      const sess = loadSession();
      socket.emit('resume', { roomId: sess.roomId, name: sess.name });
      return;
    }
    if (state.startPending) resetStartButton();
    toast(reason);
  });

  function safeRender(fn) {
    try { fn(); } catch (e) {
      console.error('render error', e);
      toast('Render hiccup — retrying');
    }
  }

  function resetStartButton() {
    state.startPending = false;
    const btn = document.getElementById('start-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Start game'; }
  }

  // ---- Lobby rendering ------------------------------------------------------
  $('#leave-btn').addEventListener('click', () => {
    clearSession();
    window.location.reload();
  });

  $('#start-btn').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.startPending) return;
    state.startPending = true;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Starting...';
    gatedEmit('startGame');
    // Failsafe: if no view/error arrives within 6s, re-enable the button.
    setTimeout(() => { if (state.startPending) resetStartButton(); }, 6000);
  });

  function renderLobby() {
    const code = state.roomId || '------';
    $('#lobby-code').textContent = code;

    const v = state.view || {};
    const seats = v.seats || [null, null, null, null];
    const youSeat = state.yourSeat;
    const youAreHost = youSeat === 0;

    const list = $('#lobby-seats');
    list.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'seat-row';

      const label = document.createElement('div');
      label.className = 'seat-label';
      label.textContent = SEAT_LABELS[i] + (i === 0 ? ' (host)' : '');
      row.appendChild(label);

      const occ = document.createElement('div');
      occ.className = 'seat-occupant';
      const s = seats[i];
      if (s && s.name) {
        occ.textContent = s.name + (s.isAI ? ' (AI)' : '') + (i === youSeat ? '  — you' : '');
      } else {
        occ.classList.add('empty');
        occ.textContent = 'empty';
      }
      row.appendChild(occ);

      if (youAreHost && i !== 0) {
        const btn = document.createElement('button');
        btn.className = 'btn seat-ai-toggle';
        if (s && s.isAI) {
          btn.textContent = 'Remove AI';
          btn.addEventListener('click', () => gatedEmit('removeAI', { seat: i }));
        } else if (!s) {
          btn.textContent = 'Add AI';
          btn.addEventListener('click', () => gatedEmit('addAI', { seat: i }));
        } else {
          btn.textContent = '';
          btn.style.visibility = 'hidden';
        }
        row.appendChild(btn);
      }

      list.appendChild(row);
    }

    const startBtn = $('#start-btn');
    startBtn.classList.toggle('hidden', !youAreHost);
  }

  // ---- Table rendering ------------------------------------------------------

  // Visual slot mapping: your seat → 'bottom'. next(p)=(p+3)%4 (counter-clockwise).
  // So if yourSeat=s, then:
  //   s        -> bottom
  //   (s+3)%4  -> right   (your right-hand opp, next in turn order)
  //   (s+2)%4  -> top     (partner)
  //   (s+1)%4  -> left    (your left-hand opp)
  function slotOfSeat(seat) {
    if (state.yourSeat == null) return null;
    const diff = (seat - state.yourSeat + 4) % 4;
    return ['bottom', 'left', 'top', 'right'][diff];
  }

  function renderTable() {
    const v = state.view;
    if (!v) return;

    // Header
    $('#table-code').textContent = state.roomId || '';
    $('#hand-num').textContent = 'Hand ' + (v.handNumber || 1);
    renderTokens(v.tokens || [11, 11]);
    renderTrumpStatus(v);

    // Phase banner — shows the phase plus whose turn. Adds a "you can cut"
    // hint when it's your turn and you can't follow suit in a closed game,
    // and a "CUT!" announcement when a face-down trump was just revealed.
    const phase = v.phase || '';
    const isYourTurn = v.currentPlayer === state.yourSeat;
    const phaseEl = $('#phase-banner');
    let phaseTxt = PHASE_LABELS[phase] || phase;
    const turnTxt = v.currentPlayer != null
      ? (isYourTurn ? ' — your turn' : ' — ' + nameOfSeat(v.currentPlayer) + '\'s turn')
      : '';
    let cutting = false;
    if (v.cutResolved && v.trumpSuit) {
      const winnerName = v.cutWinnerSeat != null ? nameOfSeat(v.cutWinnerSeat) : 'cutter';
      phaseTxt = 'CUT! Trump is ' + suitName(v.trumpSuit) + ' — ' + winnerName + ' takes the trick';
      cutting = true;
    } else if (phase === 'play' && isYourTurn && cannotFollowSuit(v)) {
      phaseTxt = 'You can\'t follow suit — tap a card to cut (face-down)';
      cutting = true;
    }
    phaseEl.textContent = phaseTxt + (cutting ? '' : turnTxt);
    phaseEl.classList.toggle('your-turn', isYourTurn && !cutting);
    phaseEl.classList.toggle('cutting', cutting);

    // Bid strip — visible across bidding AND play so the stake is
    // always one glance away. Trump suit/status is in the header pill
    // and (for the maker) on the labeled indicator card in their hand.
    renderBidStrip(v);

    // Seats
    renderOpponentSeats(v);
    renderYouSeat(v);

    // Trick center
    renderTrick(v.currentTrick || []);

    // Action bar
    renderActionBar(v);

    // Log
    renderLog(v.log || []);
  }

  // v2.2.15: header trump status collapsed to a persistent GRAPHIC dial
  // in the center of the top bar. The presence of a suit glyph IS the
  // reveal — no OPEN/CLOSED text needed. Three states:
  //   • no trump picked yet    → "?"          (dial.unknown)
  //   • closed; you're a non-maker → "?"      (dial.closed)
  //   • you're the maker OR trump is open → suit glyph in its colour
  //                             (dial.open if globally revealed,
  //                              dial.maker-only if only you can see it)
  function renderTrumpStatus(v) {
    const el = document.getElementById('trump-dial');
    const inner = document.getElementById('trump-dial-inner');
    if (!el || !inner) return;
    inner.innerHTML = '';
    el.classList.remove('open', 'closed', 'unknown', 'maker-only', 'color-red', 'color-black');

    if (!v || !v.trumpSuit) {
      // Pre-pick: "?" placeholder so the dial stays visually anchored.
      inner.textContent = '?';
      el.classList.add('unknown');
      return;
    }
    const isOpen = !!(v.isOpenTrump || v.trumpRevealed);
    const youAreMaker = v.trumpMaker === state.yourSeat;
    const suitVisible = isOpen || youAreMaker;

    if (suitVisible) {
      const s = v.trumpSuit;
      inner.textContent = ({ S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' })[s] || '?';
      el.classList.add(isOpen ? 'open' : 'maker-only');
      el.classList.add('color-' + (s === 'H' || s === 'D' ? 'red' : 'black'));
    } else {
      inner.textContent = '?';
      el.classList.add('closed');
    }
  }

  // The old #indicator-strip was removed in v2.2.9 — the maker now sees
  // a labeled indicator card inline with their hand (see renderHand). The
  // indicator card's location is still carried on the view via
  // `v.indicatorLocation`/`v.indicatorCard` so the hand renderer can
  // decide whether to inject the slot.

  function renderBidStrip(v) {
    const el = $('#bid-strip');
    if (!el) return;
    el.innerHTML = '';
    if (!v || !v.highBid) return;

    const label = document.createElement('span');
    label.className = 'bid-strip-label';
    label.textContent = (v.phase === 'play' || v.phase === 'inspect' || v.phase === 'hand_end')
      ? 'Bid this hand'
      : 'Current bid';
    el.appendChild(label);

    const value = document.createElement('span');
    value.className = 'bid-strip-value';
    value.textContent = displayBid(v.highBid.amount);
    el.appendChild(value);

    const bidder = document.createElement('span');
    bidder.className = 'bid-strip-bidder';
    const bidderName = nameOfSeat(v.highBid.bidder);
    const youAreBidder = v.highBid.bidder === state.yourSeat;
    bidder.textContent = 'by ' + (youAreBidder ? 'you' : bidderName);
    el.appendChild(bidder);

    // v2.2.9: the old "· trump <suit> · open/closed" tail was removed —
    // that information is carried by the trump-status pill in the header,
    // and (for the maker) by the labeled indicator card inside their hand.
  }

  function nameOfSeat(seat) {
    const v = state.view;
    if (!v || !v.seats) return SEAT_LABELS[seat];
    const s = v.seats[seat];
    if (s && s.name) return s.name;
    return SEAT_LABELS[seat];
  }

  function renderTokens(tokens) {
    // Our team index: seats 0 and 2 are team 0; seats 1 and 3 are team 1.
    const yourTeam = (state.yourSeat != null) ? (state.yourSeat % 2) : 0;
    const usCount = tokens[yourTeam] || 0;
    const themCount = tokens[1 - yourTeam] || 0;
    renderPips($('#pips-0'), usCount);
    renderPips($('#pips-1'), themCount);
  }

  // v2.2.12: token indicator. The old render drew five pip dots
  // regardless of actual count — so "7 ●●●●●" and "15 ●●●●●" read the
  // same at a glance, which is misleading (22 tokens are in play; the
  // relative split is the whole story). New render: the count in bold,
  // muted "/ 22" anchor for scale, plus a thin proportional bar so the
  // split is visible without counting digits.
  function renderPips(container, n) {
    container.innerHTML = '';
    const max = 22;
    const shown = Math.max(0, Math.min(max, n));

    const num = document.createElement('span');
    num.className = 'pips-num';
    num.textContent = shown;
    container.appendChild(num);

    const of = document.createElement('span');
    of.className = 'pips-of';
    of.textContent = '/' + max;
    container.appendChild(of);

    const bar = document.createElement('span');
    bar.className = 'pips-bar';
    const fill = document.createElement('span');
    fill.className = 'pips-fill';
    fill.style.width = Math.round((shown / max) * 100) + '%';
    bar.appendChild(fill);
    container.appendChild(bar);
  }

  // Opponents (top/left/right): face-down backs for each card in hand.
  // v2.2.13: if an opponent IS the trump maker, the indicator slot is
  // rendered as a DEDICATED element next to the seat name (not inside
  // .seat-cards). This keeps the back-stack perfectly symmetric and
  // avoids the asymmetric push observed in the v2.2.12 screenshot
  // (partner's stack got shoved left, overlapping the left opp's area).
  //   closed        → small face-down card with a "Trump" badge above.
  //   in-maker-hand → same slot, flipped face-up with the card data
  //                   (open-reveal animation triggers on the class
  //                   swap from .closed → .open).
  //   played        → slot removed; back-stack count unchanged.
  function renderOpponentSeats(v) {
    const handCounts = v.handCounts || [0, 0, 0, 0];
    for (let seat = 0; seat < 4; seat++) {
      if (seat === state.yourSeat) continue;
      const slot = slotOfSeat(seat);
      if (!slot || slot === 'bottom') continue;
      const el = document.getElementById('seat-' + slot);
      if (!el) continue;

      el.querySelector('.seat-name').textContent = nameOfSeat(seat);
      el.querySelector('.seat-name').classList.toggle('active', v.currentPlayer === seat);

      const cardsEl = el.querySelector('.seat-cards');
      cardsEl.innerHTML = '';
      const count = handCounts[seat] || 0;

      const isMakerSeat = v.trumpMaker === seat;
      const loc = v.indicatorLocation;
      const showIndicator = isMakerSeat && (loc === 'closed' || loc === 'in-maker-hand');
      // When the indicator lives inside hands[maker] (open phase),
      // handCounts already counts it — subtract 1 from the back stack
      // so we don't double-render it.
      const indicatorInHandCount = loc === 'in-maker-hand' ? 1 : 0;
      const backCount = Math.max(0, count - indicatorInHandCount);

      // Render the back stack first (always symmetric).
      const toDraw = Math.min(backCount, 8);
      for (let i = 0; i < toDraw; i++) {
        cardsEl.appendChild(Cards.renderBack());
      }

      // Dedicated indicator element lives alongside the seat name —
      // outside .seat-cards so the stack stays centered. Reuse a
      // persistent child node so the open-flip CSS animation can
      // trigger on the class swap rather than every re-render.
      let indEl = el.querySelector('.seat-indicator');
      if (showIndicator) {
        if (!indEl) {
          indEl = document.createElement('div');
          indEl.className = 'seat-indicator';
          // Insert after the name but before the cards — gives a clear
          // "this seat's trump card" affordance at the top of the slot.
          const nameEl = el.querySelector('.seat-name');
          nameEl.parentNode.insertBefore(indEl, nameEl.nextSibling);
        }
        const isOpen = loc === 'in-maker-hand';
        indEl.innerHTML = '';
        indEl.className = 'seat-indicator ' + (isOpen ? 'open' : 'closed');

        const badge = document.createElement('span');
        badge.className = 'seat-indicator-badge';
        badge.textContent = isOpen ? 'Trump · open' : 'Trump';
        indEl.appendChild(badge);

        let cardEl;
        if (isOpen && v.indicatorCard) {
          cardEl = Cards.render(v.indicatorCard, { small: true });
        } else {
          cardEl = Cards.renderBack();
          cardEl.classList.add('small');
        }
        cardEl.classList.add('seat-indicator-card');
        indEl.appendChild(cardEl);
      } else if (indEl) {
        // Indicator was played (or this seat is no longer the maker).
        indEl.remove();
      }

      // Bid label + kind-class so CSS can style pass/ask/bid distinctly.
      const bidEl = el.querySelector('.seat-bid');
      const info = bidLabelFor(v, seat);
      bidEl.textContent = info.text || '';
      bidEl.classList.remove('kind-pass', 'kind-ask', 'kind-bid');
      if (info.kind) bidEl.classList.add('kind-' + info.kind);
    }
  }

  function bidLabelFor(v, seat) {
    if (!v) return { text: '', kind: null };
    // Per-seat "bid N" / "pass" labels are only meaningful WHILE bidding
    // is in progress. In play, the bid-strip + header carry the winning
    // bid — these per-seat labels become clutter.
    const isBiddingPhase = v.phase === 'bid4' || v.phase === 'bid8';
    if (!isBiddingPhase) return { text: '', kind: null };
    if (v.highBid && v.highBid.bidder === seat) {
      return { text: 'bid ' + displayBid(v.highBid.amount), kind: 'bid' };
    }
    if (v.passedSeats && Array.isArray(v.passedSeats) && v.passedSeats.indexOf(seat) !== -1) {
      const asker = v.bids && v.bids.length ? v.bids.find((b) => b.seat === seat && b.type === 'askPartner') : null;
      if (asker) return { text: 'ask', kind: 'ask' };
      return { text: 'pass', kind: 'pass' };
    }
    return { text: '', kind: null };
  }

  function renderYouSeat(v) {
    const el = $('#seat-bottom');
    el.querySelector('.seat-name').textContent = nameOfSeat(state.yourSeat) + ' (you)';
    el.querySelector('.seat-name').classList.toggle('active', v.currentPlayer === state.yourSeat);
    renderHand(v);
  }

  function legalCardIdsFromView(v) {
    const actions = v.legalActions || [];
    const set = new Set();
    for (const a of actions) {
      if ((a.type === 'playCard' || a.type === 'pickTrump') && Array.isArray(a.cardIds)) {
        for (const id of a.cardIds) set.add(id);
      }
    }
    return set;
  }

  // Render the maker's / your hand. The trump indicator (if you're the
  // maker and it's still un-played) is rendered AS A CARD in this same
  // row, wrapped in a labeled frame with a visible gap so the other cards
  // obviously shift around it. The indicator flips face-down → face-up
  // when the game opens, and is tappable per `legalIds`. This replaces
  // the old separate #your-trump row + #indicator-strip banner.
  function renderHand(v) {
    const el = $('#your-hand');
    el.innerHTML = '';
    if (!v) return;
    const legalIds = legalCardIdsFromView(v);
    const hand = (v.yourHand || []).slice();
    const youAreMaker = v.trumpMaker === state.yourSeat;

    // Resolve the indicator card + phase. Two representations depending
    // on whether the game is closed:
    //   closed → v.trumpIndicator carries the full card (maker only);
    //            it is NOT in v.yourHand yet.
    //   open  → indicator has been pushed into hands[maker]; it IS in
    //            v.yourHand. v.indicatorCard is the canonical lookup.
    let indicatorCard = null;     // the Card obj to render as indicator
    let indicatorPhase = null;    // 'closed' | 'open'
    if (youAreMaker && v.indicatorLocation === 'closed' && v.indicatorCard) {
      indicatorCard = v.indicatorCard;
      indicatorPhase = 'closed';
    } else if (youAreMaker && v.indicatorLocation === 'in-maker-hand' && v.indicatorCard) {
      indicatorCard = v.indicatorCard;
      indicatorPhase = 'open';
    }

    // Sort the hand for stable display. Exclude the indicator from the
    // normal run so we can slot it back in with its special wrapper.
    const indicatorId = indicatorCard ? indicatorCard.id : null;
    const sorted = hand.slice().filter((c) => c.id !== indicatorId).sort(cardSortCompare);

    // If there's an indicator to show, inject its wrapper first (leftmost
    // in the row; visually separated via CSS margin + label).
    if (indicatorCard) {
      const wrap = document.createElement('div');
      // v2.2.11: for the caller, the indicator always renders FACE-UP
      // in its separated slot — they picked the card, they always see
      // it, and (critically) it remains tappable / playable whenever
      // the engine says it's legal (cut, trick 8, open-lead). The
      // `.open` class drives the same gold ring + flip CSS as before.
      wrap.className = 'indicator-slot open';

      const badge = document.createElement('span');
      badge.className = 'indicator-badge';
      badge.textContent = indicatorPhase === 'open' ? 'Indicator · open' : 'Indicator';
      wrap.appendChild(badge);

      const isTappable = legalIds.has(indicatorCard.id);
      const cardEl = Cards.render(indicatorCard, {
        faceDown: false,
        legal: isTappable,
        onClick: isTappable ? (card) => onCardTap(card, true) : null,
      });
      cardEl.classList.add('indicator-card');
      wrap.appendChild(cardEl);
      el.appendChild(wrap);
    }

    for (const c of sorted) {
      const legal = legalIds.has(c.id);
      const cardEl = Cards.render(c, {
        legal: legal,
        onClick: (card) => onCardTap(card, legal),
      });
      el.appendChild(cardEl);
    }
  }

  function cardSortCompare(a, b) {
    const SUIT_ORD = { S: 0, H: 1, D: 2, C: 3 };
    const RANK_ORD = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };
    if (a.suit !== b.suit) return SUIT_ORD[a.suit] - SUIT_ORD[b.suit];
    return RANK_ORD[b.rank] - RANK_ORD[a.rank]; // high to low within suit
  }

  function onCardTap(card, legal) {
    const v = state.view;
    if (!v) return;
    const phase = v.phase;
    if (phase === 'trump_pick1' || phase === 'trump_pick2') {
      // pickTrump legality: any of your 4/8 cards (legalIds already contains them)
      const ids = legalCardIdsFromView(v);
      if (!ids.has(card.id)) { toast('Not your turn'); return; }
      gatedEmit('action', { type: 'pickTrump', cardId: card.id });
      return;
    }
    if (phase === 'play') {
      if (!legal) { toast('Card not legal here'); return; }
      // faceDown: if we cannot follow suit AND game is closed, server likely
      // expects face-down. We compute as suggestion — server is authoritative.
      const faceDown = shouldPlayFaceDown(v, card);
      gatedEmit('action', { type: 'playCard', cardId: card.id, faceDown });
      return;
    }
    // Otherwise ignore tap
  }

  function shouldPlayFaceDown(v, card) {
    if (!v || !v.currentTrick || v.currentTrick.length === 0) return false;
    if (v.isOpenTrump) return false;
    const lead = v.currentTrick[0];
    const leadSuit = lead && lead.card ? lead.card.suit : null;
    if (!leadSuit) return false;
    if (card.suit === leadSuit) return false;
    // We can't follow suit — in a closed game we play face-down.
    return !v.trumpRevealed;
  }

  function renderTrick(trick) {
    // Clear all 4 slots
    const slots = {
      top: document.querySelector('.trick-card.slot-top'),
      right: document.querySelector('.trick-card.slot-right'),
      bottom: document.querySelector('.trick-card.slot-bottom'),
      left: document.querySelector('.trick-card.slot-left'),
    };
    for (const slot of Object.values(slots)) { if (slot) slot.innerHTML = ''; }

    for (const p of trick) {
      if (!p) continue;
      const slotName = slotOfSeat(p.seat);
      const slot = slots[slotName];
      if (!slot) continue;
      slot.innerHTML = '';
      // v2.2.9: seat-name tags above trick cards removed. The player is
      // unambiguous from the slot position (top/left/right/bottom map to
      // partner/left-opp/right-opp/you), and rank + suit are on the card
      // corners. For cut plays, the face-down back is visually distinct
      // and the "CUT!" flash + log entry already narrate the action.
      const isFaceDown = !!(p.faceDown || p.hidden);
      let cardEl;
      if (isFaceDown && !p.card) {
        // True opponent-face-down: no card data, just a back.
        cardEl = Cards.renderBack();
      } else if (isFaceDown && p.makerPeek) {
        // Trump maker's private peek: render face-up with the gold ring so
        // they know the other players still see a back.
        cardEl = Cards.render(p.card, { small: false });
        cardEl.classList.add('maker-peek');
      } else if (isFaceDown) {
        // Our own cut: we know the card we played; show a back (the public
        // state) so the UI matches what others see. The log entry already
        // confirms which card it was.
        cardEl = Cards.renderBack();
      } else {
        cardEl = Cards.render(p.card, { small: false });
      }
      slot.appendChild(cardEl);
    }
  }

  // ---- Action bar -----------------------------------------------------------
  function renderActionBar(v) {
    const chipsEl = $('#action-chips');
    const extrasEl = $('#action-extras');
    chipsEl.innerHTML = '';
    extrasEl.innerHTML = '';

    const actions = v.legalActions || [];
    const yourTurn = v.currentPlayer === state.yourSeat;
    // Defensive: bid / pass / askPartner chips should only appear while
    // the round is actually in a bidding phase. The server already
    // strips them from legalActions in other phases, but this client
    // guard prevents a stale view-render from showing them after the
    // bid is settled (the "pass and bid ui should disappear" rule).
    const isBiddingPhase = v.phase === 'bid4' || v.phase === 'bid8';

    if (!actions.length) {
      const hint = document.createElement('div');
      hint.className = 'chip ghost';
      hint.textContent = yourTurn ? 'Tap a card' : 'Waiting…';
      chipsEl.appendChild(hint);
      return;
    }

    for (const a of actions) {
      switch (a.type) {
        case 'bid':
          if (!isBiddingPhase) break;
          renderBidAction(a, chipsEl, extrasEl);
          break;
        case 'pass':
          if (!isBiddingPhase) break;
          addChip(chipsEl, 'Pass', 'pass', () => emitAction({ type: 'pass' }));
          break;
        case 'askPartner':
          if (!isBiddingPhase) break;
          addChip(chipsEl, 'Ask partner (counts as pass)', '', () => emitAction({ type: 'askPartner' }));
          break;
        case 'demandRedeal': addChip(chipsEl, 'Demand redeal', 'danger', () => emitAction({ type: 'demandRedeal' })); break;
        case 'declareOpen':
          // The act of declaring open commits the maker to leading the
          // indicator on trick 1 — surface that in the chip label so it's
          // not a surprise.
          addChip(chipsEl, 'Declare open (lead indicator)', 'primary', () => emitAction({ type: 'declareOpen' }));
          break;
        case 'declareClosed': addChip(chipsEl, 'Play closed', '', () => emitAction({ type: 'declareClosed' })); break;
        case 'continue': addChip(chipsEl, 'Continue', 'primary', () => emitAction({ type: 'continue' })); break;
        case 'playCard': {
          // Just a hint — actual play is by tapping a card.
          const hint = document.createElement('div');
          hint.className = 'chip ghost';
          hint.textContent = 'Tap a card';
          chipsEl.appendChild(hint);
          break;
        }
        case 'pickTrump': {
          const hint = document.createElement('div');
          hint.className = 'chip ghost';
          hint.textContent = 'Tap a card to set trump';
          chipsEl.appendChild(hint);
          break;
        }
        default: break;
      }
    }
  }

  function addChip(parent, label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'chip' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
  }

  function renderBidAction(action, chipsEl, extrasEl) {
    // v2.2.5: custom-bid input removed. Every legal bid amount is
    // surfaced as a tappable chip. Bids that aren't in the common
    // ladder (rare, e.g. after odd opponent bids) get a `ghost` chip.
    // No free-form entry — avoids typos and ambiguity.
    const suggested = [160, 170, 180, 200, 210, 220, 250];
    const allowed = Array.isArray(action.amounts) ? action.amounts : suggested;
    const allowedSet = new Set(allowed);

    const chipVals = suggested.filter((v) => allowedSet.has(v));
    for (const amt of chipVals) {
      addChip(chipsEl, displayBid(amt), '', () => emitAction({ type: 'bid', amount: amt }));
    }
    const extras = allowed.filter((v) => !chipVals.includes(v));
    for (const amt of extras.slice(0, 6)) {
      addChip(chipsEl, displayBid(amt), 'ghost', () => emitAction({ type: 'bid', amount: amt }));
    }
  }

  function emitAction(payload) {
    gatedEmit('action', payload);
  }

  function renderLog(entries) {
    const list = $('#log');
    list.innerHTML = '';
    const last = entries.slice(-10);
    for (const e of last) {
      const li = document.createElement('li');
      li.textContent = typeof e === 'string' ? e : (e && e.text) || JSON.stringify(e);
      list.appendChild(li);
    }
  }

  // ---- Helpers --------------------------------------------------------------
  // Bid display convention (household variant, v2.2.2):
  //   160–240 (the 4-card range)   →   internal − 100   (so 160→"60",
  //                                    200→"100", 240→"140")
  //   250 and above (the 8-card range)   →   internal unchanged (250,
  //                                    260, …, 300)
  // Engine math is unchanged — bids stay integer multiples of 10
  // internally. This is a pure UI relabel so the chips read like the
  // spoken call at the table; the "system changes at 250" matches the
  // round boundary, signaling that any bid above 240 is a commitment
  // to the second-round (8-card) stake level.
  function displayBid(internal) {
    if (internal == null) return '';
    if (internal >= 160 && internal < 250) return String(internal - 100);
    return String(internal);
  }

  function displayPoints(internal) {
    return String(internal / 10);
  }

  const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  function suitName(s) { return SUIT_NAMES[s] || s; }

  // True iff it's the player's turn to follow a non-empty trick AND they
  // hold no card of the lead suit (i.e., must play face-down to cut).
  function cannotFollowSuit(v) {
    if (!v || !Array.isArray(v.currentTrick) || v.currentTrick.length === 0) return false;
    if (v.isOpenTrump || v.trumpRevealed) return false;
    const lead = v.currentTrick[0];
    const leadSuit = lead && lead.card ? lead.card.suit : null;
    if (!leadSuit) return false;
    const hand = v.yourHand || [];
    return !hand.some((c) => c.suit === leadSuit);
  }

  // Expose a tiny debug hook without leaking the whole closure.
  window.__p304 = { state, socket, displayBid, displayPoints };
})();
