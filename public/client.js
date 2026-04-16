/* 304 — Socket.IO client, UI state, renderers.
 *
 * Binds to the protocol in docs/API.md. Never computes game state locally —
 * the server sends a filtered `view` and this file renders it.
 *
 *   C → S: createRoom, joinRoom, setSeat, addAI, removeAI, startGame,
 *          action { type, ...payload }, resume
 *   S → C: roomCreated, roomJoined, view, actionError, playerUpdate
 */
(function () {
  "use strict";

  // ================= DOM refs =================
  const $ = (sel) => document.querySelector(sel);
  const views = {
    landing: $("#view-landing"),
    lobby: $("#view-lobby"),
    table: $("#view-table"),
  };
  const toastEl = $("#toast");
  const modal = $("#modal");

  // ================= State =================
  const state = {
    name: localStorage.getItem("p304.name") || "",
    roomId: null,
    yourSeat: null,
    isHost: false,
    lastView: null,
    selectedCardId: null,
  };

  // ================= View switching =================
  function showView(name) {
    for (const k in views) views[k].classList.toggle("hidden", k !== name);
  }

  // ================= Toast =================
  let toastTimer = null;
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), ms);
  }

  // ================= Socket =================
  const socket = io({ transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    // Auto-resume if we have a room in URL or storage.
    const urlRoom = new URLSearchParams(location.search).get("room");
    const savedRoom = sessionStorage.getItem("p304.roomId");
    const resumeRoom = savedRoom || urlRoom;
    if (resumeRoom && state.name) {
      socket.emit("resume", { roomId: resumeRoom, name: state.name });
    } else if (urlRoom) {
      $("#join-code").value = urlRoom.toUpperCase();
    }
    prefillName();
  });

  socket.on("disconnect", () => toast("Disconnected — reconnecting…", 3000));

  socket.on("roomCreated", ({ roomId, seat, view }) => {
    state.roomId = roomId;
    state.yourSeat = seat;
    state.isHost = seat === 0;
    sessionStorage.setItem("p304.roomId", roomId);
    updateShareURL(roomId);
    applyView(view);
  });

  socket.on("roomJoined", ({ seat, view, roomId }) => {
    state.yourSeat = seat;
    if (roomId) state.roomId = roomId;
    state.isHost = seat === 0;
    sessionStorage.setItem("p304.roomId", state.roomId);
    updateShareURL(state.roomId);
    applyView(view);
  });

  socket.on("view", ({ view }) => applyView(view));
  socket.on("playerUpdate", ({ view }) => view && applyView(view));

  socket.on("actionError", ({ reason }) => toast(reason || "Illegal action"));

  // ================= Landing =================
  function prefillName() {
    if (!state.name) return;
    const el1 = $("#create-name"), el2 = $("#join-name");
    if (el1 && !el1.value) el1.value = state.name;
    if (el2 && !el2.value) el2.value = state.name;
  }

  $("#form-create").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#create-name").value.trim();
    if (!name) return;
    state.name = name;
    localStorage.setItem("p304.name", name);
    socket.emit("createRoom", { name });
  });

  $("#form-join").addEventListener("submit", (e) => {
    e.preventDefault();
    const roomId = $("#join-code").value.trim().toUpperCase();
    const name = $("#join-name").value.trim();
    if (!roomId || !name) return;
    state.name = name;
    state.roomId = roomId;
    localStorage.setItem("p304.name", name);
    socket.emit("joinRoom", { roomId, name });
  });

  $("#show-rules").addEventListener("click", (e) => {
    e.preventDefault();
    openModal("How to play (short)",
      "304 is a trick-taking game for 4 in 2 teams. Bid (min 160). " +
      "Highest bidder picks trump by placing a face-down card. " +
      "Play 8 tricks, must follow suit. First team to 22 tokens wins.");
  });

  // ================= Lobby =================
  $("#btn-copy-link").addEventListener("click", async () => {
    const url = shareURL();
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      prompt("Copy this link:", url);
    }
  });

  $("#btn-start").addEventListener("click", () => {
    socket.emit("startGame");
  });

  function renderLobby(view) {
    $("#lobby-code").textContent = state.roomId || "------";
    const list = $("#lobby-seats");
    list.innerHTML = "";
    const seats = view.seats || [];
    const labels = ["You (host)", "Right opponent", "Partner", "Left opponent"];
    for (let i = 0; i < 4; i++) {
      const s = seats[i] || { empty: true };
      const li = document.createElement("li");
      li.className = "seat-row";
      if (s.empty) li.classList.add("empty");
      if (s.isAI) li.classList.add("ai");
      if (i === 0) li.classList.add("host");
      const idx = document.createElement("span");
      idx.className = "seat-idx";
      idx.textContent = String(i);
      const name = document.createElement("div");
      name.innerHTML = `<span class="seat-name">${escapeHTML(
        s.empty ? "(empty)" : s.name || "Player"
      )}</span><div class="role-tag">${labels[i]}</div>`;
      const action = document.createElement("div");
      if (state.isHost && s.empty && !s.isAI) {
        const b = document.createElement("button");
        b.className = "btn-chip";
        b.type = "button";
        b.textContent = "Add AI";
        b.onclick = () => socket.emit("addAI", { seat: i });
        action.appendChild(b);
      } else if (state.isHost && s.isAI) {
        const b = document.createElement("button");
        b.className = "btn-chip";
        b.type = "button";
        b.textContent = "Remove";
        b.onclick = () => socket.emit("removeAI", { seat: i });
        action.appendChild(b);
      }
      li.appendChild(idx);
      li.appendChild(name);
      li.appendChild(action);
      list.appendChild(li);
    }
    const startBtn = $("#btn-start");
    startBtn.disabled = !state.isHost;
    $("#lobby-hint").textContent = state.isHost
      ? "Empty seats become AI when you start."
      : "Waiting for the host to start…";
  }

  // ================= Table =================
  function renderTable(view) {
    // Header
    const team = state.yourSeat % 2; // seats {0,2}=team 0, {1,3}=team 1
    const us = view.tokens?.[team] ?? 11;
    const them = view.tokens?.[team ^ 1] ?? 11;
    $("#score-us").textContent = us;
    $("#score-them").textContent = them;
    $("#phase-label").textContent = phaseLabel(view.phase);

    // Trump badge
    const tb = $("#trump-badge");
    if (view.trumpSuit) {
      tb.classList.remove("hidden");
      const sym = (Cards.SUIT_SYMBOL[view.trumpSuit] || "?");
      tb.querySelector(".tb-suit").textContent = sym;
      tb.classList.toggle("red", Cards.SUIT_COLOR[view.trumpSuit] === "red");
    } else {
      tb.classList.add("hidden");
    }

    // Bid badge
    const bb = $("#bid-badge");
    if (view.highBid) {
      bb.classList.remove("hidden");
      const amt = view.highBid.isCloseCaps ? "PCC" : Cards.displayPoints(view.highBid.amount * 10);
      $("#bid-amount").textContent = amt;
    } else {
      bb.classList.add("hidden");
    }

    // Trick tally
    const tally = $("#trick-tally");
    tally.querySelector(".tt-us").textContent = view.tricksWon?.[team] ?? 0;
    tally.querySelector(".tt-them").textContent = view.tricksWon?.[team ^ 1] ?? 0;

    renderSeats(view);
    renderTrick(view);
    renderMyHand(view);
    renderActionBar(view);
  }

  function phaseLabel(p) {
    return ({
      waiting: "Waiting",
      bid4: "Bidding (1st round)",
      trump_pick1: "Pick trump",
      bid8: "Bidding (2nd round)",
      trump_pick2: "Pick trump",
      open_choice: "Open or closed?",
      play: "Play",
      inspect: "Inspecting",
      hand_end: "Hand over",
      game_over: "Game over",
    }[p] || p || "");
  }

  function renderSeats(view) {
    // Map absolute seats to slot positions relative to you.
    // You: me. Counter-clockwise: next = (p+3)%4. From your seat,
    //   right opp = (you+3)%4, partner = (you+2)%4, left opp = (you+1)%4.
    const you = state.yourSeat;
    const slot = {
      me: you,
      right: (you + 3) % 4,
      partner: (you + 2) % 4,
      left: (you + 1) % 4,
    };
    const seatEls = document.querySelectorAll(".seat[data-seat-slot]");
    seatEls.forEach((el) => {
      const which = el.dataset.seatSlot;
      const seatIdx = slot[which];
      const info = view.seats?.[seatIdx] || {};
      const nameEl = el.querySelector(".seat-name");
      if (nameEl) nameEl.textContent = which === "me" ? "You" : (info.name || "—");

      const badge = el.querySelector(".seat-badge");
      if (badge) {
        const labels = [];
        let cls = "seat-badge";
        if (view.currentPlayer === seatIdx) { labels.push("turn"); cls += " turn"; }
        if (view.trumpMaker === seatIdx) { labels.push("maker"); cls += " maker"; }
        if (view.dealer === seatIdx) { labels.push("dealer"); cls += " dealer"; }
        if (labels.length) {
          badge.className = cls;
          badge.textContent = labels[0];
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      }

      // Opponent hand back-rendering
      const oppHand = el.querySelector(".opp-hand");
      if (oppHand && which !== "me") {
        oppHand.innerHTML = "";
        const n = view.handCounts?.[seatIdx] ?? 0;
        for (let i = 0; i < n; i++) oppHand.appendChild(Cards.back({ mini: true }));
      }
    });
  }

  function renderTrick(view) {
    const slots = {
      me: state.yourSeat,
      right: (state.yourSeat + 3) % 4,
      partner: (state.yourSeat + 2) % 4,
      left: (state.yourSeat + 1) % 4,
    };
    const slotEls = document.querySelectorAll(".trick-card");
    slotEls.forEach((el) => (el.innerHTML = ""));
    const played = view.currentTrick || [];
    for (const p of played) {
      let which;
      for (const k in slots) if (slots[k] === p.seat) which = k;
      if (!which) continue;
      const el = document.querySelector(`.trick-card[data-trick-slot="${which}"]`);
      if (!el) continue;
      let cardEl;
      if (p.hidden || (p.faceDown && !p.revealed)) {
        cardEl = Cards.facedown({ indicator: p.isTrumpIndicator });
      } else {
        cardEl = Cards.element(p.card, { indicator: p.isTrumpIndicator });
      }
      el.appendChild(cardEl);
    }
  }

  function renderMyHand(view) {
    const handEl = $("#my-hand");
    handEl.innerHTML = "";
    const hand = view.yourHand || [];
    const sorted = Cards.sortHand(hand, view.trumpSuit);
    const legalCardIds = getLegalCardIds(view);
    const isPlay = view.phase === "play";
    const isPick = view.phase === "trump_pick1" || view.phase === "trump_pick2";
    const indicatorId = view.trumpIndicator?.id;

    for (const c of sorted) {
      const el = Cards.element(c);
      const isIndicator = indicatorId && c.id === indicatorId;
      if (isIndicator) el.classList.add("trump-indicator");

      const canTap =
        (isPlay && view.currentPlayer === state.yourSeat && legalCardIds.has(c.id)) ||
        (isPick && view.currentPlayer === state.yourSeat);

      if (canTap) {
        el.classList.add("playable");
        el.tabIndex = 0;
        el.addEventListener("click", () => onCardTap(c, view));
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCardTap(c, view); }
        });
      } else if (isPlay && view.currentPlayer === state.yourSeat) {
        el.classList.add("unplayable");
      }

      if (state.selectedCardId === c.id) el.classList.add("selected");
      handEl.appendChild(el);
    }
  }

  function getLegalCardIds(view) {
    const set = new Set();
    const legal = view.legalActions || [];
    for (const a of legal) {
      if (a.type === "playCard" && Array.isArray(a.cardIds))
        a.cardIds.forEach((id) => set.add(id));
      if (a.type === "pickTrump" && Array.isArray(a.cardIds))
        a.cardIds.forEach((id) => set.add(id));
    }
    return set;
  }

  function onCardTap(card, view) {
    if (view.phase === "trump_pick1" || view.phase === "trump_pick2") {
      socket.emit("action", { type: "pickTrump", cardId: card.id });
      return;
    }
    if (view.phase !== "play") return;
    // Closed-game face-down discards: server marks the legal action with
    // faceDownRequired. We auto-faceDown when the card isn't lead-suit.
    const legal = (view.legalActions || []).find((a) => a.type === "playCard");
    const faceDown = legal?.faceDownRequired || false;
    socket.emit("action", { type: "playCard", cardId: card.id, faceDown });
  }

  // ================= Action bar =================
  function renderActionBar(view) {
    const prompt = $("#action-prompt");
    const controls = $("#action-controls");
    controls.innerHTML = "";
    const myTurn = view.currentPlayer === state.yourSeat;
    const legal = view.legalActions || [];

    // Prompt text
    prompt.classList.toggle("primary", myTurn);
    if (view.phase === "bid4" || view.phase === "bid8") {
      prompt.textContent = myTurn
        ? (view.phase === "bid4" ? "Your bid — min 160" : "Your bid — min 250 or pass")
        : seatName(view, view.currentPlayer) + " is bidding…";
    } else if (view.phase === "trump_pick1" || view.phase === "trump_pick2") {
      prompt.textContent = myTurn
        ? "Tap a card to set trump (placed face-down)"
        : "Trump maker is choosing…";
    } else if (view.phase === "open_choice") {
      prompt.textContent = myTurn ? "Declare open or keep closed?" : "Trump maker deciding…";
    } else if (view.phase === "play") {
      prompt.textContent = myTurn ? "Your turn — tap a card" : seatName(view, view.currentPlayer) + "'s turn";
    } else if (view.phase === "inspect") {
      prompt.textContent = myTurn ? "Inspect face-down cards" : "Inspecting…";
    } else if (view.phase === "hand_end") {
      prompt.textContent = describeHandEnd(view);
    } else if (view.phase === "game_over") {
      prompt.textContent = "Game over";
    } else if (view.phase === "waiting") {
      prompt.textContent = "Waiting…";
    }

    if (!myTurn) return;
    for (const a of legal) {
      if (a.type === "bid") renderBidChips(controls, a, view);
      else if (a.type === "pass") controls.appendChild(actionBtn("Pass", () => emit({ type: "pass" }), "btn-secondary"));
      else if (a.type === "askPartner") controls.appendChild(actionBtn("Ask partner", () => emit({ type: "askPartner" }), "btn-secondary"));
      else if (a.type === "demandRedeal") controls.appendChild(actionBtn("Redeal", () => emit({ type: "demandRedeal" }), "btn-secondary"));
      else if (a.type === "declareOpen") controls.appendChild(actionBtn("Open", () => emit({ type: "declareOpen" }), "btn-primary"));
      else if (a.type === "declareClosed") controls.appendChild(actionBtn("Closed", () => emit({ type: "declareClosed" }), "btn-secondary"));
      else if (a.type === "continue") controls.appendChild(actionBtn("Continue", () => emit({ type: "continue" }), "btn-primary"));
    }
  }

  function renderBidChips(parent, action, view) {
    const amounts = Array.isArray(action.amounts) ? action.amounts.slice() : [];
    const rare = new Set([190]); // de-emphasize per docs/DECISIONS.md
    const isPCCAllowed = !!action.canCloseCaps;

    // Always surface a Pass button if separately offered — handled elsewhere.
    for (const a of amounts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bid-chip";
      if (rare.has(a)) btn.classList.add("rare");
      btn.textContent = String(Cards.displayPoints(a * 10));
      btn.addEventListener("click", () => emit({ type: "bid", amount: a }));
      parent.appendChild(btn);
    }

    // Custom entry for odd amounts (e.g. 190 when truly wanted)
    const wrap = document.createElement("div");
    wrap.className = "bid-custom";
    const input = document.createElement("input");
    input.type = "number";
    input.min = action.min || (view.phase === "bid8" ? 250 : 160);
    input.step = 10;
    input.placeholder = "Other";
    input.setAttribute("inputmode", "numeric");
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn-chip";
    submit.textContent = "Bid";
    submit.addEventListener("click", () => {
      const v = Number(input.value);
      if (!v || v < input.min || v % 10 !== 0) return toast("Bid must be a multiple of 10");
      emit({ type: "bid", amount: v });
    });
    wrap.appendChild(input);
    wrap.appendChild(submit);
    parent.appendChild(wrap);

    if (isPCCAllowed) {
      parent.appendChild(actionBtn("PCC (all 8)",
        () => emit({ type: "bid", amount: 9999, isCloseCaps: true }),
        "btn-primary"));
    }
  }

  function actionBtn(label, onClick, cls = "btn-secondary") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function emit(payload) {
    socket.emit("action", payload);
  }

  function seatName(view, seat) {
    return view.seats?.[seat]?.name || `Seat ${seat}`;
  }

  function describeHandEnd(view) {
    const r = view.handResult;
    if (!r) return "Hand ended.";
    const maker = seatName(view, r.trumpMaker);
    const teamLabel = r.trumpMakerTeam === (state.yourSeat % 2) ? "your team" : "opponents";
    const verb = r.succeeded ? "made the bid" : "failed the bid";
    const bid = r.isCloseCaps ? "PCC" : Cards.displayPoints(r.bidAmount * 10);
    const pts = Cards.displayPoints(r.makerPoints);
    const hc = r.highCourt ? " (High court!)" : "";
    return `${teamLabel} ${verb} — bid ${bid}, got ${pts}${hc}.`;
  }

  // ================= Modal =================
  function openModal(title, content) {
    $("#modal-title").textContent = title;
    $("#modal-content").textContent = content;
    $("#modal-cancel").classList.add("hidden");
    if (typeof modal.showModal === "function") modal.showModal();
    else toast(content);
  }

  // ================= Helpers =================
  function shareURL() {
    const u = new URL(location.href);
    u.search = "?room=" + encodeURIComponent(state.roomId || "");
    u.hash = "";
    return u.toString();
  }
  function updateShareURL(roomId) {
    const u = new URL(location.href);
    u.searchParams.set("room", roomId);
    history.replaceState(null, "", u.toString());
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ================= Dispatch =================
  function applyView(view) {
    if (!view) return;
    state.lastView = view;
    if (view.yourSeat != null) state.yourSeat = view.yourSeat;
    if (view.roomId) state.roomId = view.roomId;
    state.isHost = state.yourSeat === 0;

    const p = view.phase;
    if (p === "waiting" || !p) {
      showView("lobby");
      renderLobby(view);
    } else {
      showView("table");
      renderTable(view);
    }

    // Show log (if any)
    if (view.log?.length) {
      const list = $("#log-list");
      list.innerHTML = "";
      for (const line of view.log.slice(-20)) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
    }
  }

  // ================= Menu / log drawer =================
  $("#btn-menu").addEventListener("click", () => {
    $("#log-drawer").classList.toggle("hidden");
  });
  $("#log-close").addEventListener("click", () => {
    $("#log-drawer").classList.add("hidden");
  });

  // Initial view
  showView("landing");
})();
