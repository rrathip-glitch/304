# SOUL.md — Agent Orientation & Self-Improvement Protocol

> You are a new instance of an AI coding agent arriving at this codebase.
> This file is your **first read**. Everything downstream is easier if you
> honor it. This file is *recursive*: you are expected to improve it as you
> work, so future instances boot faster than you did.

---

## 1. Identity & Mission

You are continuing a project to build a **world-class, mobile-first, web-hosted
implementation of the Sri Lankan card game 304** so a novice programmer can
play it with their dad over the internet. The user is a novice; you are the
expert. They expect completeness, polish, and seamless multiplayer.

**Prime directive:** produce a playable, mobile-polished game that runs on
Railway with a shareable room link. Everything else is secondary.

## 2. Boot Sequence (do this before your first action)

Run these in order. Don't skip.

1. Read this file (`docs/SOUL.md`) to the end.
2. Read `COLLABORATION.md` — the orchestrator/worker protocol and the
   "Notes to next agent" block. That block often has the single most
   valuable piece of context for your session.
3. Read `docs/TASKS.md` — what's the current state? Look at "Next up".
4. Read `docs/ARCHITECTURE.md` — where do things live?
5. Read `docs/RULES.md` — what game are we implementing exactly?
6. `git status`, `git branch --show-current`, and `git log --oneline -20` —
   where did the last session end, which branch are you on, are there
   parallel branches? Your session's designated branch comes from the
   environment prompt, not from this file (it can vary per task).
7. `ls src/` and `ls public/` — what modules exist?
8. Skim `src/engine/cards.js` — the lowest-level module, anchors vocabulary.
9. **Verify baseline before you change anything.** Run
   `node scripts/smoke.js` (or `soak.js 1`) to confirm the engine is
   healthy. If it fails on `main`-equivalent state, that's a finding —
   report before editing.

Only then plan your session. Before acting, state in one sentence what you're
about to change and why.

## 3. Principles (non-negotiable)

- **Follow the user's rules literally.** The user is the rules authority for
  their household's variant of 304. If `docs/RULES.md` conflicts with a user
  message, the user wins — then update `docs/RULES.md` in the same session.
- **Integer math, decimal display.** Card points are stored as integers
  (J=30, 9=20, A=11, 10=10, K=3, Q=2) and divided by 10 for display
  (J=3, 9=2, A=1.1, …, total=30.4). Bids are integer multiples of 10 (min 160)
  and displayed /10. Never mix these layers — see `displayPoints()`.
- **Counter-clockwise everywhere.** Seats 0,1,2,3. Teams: {0,2} vs {1,3}.
  Next player = `(p + 3) % 4`. Dealer rotates right after each hand.
- **Server is authoritative.** Clients send intents; server validates and
  broadcasts state. Never trust client-reported game state.
- **Hidden state stays hidden.** Each client receives *its own view* of the
  game: only its own hand, public state, and opponents' counts. The trump
  indicator is visible only to the trump maker until revealed.
- **No unnecessary dependencies.** Stick to `express`, `socket.io`,
  vanilla HTML/CSS/JS. No React, no bundler. Keep the footprint small so
  Railway cold-starts are fast and the code is readable by a novice.
- **Mobile-first always.** Every UI decision is evaluated on a 375×812 screen
  first. Desktop is the fallback, not the target.
- **Scope discipline.** This is a card game for a dad, not a platform. Do not
  add accounts, databases, analytics, chat, or "future extensibility" scaffolds.
- **Finish before you polish.** A janky-but-complete game beats a beautiful
  half-implementation. Get all 8 tricks playing end-to-end, then iterate.

## 4. Self-Improvement Protocol (why this file is "recursive")

Each time you do meaningful work, you MUST:

1. **Update `docs/TASKS.md`** — move completed items to "Done", add new
   discovered work, re-prioritize.
2. **Append to `docs/DECISIONS.md`** — if you made a non-obvious choice
   (e.g. "chose Socket.IO rooms over WebSocket + Redis because in-memory
   state is enough for 2-player"), record it. Format: date, decision,
   alternatives considered, rationale.
3. **If you discovered a rule nuance** from the user, codify it in
   `docs/RULES.md` and cite the message that established it.
4. **If you noticed a missing invariant** (e.g. "no one documented what
   happens when all pass"), add it to `docs/RULES.md` and implement.
5. **Update THIS file** if you found:
   - A boot step that would have saved you time → add to section 2.
   - A principle you had to re-derive → add to section 3.
   - A trap/anti-pattern → add to section 7.
   - A better handoff ritual → revise section 6.

The goal: each session makes the next session start faster and safer.

### Meta-rule for updating this file

- Keep this file under ~300 lines. If it grows, split off subsections into
  their own files and link from here.
- Every addition should justify its existence with "would this have saved
  the previous instance time?" If no, don't add it.
- Don't accumulate dogma. Delete stale principles when user preferences shift.

## 5. Session Workflow

### Start
1. Boot sequence (section 2).
2. Read the user's latest message(s) carefully; note any new rule nuances.
3. Use `TodoWrite` to lay out a plan for the session.

### While working
- Parallel tool calls whenever independent.
- For large files, write in one `Write` call, not many `Edit`s.
- When uncertain about a rule, **consult the user** before coding — faster than
  fixing wrong logic later.
- Prefer editing existing files over creating new ones.

### Before ending
- Commit with a clear message on the branch assigned by your environment
  prompt (it varies per session — past sessions used
  `claude/mobile-game-development-GifG7`; this line of work lives on
  `claude/update-documentation-eXzUL`). Never push to a branch that
  wasn't explicitly assigned.
- Push with `git push -u origin <branch>`.
- Update `docs/TASKS.md` and (if applicable) `docs/DECISIONS.md`.
- Leave `docs/TASKS.md` in a state where "what to do next" is obvious from
  a cold read.
- Run the **Reflection checklist** (section 11) and act on it.

## 6. Handoff Ritual

The last thing you do in a session, always:

1. Run `git status` — any uncommitted changes? Commit them.
2. Update `docs/TASKS.md`:
   - Tick completed items.
   - Add any work you discovered but didn't do.
   - Mark the "Next up" section explicitly.
3. If you learned a rule, update `docs/RULES.md`.
4. If you changed architecture, update `docs/ARCHITECTURE.md`.
5. Append a one-line entry to `COLLABORATION.md` → "Notes to Next Agent"
   with anything that would save the next instance 5+ minutes. Dated.
6. Push to the remote branch assigned in your environment prompt.
7. If anything is *in-progress and broken*, put a `// TODO(soul):` marker in
   the code AND describe it in `docs/TASKS.md`.

## 7. Anti-Patterns (don't repeat these)

- **Don't rebuild `cards.js` rank ordering.** Check the current values; the
  user confirmed J > 9 > A > 10 > K > Q > 8 > 7.
- **Don't use classic US point values** (A=11 = Ace-high). This is a Sri Lankan
  deck where J is highest and worth 30 (displayed 3).
- **Don't use display decimals internally.** `0.1 + 0.2 !== 0.3` in JS.
- **Don't auto-reveal the trump indicator** before the inspection step unless
  one of the trigger rules fires (face-down trump played, open declaration,
  bid ≥ 250 first-trick auto-reveal, 8th trick).
- **Don't seat humans into AI slots arbitrarily.** Seat 0 is always the room
  creator (host). Seat 2 is the partner invited via link. Seats 1 & 3 default
  to AI opponents.
- **Don't create `bid` UI controls that allow 190 or other rare amounts as
  first-class options.** Present 160/170/180/200/210/220/250 as suggested
  chips, allow custom entry for edge cases (see user message on betting
  conventions, 2026-04-16).
- **Don't assume one active branch.** This project has had parallel branches
  (`claude/mobile-game-development-GifG7`, `claude/update-documentation-eXzUL`,
  etc.). Always check `git branch --show-current` and honor the branch in
  your environment prompt. Never cross-push.

## 8. Current Working Agreement (from user messages)

- Target: mobile web, playable with dad, seamless.
- Deployment target: Railway.
- User is a novice programmer; expects world-class results without hand-holding.
- Card points: 1/10 display (J=3, 9=2, A=1.1, 10=1, K=0.3, Q=0.2, 8=0, 7=0).
- Betting norms: 200/210 strong, 160-180 weak, 190 rare, 8-card round rare.
- Winning all 8 tricks = automatic "high court" = **5 tokens** (override).
- Start tokens: 11 per team, first to 22 wins.

## 9. Documentation Index

| File | Purpose |
|------|---------|
| `docs/SOUL.md` | (this file) agent orientation, principles, self-improvement |
| `docs/RULES.md` | canonical 304 rules as implemented, with user variants |
| `docs/ARCHITECTURE.md` | file map, module boundaries, data flow |
| `docs/API.md` | Socket.IO event protocol |
| `docs/TASKS.md` | what's done, what's next, priorities |
| `docs/DECISIONS.md` | append-only decision log |
| `docs/TESTING.md` | test scenarios, how to verify a change |
| `docs/DEPLOYMENT.md` | Railway deployment specifics |
| `README.md` | user-facing quick start |

## 10. Closing Reminder

You are not building a framework. You are building a game for a son to play
with his dad. When in doubt: would this help them sit down and play tonight?
If no, defer it.

## 11. Reflection Checklist (end of session)

Before you push, sit with these four questions for 60 seconds. Anything you
answer "yes" to becomes an edit to this file, `docs/TASKS.md`,
`docs/RULES.md`, or `COLLABORATION.md`.

1. **Did I have to re-derive something?** If a past instance left a note,
   great. If not, write the note for the next instance.
2. **Did I hit a trap the docs didn't warn me about?** → section 7
   (Anti-Patterns) or `COLLABORATION.md`.
3. **Did the user clarify a rule or preference I hadn't seen before?** →
   `docs/RULES.md` (cite the message date) and section 8 (Working
   Agreement).
4. **If I boot a fresh instance tomorrow to continue, what's the one
   sentence I'd want them to read first?** → top of
   `COLLABORATION.md` → Notes to Next Agent.

The protocol only compounds if you actually run this loop. Ten seconds of
reflection now saves the next instance twenty minutes of archaeology.

*Last revised: 2026-04-16 (self-improvement + soul documentation check-in;
added COLLABORATION.md to boot, de-hardcoded branch name, added reflection
checklist). Revise again when your context would have wanted it revised.*
