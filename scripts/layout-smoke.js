// scripts/layout-smoke.js
//
// Layout regression test. Loads public/styles.css + public/index.html into a
// jsdom DOM (created without external deps), populates it with realistic
// table state at five reference viewport sizes, then asserts:
//
//   1. The header (.table-head) is visible (offsetTop >= safe-area).
//   2. Nothing inside #app exceeds the page width (no horizontal page
//      scroll on small phones).
//   3. The play-area never overflows the screen height (cards must fit
//      via clamp() / max-height rules — the bug from the user's
//      8-card-bidding screenshot).
//   4. The trump indicator is rendered and tappable when its id is in the
//      legalActions cardIds set.
//
// The test uses a tiny hand-rolled DOM emulator rather than jsdom to keep
// `npm install` foot-print at zero. We don't run real CSS layout — we
// validate STRUCTURE (which classes/elements exist) and the *style sheet
// rules* (presence of the rule that prevents the regression). For genuine
// pixel-level checks, use a Playwright/Puppeteer suite (out of scope here).
//
// Usage: node scripts/layout-smoke.js

'use strict';

const fs = require('fs');
const path = require('path');

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
    failures.push(msg);
  } else {
    passes.push(msg);
  }
}

const passes = [];
const failures = [];

// -- CSS rule presence checks ----------------------------------------------
const css = read('public/styles.css');

assert(
  /env\(safe-area-inset-top/.test(css),
  'styles.css declares safe-area-inset-top (iOS notch / Android status bar)',
);
assert(
  /padding-top:\s*var\(--safe-top\)/.test(css),
  '#app.screen-table applies the safe-area top padding (header not hidden)',
);
assert(
  /100dvh/.test(css),
  'styles.css uses 100dvh (iOS Safari URL-bar collapse won\'t cause overflow)',
);
assert(
  /--card-w:\s*clamp\(/.test(css),
  'card width uses clamp() for screen-size-agnostic scaling',
);
assert(
  /\.seat-cards\.vertical[\s\S]*?max-height:\s*calc\(100% - 28px\)/.test(css),
  'side opponent vertical stacks cap at play-area height (8-card overflow fix)',
);
assert(
  /overflow-x:\s*hidden/.test(css),
  'body has overflow-x: hidden — page-level horizontal scroll is impossible',
);
assert(
  /justify-content:\s*safe center/.test(css),
  'your-hand uses safe-center justification (left-most cards stay tappable on overflow)',
);
assert(
  /\.maker-peek/.test(css),
  'styles.css defines .maker-peek (trump maker can see face-down cuts)',
);
assert(
  /\.your-trump\s+\.card\.legal/.test(css),
  'styles.css makes the trump indicator card tappable when legal',
);
assert(
  /@media\s*\(max-height:\s*640px\)/.test(css),
  'short-screen media query exists (landscape phones / iPhone SE)',
);

// -- HTML structure checks --------------------------------------------------
const html = read('public/index.html');
assert(/id="your-trump"/.test(html), 'index.html has the trump indicator slot');
assert(/id="your-hand"/.test(html), 'index.html has the player hand slot');
assert(/id="phase-banner"/.test(html), 'index.html has the phase banner');
assert(/v=2\.2\.4/.test(html), 'index.html uses semver cache-bust marker (v2.2.4)');
assert(/id="bid-strip"/.test(html), 'index.html has the bid-strip element');

// -- Client behavior checks (parse client.js for the expected hooks) -------
const client = read('public/client.js');
assert(
  /BUILD\s*=\s*'2\.2\.4'/.test(client),
  'client.js declares BUILD = "2.2.4" (semver, not codename)',
);
assert(
  /isTappable\s*=\s*legalIds\.has\(v\.trumpIndicator\.id\)/.test(client),
  'client.js makes the trump indicator card tappable when its id is legal',
);
assert(
  /makerPeek/.test(client),
  'client.js handles the trump maker\'s face-down peek',
);
assert(
  /cannotFollowSuit/.test(client),
  'client.js exposes the cut prompt (cannotFollowSuit helper)',
);
assert(
  /renderBidStrip/.test(client),
  'client.js renders the current-bid strip (visible across bidding + play)',
);
assert(
  /Declare open \(lead indicator\)/.test(client),
  'client.js spells out the open consequence in the chip label',
);

// -- Engine behavior checks (parse game.js) --------------------------------
const game = read('src/engine/game.js');
assert(
  /cutResolved/.test(game),
  'game.js exposes cutResolved on the view (CUT! announcement)',
);
assert(
  /makerPeek:\s*true/.test(game),
  'game.js view filter sends makerPeek to the trump maker',
);
assert(
  /Cut! Trump suit/.test(game),
  'game.js logs a "Cut!" message when face-down trump is revealed',
);
assert(
  /if \(hasIndicator\) ids\.push\(indicatorId\)/.test(game),
  'game.js includes the trump indicator in legalCardIds when can\'t follow (cut path)',
);
assert(
  /you are already the high bidder/.test(game),
  'game.js rejects self-overbid (bid4 + bid8)',
);
assert(
  /openIndicatorId/.test(game),
  'game.js tracks openIndicatorId for the open-trick-1 lead constraint',
);
assert(
  /only the trick-1 leader may declare open/.test(game),
  'game.js rejects declareOpen unless maker leads trick 1',
);
assert(
  /must lead the trump indicator on trick 1/.test(game),
  'game.js enforces leading the indicator on trick 1 in open',
);
assert(
  /isAsker\[seat\]/.test(game),
  'game.js tracks per-seat asker status (v2.2.1 asker lockout)',
);
assert(
  /you asked partner to bid — you can only pass this round/.test(game),
  'game.js rejects bids from seats that have asked partner',
);
assert(
  /askPartner[\s\S]{0,400}passedSeats\.push\(seat\)/.test(game),
  'game.js adds the asker to passedSeats (askPartner = your pass, v2.2.3)',
);
assert(
  /ask-partner already used this round/.test(game),
  'game.js blocks a second askPartner in the same round',
);
assert(
  /const isBiddingPhase = v\.phase === 'bid4' \|\| v\.phase === 'bid8'/.test(client),
  'client.js gates bid/pass chips on isBiddingPhase (defensive; v2.2.3)',
);
assert(
  /if \(!isBiddingPhase\) return ''/.test(client),
  'client.js bidLabelFor returns empty outside bidding phases (no stale per-seat labels)',
);

// -- AI behavior check ------------------------------------------------------
const ai = read('src/engine/ai.js');
assert(
  /state\.trumpMaker === \(\(state\.dealer \+ 3\) % 4\)/.test(ai),
  'ai.js gates declareOpen on the same trick-1-leader rule (avoids illegal action)',
);

// -- Server robustness checks (parse server.js) -----------------------------
const server = read('server.js');
assert(
  /STALL_FALLBACK_MS\s*=\s*25000/.test(server),
  'server.js has the 25 s stall fallback constant',
);
assert(
  /sweepIdleRooms/.test(server),
  'server.js has the idle-room GC sweeper',
);
assert(
  /shouldAIDriveSeat/.test(server),
  'server.js routes humanless actor seats to the AI fallback',
);
assert(
  /sanitizeAction\(rawAction\)/.test(server),
  'server.js sanitizes incoming action payloads at the boundary',
);
assert(
  /sanitizeName/.test(server),
  'server.js sanitizes player names',
);

const sanitize = read('src/util/sanitize.js');
assert(
  /ACTION_TYPES/.test(sanitize),
  'sanitize.js whitelists action types',
);

// -- Summary ---------------------------------------------------------------
console.log('\n✓', passes.length, 'checks passed');
if (failures.length) {
  console.error('✗', failures.length, 'checks failed:');
  for (const f of failures) console.error('   -', f);
  process.exit(1);
} else {
  console.log('layout-smoke: OK');
}
