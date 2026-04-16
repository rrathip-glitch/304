# RUNBOOK — Operational Playbook

> Imperative, command-forward. Specific paths, specific commands, no fluff.
> For *why* something exists, see [`docs/SOUL.md`](SOUL.md) and
> [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). This file is for **doing**.

---

## 1. Local Development Loop

```bash
# From repo root
npm install
node server.js                    # listens on $PORT or 3000
```

Open `http://localhost:3000` on desktop (DevTools → 375×812) or on your
phone via the LAN IP.

Tail logs in-place — the server logs every `action` and `broadcastViews`
call to stdout. If you need persistent logs:

```bash
node server.js 2>&1 | tee /tmp/304.log
```

Kill stale processes (e.g. port already in use):

```bash
lsof -ti:3000 | xargs kill -9     # macOS / Linux
# or pick a different port:
PORT=3456 node server.js
```

Hot reload is **not** configured. Restart the process after server-side
edits. Client edits are picked up on browser refresh.

---

## 2. Smoke Test with Two Virtual Clients

Paste this into a terminal from the repo root after starting the server
on `:3000`. It spins up two `socket.io-client` sockets, creates a room,
joins it, starts the game, and logs the views for 5 seconds.

```bash
node -e '
const io = require("socket.io-client");
const URL = "http://localhost:3000";
const host = io(URL);
const guest = io(URL);

host.on("connect", () => {
  host.emit("createRoom", { name: "Host" }, (res) => {
    const code = res.roomCode;
    console.log("[host] room", code);

    guest.on("connect", () => {
      guest.emit("joinRoom", { code, name: "Guest" }, (r) => {
        console.log("[guest] joined", r && r.ok);
        host.emit("action", { type: "startGame" });
      });
    });
  });
});

host.on("view", (v)  => console.log("[host view]",  v.phase, v.message));
guest.on("view", (v) => console.log("[guest view]", v.phase, v.message));

setTimeout(() => { host.close(); guest.close(); process.exit(0); }, 5000);
'
```

Expected: both clients receive `view` events, the game advances through
`waiting → bid4 → …`. If only one receives views, the room-scoping
broadcast is wrong. If both are stuck in `waiting`, `startGame` was
rejected — check the server log.

For the canonical scripted flow see `test/run.js`.

---

## 3. Deploying to Railway

Railway watches the tracked branch and rebuilds on push via Nixpacks.

```bash
# From a feature branch
git push -u origin <branch>
```

Then:

1. Railway dashboard → the service → **Deployments** tab.
2. Watch the build log. Nixpacks detects Node 20, runs `npm install`,
   starts with `node server.js`.
3. Once deploy is green, hit the public URL:
   ```bash
   curl -s https://<your-app>.up.railway.app/health
   ```
   Expect `{"ok":true}` (or equivalent — see `server.js`).
4. Open the URL on a phone, create a room, share link, play.

### Roll back

**Option A — revert the bad commit:**
```bash
git revert <sha>
git push
```
Railway auto-deploys the revert.

**Option B — Railway UI:** Deployments → previous green deploy → **Redeploy**.

See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for Nixpacks config details.

---

## 4. Diagnosing "startGame → landing" / View-Render Bugs

Symptom: user clicks start, the UI snaps back to the landing screen or
renders a blank table.

1. Open DevTools → Console on the affected tab.
2. Look for red stack traces. The client installs a `window.onerror`
   handler that **toasts** unhandled errors in-app — check for a toast
   at the top of the screen.
3. Network tab → confirm `/socket.io/socket.io.js` returns **200**. We
   load this from a CDN in `public/index.html` to work around Railway
   static-routing; if the CDN URL is broken, the client never connects.
4. Network tab → WS frames. Confirm a `view` event arrived after
   `startGame`. If not, the server threw — check server logs for the
   stack.
5. Verify the incoming view has a `phase` other than `waiting`. If it's
   still `waiting`, the server-side `startGame` handler rejected (likely
   fewer than 4 seats filled + AI).

---

## 5. Diagnosing Stuck Phase (AI Doesn't Move, Turn Doesn't Advance)

1. Server log: is `broadcastViews` firing repeatedly with the same
   phase? That means the server scheduled an AI tick that can't resolve.
2. Inspect the view: `view.legalActions` for the active seat. If empty,
   `ai.chooseAction` returned `null` for that phase.
3. Open `src/engine/ai.js` and find the branch for `state.phase`. Most
   stuck-phase bugs are a missing phase handler or a guard that filters
   every candidate action out.
4. As a quick unblock, log the inputs in `ai.chooseAction`:
   ```js
   console.log('ai', state.phase, seat, legalActions(state, seat));
   ```
5. If the turn belongs to a disconnected human, a reconnect by name
   should restore the seat. Ask the user to refresh.

---

## 6. Adding a New Bid Convention or Rule

**Order matters. Skip a step and future agents will be confused.**

1. Update [`docs/RULES.md`](RULES.md) first — it is the source of truth.
   Cite the user message that established the rule.
2. Implement in `src/engine/game.js` (state machine + `applyAction` +
   `legalActions`).
3. Teach the AI in `src/engine/ai.js`. At minimum, ensure it doesn't
   emit an illegal action for the new case.
4. Update the UI in `public/client.js` (and `styles.css` if needed) so
   the new option is reachable on a 375×812 screen.
5. Append an entry to [`docs/DECISIONS.md`](DECISIONS.md): date,
   decision, alternatives considered, rationale.
6. Add a manual scenario to [`docs/TESTING.md`](TESTING.md).

---

## 7. Adding a New Action Type

Example: chat message, emoji reaction, "request undo".

1. Document the new event shape in [`docs/API.md`](API.md) **first** —
   name, payload, direction, validation rules.
2. Server: add a handler in `server.js` inside the socket-level handler
   block. Validate input, update room state, broadcast.
3. If the action is game-related, extend `legalActions(state, seat)`
   and `applyAction(state, action)` in `src/engine/game.js`.
4. Client: emit from `public/client.js` on the appropriate UI event,
   and render any resulting view change.
5. If the action has a legal-check the AI might encounter, stub it in
   `src/engine/ai.js` (even if the AI never uses it — AI must never
   emit an illegal action).

---

## 8. Schema / State-Shape Migrations

There are no migrations. Game state is **in-memory only** in `server.js`.
Server restart = all active games lost. This is accepted per
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

When you add a field to `GameState`:

- Initialise it in `createGame()` **and** in `startHand()` (per-hand
  fields reset every hand).
- Never rely on `undefined` — always give it an explicit default
  (`null`, `0`, `false`, `[]`, …). The view filter and the UI both
  branch on presence; `undefined` vs `null` has bitten us before.
- If the field is sensitive (e.g. private to one seat), add it to the
  view filter in `server.js` so it's stripped or masked before
  broadcast to the other seats.

---

## 9. On-Call / Incident Response

This is a hobby project. "On-call" = whoever's awake.

**Server down (Railway reports unhealthy):**

1. Railway dashboard → service → **Deployments** → latest → **View Logs**.
2. Find the crash stack. Common causes: unhandled promise rejection in
   a Socket.IO handler, a `null` dereference in `applyAction`.
3. Fast mitigation: redeploy the previous green deploy (UI → Redeploy).
4. Fix the root cause on a branch, push, confirm green, merge.

**Game stuck for a single user:**

1. Ask them to refresh the browser tab. The client auto-reconnects by
   name and rejoins the seat.
2. If the stuck state persists after refresh, see §5 above.
3. Last resort: ask the host to end the game and start a new room.

**Everyone disconnected from a room:**

- Rooms self-destruct after all humans have been gone > 10 minutes. Just
  create a new one.

---

## 10. Runbook for Agents Closing a Session

Do this **every time** before you stop:

1. `git status` — commit anything uncommitted with a message that
   explains *why*.
2. `git push -u origin <branch>` — this triggers a Railway redeploy;
   do not push broken builds.
3. Update [`docs/TASKS.md`](TASKS.md):
   - Tick completed items.
   - Add work you discovered but didn't finish.
   - Rewrite the **Next up** section so it's actionable from a cold read.
4. If you learned a rule, update [`docs/RULES.md`](RULES.md).
5. If you made a non-obvious choice, append to
   [`docs/DECISIONS.md`](DECISIONS.md).
6. Every `// TODO(soul):` marker in the code **must** have a matching
   entry in `docs/TASKS.md`. Orphaned markers are a bug.
7. Confirm the handoff ritual in [`docs/SOUL.md#6-handoff-ritual`](SOUL.md#6-handoff-ritual).

---

*This runbook is living. If you hit a situation not covered here and had
to figure it out, add a section. Future instances will thank you.*
