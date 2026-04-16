// public/client.js — Socket.IO client for 304.
// Talks to server via the protocol in docs/API.md. No framework.

(function () {
  'use strict';

  const socket = io();

  // ---- UI state -------------------------------------------------------------
  const state = {
    screen: 'landing',     // 'landing' | 'lobby' | 'table'
    name: '',
    roomId: null,
    yourSeat: null,
    view: null,            // last PlayerView from server
  };

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
  setScreen('landing');

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.style.background = isError === false ? '#2f7d4b' : 'var(--danger)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ---- Landing handlers -----------------------------------------------------
  const nameInput = $('#name-input');
  const codeInput = $('#code-input');
  // Pre-populate name if previously used
  try {
    const saved = localStorage.getItem('p304.name');
    if (saved) nameInput.value = saved;
  } catch (e) { /* ignore */ }

  // Auto-join from ?room=XYZ&name=Foo query params
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = (urlParams.get('room') || '').toUpperCase().trim();
  const urlName = (urlParams.get('name') || '').trim();
  if (urlRoom) codeInput.value = urlRoom;
  if (urlName) nameInput.value = urlName;
  if (urlRoom && (urlName || nameInput.value.trim())) {
    const name = (urlName || nameInput.value.trim());
    state.name = name;
    try { localStorage.setItem('p304.name', name); } catch (e) {}
    socket.emit('joinRoom', { roomId: urlRoom, name });
  }

  $('#create-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Enter your name first'); return; }
    state.name = name;
    try { localStorage.setItem('p304.name', name); } catch (e) {}
    socket.emit('createRoom', { name });
  });

  $('#join-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    const roomId = codeInput.value.toUpperCase().trim();
    if (!name) { toast('Enter your name first'); return; }
    if (!roomId) { toast('Enter a room code'); return; }
    state.name = name;
    try { localStorage.setItem('p304.name', name); } catch (e) {}
    socket.emit('joinRoom', { roomId, name });
  });

  // Share invite link
  $('#share-btn').addEventListener('click', async () => {
    if (!state.roomId) { toast('Room code not ready yet'); return; }
    const url = inviteUrlFor(state.roomId);
    const shareData = {
      title: '304 — join my game',
      text: 'Join my 304 game (room ' + state.roomId + ')',
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch (e) { /* user dismissed; fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied', false);
    } catch (e) {
      // Old fallback: show prompt
      window.prompt('Copy this invite link:', url);
    }
  });

  function inviteUrlFor(roomId) {
    const loc = window.location;
    return loc.origin + loc.pathname + '?room=' + encodeURIComponent(roomId);
  }

  // Unlock audio on first user gesture (iOS/Safari requirement).
  function unlockFXOnce() {
    try { if (window.FX) FX.unlock(); } catch (e) {}
    window.removeEventListener('pointerdown', unlockFXOnce);
    window.removeEventListener('keydown', unlockFXOnce);
  }
  window.addEventListener('pointerdown', unlockFXOnce, { once: true });
  window.addEventListener('keydown', unlockFXOnce, { once: true });

  // Mute toggle
  const muteBtn = $('#mute-btn');
  function refreshMuteBtn() {
    if (!muteBtn || !window.FX) return;
    muteBtn.classList.toggle('muted', FX.isMuted());
  }
  refreshMuteBtn();
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!window.FX) return;
      FX.setMuted(!FX.isMuted());
      refreshMuteBtn();
      if (!FX.isMuted()) { FX.unlock(); FX.sound.yourTurn(); }
    });
  }

  // ---- Socket listeners -----------------------------------------------------
  socket.on('connect', () => { /* connected */ });

  socket.on('disconnect', () => { toast('Disconnected — retrying...'); });

  socket.on('roomCreated', (payload) => {
    state.roomId = payload.roomId;
    state.yourSeat = payload.seat;
    state.view = payload.view || null;
    setScreen('lobby');
    renderLobby();
  });

  socket.on('roomJoined', (payload) => {
    state.yourSeat = payload.seat;
    state.view = payload.view || null;
    if (state.view && state.view.roomId) state.roomId = state.view.roomId;
    setScreen('lobby');
    renderLobby();
  });

  socket.on('view', (payload) => {
    const view = payload && payload.view ? payload.view : payload;
    const prev = state.view;

    // If a trick just completed (tricksPlayed advanced), play the collect
    // animation against the *previous* trick before applying the new view.
    if (prev && view && view.tricksPlayed > (prev.tricksPlayed || 0) && prev.currentTrick && prev.currentTrick.length === 4) {
      playTrickCollectAnimation(prev, () => {
        state.view = view;
        if (typeof view.yourSeat === 'number') state.yourSeat = view.yourSeat;
        if (view.roomId) state.roomId = view.roomId;
        maybePlayEventFX(prev, view);
        if (view.phase === 'waiting') { setScreen('lobby'); renderLobby(); }
        else { setScreen('table'); renderTable(); }
      });
      return;
    }

    state.view = view;
    if (view && typeof view.yourSeat === 'number') state.yourSeat = view.yourSeat;
    if (view && view.roomId) state.roomId = view.roomId;
    maybePlayEventFX(prev, view);
    if (view && view.phase === 'waiting') {
      setScreen('lobby');
      renderLobby();
    } else {
      setScreen('table');
      renderTable();
    }
  });

  function playTrickCollectAnimation(prevView, done) {
    const reduced = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setTimeout(done, 0); return; }
    const trickEl = document.getElementById('trick');
    if (!trickEl) { setTimeout(done, 0); return; }
    // Determine winner seat from completed trick via client-side resolution.
    const winnerSeat = resolveWinnerSeat(prevView, prevView.currentTrick);
    // Mark winner slot
    const slotName = winnerSeat != null ? slotOfSeat(winnerSeat) : null;
    const slots = trickEl.querySelectorAll('.trick-card');
    slots.forEach((el) => el.classList.remove('winner'));
    if (slotName) {
      const w = trickEl.querySelector('.trick-card.slot-' + slotName);
      if (w) w.classList.add('winner');
    }
    // Allow the winnerPulse to play, then collect.
    setTimeout(() => {
      trickEl.classList.add('collecting');
      setTimeout(() => {
        trickEl.classList.remove('collecting');
        slots.forEach((el) => el.classList.remove('winner'));
        done();
      }, 340);
    }, 260);
  }

  // Client-side winner derivation (mirrors engine rules — for animation only).
  function resolveWinnerSeat(v, trick) {
    if (!trick || !trick.length) return null;
    const trump = v.trumpRevealed || v.isOpenTrump ? v.trumpSuit : null;
    const first = trick[0];
    const leadSuit = first.hidden || (first.faceDown && !first.isTrumpIndicator) ? null : (first.card && first.card.suit);
    let bestIdx = -1;
    for (let i = 0; i < trick.length; i++) {
      const p = trick[i];
      if (!p.card) continue;
      if (p.faceDown && !p.isTrumpIndicator) continue;
      if (bestIdx < 0) { bestIdx = i; continue; }
      if (compareForAnim(p, trick[bestIdx], trump, leadSuit) > 0) bestIdx = i;
    }
    return bestIdx >= 0 ? trick[bestIdx].seat : null;
  }
  function compareForAnim(a, b, trump, lead) {
    const RANK_ORD = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };
    const av = RANK_ORD[a.card.rank], bv = RANK_ORD[b.card.rank];
    const aT = trump && a.card.suit === trump, bT = trump && b.card.suit === trump;
    if (aT && !bT) return 1;
    if (!aT && bT) return -1;
    if (aT && bT) return av - bv;
    const aL = a.card.suit === lead, bL = b.card.suit === lead;
    if (aL && !bL) return 1;
    if (!aL && bL) return -1;
    if (aL && bL) return av - bv;
    return 0;
  }

  socket.on('actionError', (p) => {
    const reason = (p && p.reason) || 'Illegal action';
    toast(reason);
    try { FX.sound.illegal(); FX.haptic.illegal(); } catch (e) {}
  });

  // Detect notable state transitions to fire FX.
  function maybePlayEventFX(prev, curr) {
    if (!curr || !window.FX) return;
    try {
      // Card-played: currentTrick grew
      const prevLen = prev && prev.currentTrick ? prev.currentTrick.length : 0;
      const currLen = curr.currentTrick ? curr.currentTrick.length : 0;
      if (currLen > prevLen) { FX.sound.cardPlay(); }
      // Trick won: tricksPlayed advanced
      if (prev && curr.tricksPlayed > (prev.tricksPlayed || 0)) {
        FX.sound.trickWon(); FX.haptic.trickWon();
      }
      // New bid placed
      const prevHighAmt = prev && prev.highBid ? prev.highBid.amount : 0;
      const currHighAmt = curr.highBid ? curr.highBid.amount : 0;
      if (currHighAmt > prevHighAmt) FX.sound.bidPlaced();
      // Your turn just started
      const prevTurn = prev ? (prev.currentPlayer === state.yourSeat || prev.currentBidder === state.yourSeat) : false;
      const currTurn = (curr.currentPlayer === state.yourSeat) || (curr.currentBidder === state.yourSeat);
      if (currTurn && !prevTurn) { FX.sound.yourTurn(); FX.haptic.yourTurn(); }
      // Token transfer (hand_end)
      if (prev && prev.phase !== 'hand_end' && curr.phase === 'hand_end') FX.sound.tokenTransfer();
      // Game over
      if (prev && prev.phase !== 'game_over' && curr.phase === 'game_over') {
        FX.sound.gameOver(); FX.haptic.gameOver();
      }
    } catch (e) { /* never let FX break the game */ }
  }

  // ---- Lobby rendering ------------------------------------------------------
  $('#leave-btn').addEventListener('click', () => {
    window.location.reload();
  });

  $('#start-btn').addEventListener('click', () => {
    socket.emit('startGame');
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
          btn.addEventListener('click', () => socket.emit('removeAI', { seat: i }));
        } else if (!s) {
          btn.textContent = 'Add AI';
          btn.addEventListener('click', () => socket.emit('addAI', { seat: i }));
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
    const prevLen = el.querySelectorAll('.card').length;
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
    // Fresh deal: if we went from 0 to 4 or 4 to 8 cards, animate.
    if ((prevLen === 0 && sorted.length >= 4) || (prevLen === 4 && sorted.length === 8)) {
      el.classList.remove('dealing');
      // force reflow so the class re-triggers animation
      void el.offsetWidth;
      el.classList.add('dealing');
      try { FX.sound.cardDeal(); } catch (e) {}
      setTimeout(() => el.classList.remove('dealing'), 700);
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
      socket.emit('action', { type: 'pickTrump', cardId: card.id });
      return;
    }
    if (phase === 'play') {
      if (!legal) { toast('Card not legal here'); return; }
      // faceDown: if we cannot follow suit AND game is closed, server likely
      // expects face-down. We compute as suggestion — server is authoritative.
      const faceDown = shouldPlayFaceDown(v, card);
      socket.emit('action', { type: 'playCard', cardId: card.id, faceDown });
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
    socket.emit('action', payload);
  }

  // ---- Trick history modal ----
  const historyModal = $('#history-modal');
  const historyBody = $('#history-body');
  $('#history-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openHistoryModal();
  });
  $('#history-close')?.addEventListener('click', closeHistoryModal);
  historyModal?.addEventListener('click', (e) => {
    if (e.target === historyModal) closeHistoryModal();
  });

  function openHistoryModal() {
    renderHistoryBody();
    historyModal.classList.remove('hidden');
  }
  function closeHistoryModal() { historyModal.classList.add('hidden'); }

  function renderHistoryBody() {
    const v = state.view;
    historyBody.innerHTML = '';
    const hist = (v && v.trickHistory) || [];
    if (!hist.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'No tricks played yet this hand.';
      historyBody.appendChild(empty);
      return;
    }
    for (const t of hist) {
      const wrap = document.createElement('div');
      wrap.className = 'trick-history-item';
      const head = document.createElement('div');
      head.className = 'trick-history-head';
      const who = nameOfSeat(t.winnerSeat);
      head.innerHTML =
        '<span>Trick ' + t.index + ' &mdash; won by ' + escapeHtml(who) + '</span>' +
        '<span class="pts">+' + displayPoints(t.points) + '</span>';
      wrap.appendChild(head);
      const row = document.createElement('div');
      row.className = 'trick-history-cards';
      for (const p of t.cards) {
        const seatWrap = document.createElement('div');
        seatWrap.className = 'mini-seat' + (p.seat === t.winnerSeat ? ' winner' : '');
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = nameOfSeat(p.seat);
        seatWrap.appendChild(tag);
        const cardEl = (p.hidden || (p.faceDown && !p.card))
          ? Cards.renderBack()
          : (p.faceDown ? decorateFaceDown(Cards.render(p.card, { small: true })) : Cards.render(p.card, { small: true }));
        seatWrap.appendChild(cardEl);
        row.appendChild(seatWrap);
      }
      wrap.appendChild(row);
      historyBody.appendChild(wrap);
    }
  }

  function decorateFaceDown(el) { el.classList.add('face-down'); return el; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>\"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
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
