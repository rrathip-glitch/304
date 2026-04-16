// public/fx.js — Sound + haptic effects. Synthesized via Web Audio so we ship
// zero binary assets. Respects localStorage mute (p304.mute) and
// prefers-reduced-motion (for short pulses).

(function (global) {
  'use strict';

  const STORAGE_KEY = 'p304.mute';
  let muted = false;
  try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) {}

  let ctx = null;
  let unlocked = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  // iOS/Safari require a user-gesture to unlock audio. Call once from a tap.
  function unlock() {
    if (unlocked) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
  }

  function isMuted() { return muted; }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) {}
  }

  // Short tone. freq Hz, duration seconds, type: 'sine'|'triangle'|'square',
  // peakGain 0..1, attack s, release s, detuneSweep cents optional.
  function tone(opts) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const now = c.currentTime;
    const {
      freq = 440,
      dur = 0.12,
      type = 'sine',
      peak = 0.18,
      attack = 0.005,
      release = 0.08,
      sweepTo = null,
    } = opts || {};
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + release);
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + release + 0.02);
  }

  // Short noise burst for thud/swoosh.
  function noise(opts) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const { dur = 0.08, peak = 0.10, hp = 800, lp = 3000 } = opts || {};
    const now = c.currentTime;
    const bufSize = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (hp + lp) / 2;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  // ---- Semantic effects ----
  const fx = {
    cardPlay() {
      noise({ dur: 0.06, peak: 0.09, hp: 600, lp: 2200 });
      tone({ freq: 320, dur: 0.05, peak: 0.06, type: 'triangle' });
    },
    cardDeal() { tone({ freq: 520, dur: 0.04, peak: 0.07, type: 'triangle' }); },
    trickWon() {
      tone({ freq: 523, dur: 0.10, peak: 0.12, type: 'sine' });
      setTimeout(() => tone({ freq: 784, dur: 0.12, peak: 0.14, type: 'sine' }), 80);
    },
    bidPlaced() { tone({ freq: 660, dur: 0.10, peak: 0.10, type: 'triangle' }); },
    yourTurn() { tone({ freq: 880, dur: 0.09, peak: 0.08, type: 'sine' }); },
    illegal() { tone({ freq: 180, dur: 0.15, peak: 0.14, type: 'square', sweepTo: 120 }); },
    gameOver() {
      tone({ freq: 523, dur: 0.14, peak: 0.14, type: 'sine' });
      setTimeout(() => tone({ freq: 659, dur: 0.14, peak: 0.14, type: 'sine' }), 140);
      setTimeout(() => tone({ freq: 784, dur: 0.22, peak: 0.16, type: 'sine' }), 280);
    },
    tokenTransfer() { tone({ freq: 440, dur: 0.06, peak: 0.08, type: 'triangle' }); },
  };

  // Haptics. Vibrate API; iOS Safari ignores — that's OK.
  function vibrate(pattern) {
    if (muted) return;
    if (!global.navigator || typeof global.navigator.vibrate !== 'function') return;
    try { global.navigator.vibrate(pattern); } catch (e) {}
  }
  const haptic = {
    tap()       { vibrate(10); },
    trickWon()  { vibrate([0, 30, 40, 30]); },
    yourTurn()  { vibrate(18); },
    illegal()   { vibrate([0, 50, 40, 50]); },
    gameOver()  { vibrate([0, 60, 80, 60, 80, 60]); },
  };

  global.FX = {
    unlock, isMuted, setMuted,
    sound: fx, haptic,
  };
})(window);
