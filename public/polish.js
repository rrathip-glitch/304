/* public/polish.js — additive polish: SFX + deal/play/tricks animations.
 *
 * Attaches to the client purely via DOM observation. Does NOT touch
 * client.js or socket state. If this file is removed, the game still
 * works; the only loss is polish.
 *
 * What it adds:
 *   • WebAudio SFX (tiny beep-like tones, no audio files) for
 *     card play, trick won, your-turn start, and error toasts.
 *     Muted by default until a first user gesture (browser policy),
 *     then persists in localStorage. Toggle with `304.sfx.toggle()`
 *     or by adding `?sfx=0` to the URL.
 *   • `.just-dealt` class on newly-appearing hand cards to fire the
 *     deal animation in polish.css.
 *   • `.just-played` class on newly-appearing trick cards.
 *   • `.pip-gain` / `.pip-loss` animation classes when token pip
 *     counts change.
 *   • A transient "trick won" banner when the phase goes to inspect.
 */

(function () {
  'use strict';

  // ---------- Settings ----------
  const urlParams = new URLSearchParams(location.search);
  const disabledByURL = urlParams.get('sfx') === '0';
  const stored = localStorage.getItem('p304.sfx');
  let sfxEnabled = !disabledByURL && stored !== 'off';

  // ---------- WebAudio helpers ----------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try {
      audioCtx = new C();
    } catch (e) {
      return null;
    }
    return audioCtx;
  }
  // User-gesture unlock (iOS Safari won't play audio until then)
  function unlock() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    document.removeEventListener('touchstart', unlock, true);
    document.removeEventListener('mousedown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('touchstart', unlock, { capture: true, once: true });
  document.addEventListener('mousedown', unlock, { capture: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, once: true });

  function beep({ freq = 440, duration = 0.08, type = 'sine', volume = 0.08, attack = 0.005, release = 0.05 } = {}) {
    if (!sfxEnabled) return;
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.linearRampToValueAtTime(0, t + duration + release);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + release + 0.01);
  }

  // Pre-canned cues
  const SFX = {
    cardPlay:  () => beep({ freq: 520, duration: 0.04, type: 'triangle', volume: 0.07 }),
    cardDeal:  () => beep({ freq: 380, duration: 0.03, type: 'triangle', volume: 0.04 }),
    trickWon:  () => {
      beep({ freq: 660, duration: 0.09, type: 'sine', volume: 0.08 });
      setTimeout(() => beep({ freq: 880, duration: 0.12, type: 'sine', volume: 0.08 }), 70);
    },
    yourTurn:  () => beep({ freq: 700, duration: 0.08, type: 'sine', volume: 0.06 }),
    error:     () => beep({ freq: 220, duration: 0.16, type: 'sawtooth', volume: 0.05 }),
    gameOver:  () => {
      beep({ freq: 880, duration: 0.2, volume: 0.08 });
      setTimeout(() => beep({ freq: 660, duration: 0.2, volume: 0.08 }), 180);
      setTimeout(() => beep({ freq: 990, duration: 0.36, volume: 0.1 }), 360);
    },
  };

  // ---------- DOM observers ----------

  // 1. New cards appearing in #your-hand → add `.just-dealt`.
  //    Keep track of prior card ids so "new" means cards that weren't in
  //    the previous render.
  const yourHandEl = () => document.getElementById('your-hand');
  let lastHandIds = new Set();
  function flagNewHand() {
    const el = yourHandEl();
    if (!el) return;
    const current = Array.from(el.querySelectorAll('.card'));
    const currentIds = new Set(current.map((c) => c.dataset.cardId || ''));
    const brandNew = current.filter((c) => !lastHandIds.has(c.dataset.cardId || ''));
    if (brandNew.length > 0 && lastHandIds.size === 0) {
      // Initial render — stagger the deal animation with delays.
      brandNew.forEach((c, i) => {
        c.classList.add('just-dealt');
        c.style.setProperty('--deal-delay', (i * 60) + 'ms');
        setTimeout(() => c.classList.remove('just-dealt'), 360 + i * 60 + 20);
        setTimeout(SFX.cardDeal, i * 60);
      });
    } else if (brandNew.length >= 3) {
      // A second batch (trump maker getting their 4-card second deal etc.)
      brandNew.forEach((c, i) => {
        c.classList.add('just-dealt');
        c.style.setProperty('--deal-delay', (i * 60) + 'ms');
        setTimeout(() => c.classList.remove('just-dealt'), 360 + i * 60 + 20);
        setTimeout(SFX.cardDeal, i * 60);
      });
    }
    lastHandIds = currentIds;
  }

  // 2. A card appearing in .trick-card → SFX + `.just-played`.
  const trickEl = () => document.getElementById('trick');
  let lastTrickCardsCount = 0;
  function onTrickChange() {
    const el = trickEl();
    if (!el) return;
    const cards = el.querySelectorAll('.trick-card .card');
    if (cards.length > lastTrickCardsCount) {
      // New card appeared — animate + sound
      const newest = cards[cards.length - 1];
      if (newest) newest.classList.add('just-played');
      SFX.cardPlay();
    } else if (cards.length === 0 && lastTrickCardsCount > 0) {
      // Trick was cleared → winner resolved. Pulse a banner briefly.
      showTrickWonBanner();
      SFX.trickWon();
    }
    lastTrickCardsCount = cards.length;
  }

  function showTrickWonBanner() {
    const host = document.querySelector('.play-area');
    if (!host) return;
    // Avoid stacking banners
    const old = host.querySelector('.trick-won-banner');
    if (old) old.remove();
    const div = document.createElement('div');
    div.className = 'trick-won-banner';
    div.textContent = 'Trick taken';
    host.appendChild(div);
    setTimeout(() => div.remove(), 1900);
  }

  // 3. Token pip changes → pulse
  const pipsEls = () => [
    document.getElementById('pips-0'),
    document.getElementById('pips-1'),
  ];
  let lastPipsCount = [null, null];
  function onPipsChange() {
    const els = pipsEls();
    for (let team = 0; team < 2; team++) {
      const el = els[team];
      if (!el) continue;
      const n = el.querySelectorAll('.pip').length;
      if (lastPipsCount[team] != null && n !== lastPipsCount[team]) {
        const gained = n > lastPipsCount[team];
        const pips = el.querySelectorAll('.pip');
        pips.forEach((p) => {
          p.classList.add(gained ? 'pip-gain' : 'pip-loss');
          setTimeout(() => p.classList.remove('pip-gain', 'pip-loss'), 700);
        });
      }
      lastPipsCount[team] = n;
    }
  }

  // 4. Your-turn detection via phase banner class
  const phaseBannerEl = () => document.getElementById('phase-banner');
  let wasYourTurn = false;
  function onPhaseChange() {
    const el = phaseBannerEl();
    if (!el) return;
    const yt = el.classList.contains('your-turn');
    if (yt && !wasYourTurn) SFX.yourTurn();
    wasYourTurn = yt;
  }

  // ---------- Observer wiring ----------
  const observer = new MutationObserver((mutations) => {
    let handChanged = false;
    let trickChanged = false;
    let pipsChanged = false;
    let phaseChanged = false;
    for (const m of mutations) {
      const target = m.target;
      if (!(target instanceof Element)) continue;
      if (target.id === 'your-hand' || target.closest('#your-hand')) handChanged = true;
      if (target.id === 'trick' || target.closest('#trick')) trickChanged = true;
      if ((target.classList && target.classList.contains('pips')) || target.closest('.pips')) pipsChanged = true;
      if (target.id === 'phase-banner' || (target.closest && target.closest('#phase-banner'))) phaseChanged = true;
    }
    if (handChanged) flagNewHand();
    if (trickChanged) onTrickChange();
    if (pipsChanged) onPipsChange();
    if (phaseChanged) onPhaseChange();
  });

  function startObserver() {
    const app = document.getElementById('app');
    if (!app) return;
    observer.observe(app, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    // Initial snapshot
    flagNewHand();
    onTrickChange();
    onPipsChange();
    onPhaseChange();
  }

  // ---------- Toast error SFX ----------
  // The client shows a toast for action errors; hook into its class change
  // to play an error tone.
  function watchToast() {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const tObs = new MutationObserver(() => {
      if (!toast.classList.contains('hidden')) SFX.error();
    });
    tObs.observe(toast, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- Public API for debugging / toggling ----------
  window['304'] = window['304'] || {};
  window['304'].sfx = {
    toggle() {
      sfxEnabled = !sfxEnabled;
      try { localStorage.setItem('p304.sfx', sfxEnabled ? 'on' : 'off'); } catch (e) {}
      return sfxEnabled;
    },
    isOn() { return sfxEnabled; },
    play(name) { if (SFX[name]) SFX[name](); },
  };

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startObserver(); watchToast(); });
  } else {
    startObserver();
    watchToast();
  }
})();
