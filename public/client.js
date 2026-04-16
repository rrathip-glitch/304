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
    while (pendingEmits.length) {
      const [name, payload] = pendingEmits.shift();
      socket.emit(name, payload);
    }
  }
  function closeGate() { emitReady = false; }
  function gatedEmit(name, payload) {
    if (emitReady && socket.connected) {
      socket.emit(name, payload);
      return;
    }
    // Dedup: if the user mashes a button, don't stack identical emits.
    const last = pendingEmits[pendingEmits.length - 1];
    if (last && last[0] === name && JSON.stringify(last[1]) === JSON.stringify(payload)) return;
    pendingEmits.push([name, payload]);
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
      socket.emit('resume', { roomId: sess.roomId, name: sess.name });
    } else {
      // Fresh connection with no session — open the gate so createRoom /
      // joinRoom can flow.
      openGate();
    }
  });

  socket.on('disconnect', () => {
    // Close the gate immediately so nothing the user taps during the blip
    // ends up in Socket.IO's buffer (where it would race past resume on
    // reconnect). Show a small persistent banner instead of a fleeting toast
    // so the user knows we're working on it.
    closeGate();
    setConnBanner(true);
  });
  socket.io.on('reconnect_attempt', () => { /* silent */ });
  socket.on('connect_error', (err) => { console.warn('connect_error', err && err.message); });

  socket.on('roomCreated', (payload) => {
    state.roomId = payload.roomId;
    state.yourSeat = payload.seat;
    state.view = payload.view || null;
    saveSession();
    openGate();
    setScreen('lobby');
    renderLobby();
  });

  socket.on('roomJoined', (payload) => {
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
    state.view = view;
    if (view && typeof view.yourSeat === 'number') state.yourSeat = view.yourSeat;
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

    // Phase banner — shows the phase plus whose turn
    const phase = v.phase || '';
    const isYourTurn = v.currentPlayer === state.yourSeat;
    const phaseEl = $('#phase-banner');
    const phaseTxt = PHASE_LABELS[phase] || phase;
    const turnTxt = v.currentPlayer != null
      ? (isYourTurn ? ' — your turn' : ' — ' + nameOfSeat(v.currentPlayer) + '\'s turn')
      : '';
    phaseEl.textContent = phaseTxt + turnTxt;
    phaseEl.classList.toggle('your-turn', isYourTurn);

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

  function renderPips(container, n) {
    container.innerHTML = '';
    const max = 22;
    const shown = Math.max(0, Math.min(max, n));
    // Show count numerically + a few pips (to fit mobile)
    const label = document.createElement('span');
    label.textContent = shown;
    label.style.fontWeight = '700';
    label.style.marginRight = '4px';
    container.appendChild(label);
    const pipsToDraw = Math.min(shown, 5);
    for (let i = 0; i < pipsToDraw; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      container.appendChild(pip);
    }
  }

  // Opponents (top/left/right): face-down backs for each card in hand.
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
      const toDraw = Math.min(count, 8);
      for (let i = 0; i < toDraw; i++) {
        cardsEl.appendChild(Cards.renderBack());
      }

      // Bid indicator
      const bidEl = el.querySelector('.seat-bid');
      bidEl.textContent = bidLabelFor(v, seat);
    }
  }

  function bidLabelFor(v, seat) {
    if (!v) return '';
    if (v.highBid && v.highBid.bidder === seat) {
      return 'bid ' + displayBid(v.highBid.amount);
    }
    if (v.passedSeats && Array.isArray(v.passedSeats) && v.passedSeats.indexOf(seat) !== -1) {
      return 'pass';
    }
    return '';
  }

  function renderYouSeat(v) {
    const el = $('#seat-bottom');
    el.querySelector('.seat-name').textContent = nameOfSeat(state.yourSeat) + ' (you)';
    el.querySelector('.seat-name').classList.toggle('active', v.currentPlayer === state.yourSeat);
    renderHand(v.yourHand || [], legalCardIdsFromView(v));
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

  function renderHand(hand, legalIds) {
    const el = $('#your-hand');
    el.innerHTML = '';
    // Sort hand by suit then rank for stable display
    const sorted = hand.slice().sort(cardSortCompare);
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
      const tag = document.createElement('div');
      tag.className = 'seat-tag';
      tag.textContent = nameOfSeat(p.seat);
      slot.appendChild(tag);

      const isFaceDown = !!(p.faceDown || p.hidden);
      let cardEl;
      if (isFaceDown && !p.card) {
        cardEl = Cards.renderBack();
      } else if (isFaceDown) {
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

    if (!actions.length) {
      const hint = document.createElement('div');
      hint.className = 'chip ghost';
      hint.textContent = yourTurn ? 'Tap a card' : 'Waiting…';
      chipsEl.appendChild(hint);
      return;
    }

    for (const a of actions) {
      switch (a.type) {
        case 'bid': renderBidAction(a, chipsEl, extrasEl); break;
        case 'pass': addChip(chipsEl, 'Pass', 'pass', () => emitAction({ type: 'pass' })); break;
        case 'askPartner': addChip(chipsEl, 'Ask partner', '', () => emitAction({ type: 'askPartner' })); break;
        case 'demandRedeal': addChip(chipsEl, 'Demand redeal', 'danger', () => emitAction({ type: 'demandRedeal' })); break;
        case 'declareOpen': addChip(chipsEl, 'Declare open', 'primary', () => emitAction({ type: 'declareOpen' })); break;
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
    const suggested = [160, 170, 180, 200, 210, 220, 250];
    const allowed = Array.isArray(action.amounts) ? action.amounts : suggested;
    const allowedSet = new Set(allowed);

    const chipVals = suggested.filter((v) => allowedSet.has(v));
    for (const amt of chipVals) {
      addChip(chipsEl, displayBid(amt), '', () => emitAction({ type: 'bid', amount: amt }));
    }
    // Also any allowed bids not in suggested set (rare amounts)
    const extras = allowed.filter((v) => !chipVals.includes(v));
    for (const amt of extras.slice(0, 3)) {
      addChip(chipsEl, displayBid(amt), 'ghost', () => emitAction({ type: 'bid', amount: amt }));
    }

    // Custom input
    const wrap = document.createElement('div');
    wrap.className = 'bid-custom';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '10';
    input.min = String(Math.min.apply(null, allowed));
    input.className = 'bid-input';
    input.placeholder = 'custom';
    const go = document.createElement('button');
    go.className = 'chip primary';
    go.textContent = 'Bid';
    go.addEventListener('click', () => {
      const raw = parseInt(input.value, 10);
      if (!raw || raw % 10 !== 0) { toast('Bids are multiples of 10'); return; }
      emitAction({ type: 'bid', amount: raw });
    });
    extrasEl.appendChild(input);
    extrasEl.appendChild(go);
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
  // Internal bid amounts are integer multiples of 10; display is /10.
  function displayBid(internal) {
    if (internal == null) return '';
    const n = internal / 10;
    return (internal % 10 === 0) ? String(n) : n.toFixed(1);
  }

  function displayPoints(internal) {
    return String(internal / 10);
  }

  // Expose a tiny debug hook without leaking the whole closure.
  window.__p304 = { state, socket, displayBid, displayPoints };
})();
