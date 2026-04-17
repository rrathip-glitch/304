// Boundary input hardening. Every payload that arrives from the network
// MUST pass through one of these before reaching engine code or being
// used for routing. Pure functions (no I/O) so they're trivially testable.

'use strict';

const ACTION_TYPES = new Set([
  'bid', 'pass', 'askPartner', 'demandRedeal',
  'pickTrump', 'declareOpen', 'declareClosed',
  'playCard', 'continue',
]);

function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 24);
  return cleaned || 'Player';
}

function sanitizeAction(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) return null;
  const out = { type: a.type };
  if (a.type === 'bid') {
    if (typeof a.amount !== 'number' || !Number.isFinite(a.amount)) return null;
    out.amount = a.amount | 0;
  }
  if (a.type === 'pickTrump' || a.type === 'playCard') {
    if (typeof a.cardId !== 'string' || a.cardId.length > 8) return null;
    out.cardId = a.cardId;
  }
  if (a.type === 'playCard') {
    out.faceDown = a.faceDown === true;
  }
  return out;
}

module.exports = { sanitizeName, sanitizeAction, ACTION_TYPES };
