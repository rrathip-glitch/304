# Deployment — Railway

## TL;DR

```bash
git push origin claude/mobile-game-development-GifG7
# Railway auto-builds via Dockerfile and rolls the deployment in ~60 s.
curl https://<your-app>.up.railway.app/version
# → {"version":"<package.json#version>","startedAt":"<ISO timestamp>"}
```

If `version` matches `package.json#version`, you're live. If not, see
[Troubleshooting redeploys](#troubleshooting-redeploys).

---

## The watched branch

Railway watches **`claude/mobile-game-development-GifG7`**. Every push to
that branch triggers a build. Feature work happens on a child branch
(e.g. `claude/fix-layout-cutting-mechanic-kepuN`); you ship by merging
the child branch into the watched branch and pushing.

This is configured in **Railway → service → Settings → Source → Branch**.
`railway.json` does NOT control which branch is watched — only the
dashboard does.

```
feature work    →    push child branch    →    merge into watched    →    push watched    →    deploy
       ↑                                                                                          │
       └── (verify locally with the test suite first; see TESTING.md) ──────────────────────────┘
```

## Initial setup (one-time)

1. In Railway → **New Project** → **Deploy from GitHub repo** → pick
   the repo.
2. **Settings → Source → Branch** → set to
   `claude/mobile-game-development-GifG7` (or whichever branch you want
   auto-deployed).
3. **Settings → Build → Builder** should show **DOCKERFILE** (read from
   `railway.json`). If it shows Nixpacks, override to Dockerfile.
4. Environment variables: **none required**. Railway injects `PORT`.
5. **Settings → Networking → Generate Domain** → you get a
   `*.up.railway.app` URL. Open it on your phone, create a room, share
   the link with your dad.

## Release procedure (every shipped change)

Run from the repo root, working on a feature branch:

```bash
# 1. Verify locally — all seven must be green.
node scripts/layout-smoke.js
node scripts/cut-test.js
node scripts/bid-test.js
node scripts/robust-test.js
node scripts/smoke.js
node scripts/soak.js 5
node scripts/e2e.js

# 2. Bump version IF the change is user-visible or protocol-affecting.
#    Edit package.json#version (semver). Sync the value into:
#      - public/index.html (build marker + ?v= cache-bust query strings
#        + dbg-build element)
#      - public/client.js (BUILD constant)
#      - scripts/layout-smoke.js (the /v=X.Y.Z/ and /BUILD = 'X.Y.Z'/
#        regex literals)
#    layout-smoke.js will fail loudly if ANY of these drift.

# 3. Commit + push the feature branch.
git push origin <feature-branch>

# 4. Merge into the watched branch and push to trigger Railway.
git checkout claude/mobile-game-development-GifG7
git merge <feature-branch> --no-edit
git push origin claude/mobile-game-development-GifG7

# 5. Verify the deploy.
curl https://<domain>/version
# Expected: {"version":"<your-new-version>","startedAt":"..."}
```

The browser will pull a fresh `client.js` because the `?v=<version>`
query string changed. iOS Safari otherwise caches `client.js`
indefinitely — this is the *only* mechanism that beats that cache, so
do not skip the version bump for client-affecting changes.

## How the build works

- **`Dockerfile`** uses `node:20-alpine`. Copies `package.json` +
  `package-lock.json` first (for layer caching), runs `npm ci
  --omit=dev`, then copies the project, `EXPOSE 3000`, and runs
  `node server.js`.
- **`railway.json`** pins `"builder": "DOCKERFILE"` so Railway always
  uses the Dockerfile (Nixpacks heuristics are skipped).
- **`server.js`** binds to `process.env.PORT || 3000`. Railway sets `PORT`
  for you.
- **Static assets** (`public/`) are served by Express with
  `Cache-Control: public, max-age=60, must-revalidate` for `.js`/`.css`
  and `no-cache` for `index.html`. The `?v=<version>` query string in
  `index.html` is the belt; the per-file ETag is the suspenders.
- **`/health`** returns `200 ok` (in-process, not cached). Used by
  `railway.json#deploy.healthcheckPath`.
- **`/version`** returns `{ version, startedAt }`. The single source of
  truth for "is my deploy live yet?".

## Troubleshooting redeploys

If a push didn't trigger a redeploy or the new code isn't visible:

| Symptom | Check | Fix |
|---|---|---|
| Push didn't trigger any build | Settings → Source → Branch matches the branch you pushed to | Set the branch in the dashboard |
| Build ran but used Nixpacks (cached) | Settings → Build → Builder shows "Dockerfile"? | Confirm `railway.json#build.builder == "DOCKERFILE"` and re-trigger |
| `/health` returns 200 but `/version` shows old version | Server didn't restart | Deployments tab → latest → **Redeploy** |
| Browser still shows old UI after deploy | Check `<script src>` in HTML — does the `?v=` match the new version? | Bump `BUILD` in client.js + `?v=` in index.html; redeploy |
| Healthcheck fails during deploy | Server logs in Railway dashboard | Roll back via Deployments → prior deploy → **Redeploy** |

**Hard rule:** never overwrite `railway.json` with `"builder": "NIXPACKS"`.
Nixpacks's Node detector caches aggressively and routinely misses
`public/` changes. The codebase committed to v2.0.0 with `DOCKERFILE`
specifically because that combination silently broke v1 redeploys.

## Custom domain (optional)

In Railway service settings → **Custom Domain** → add your domain and
set the CNAME as instructed.

## Monitoring

Railway provides logs in the dashboard. The server logs:
- Connection / disconnection per socket.
- Room create / destroy.
- Invalid action attempts (security signal).

For a game with max ~50 concurrent players (well within scope), no
external monitoring is needed.

## Resource sizing

- **RAM**: < 128 MB for dozens of rooms. Railway's smallest plan is fine.
- **CPU**: negligible. AI decisions are < 1 ms.
- **Network**: trivial. Each Socket.IO message is < 1 KB typical.

## Rollback

If a deploy breaks the game:

1. **Railway dashboard** → Deployments → click a prior deploy →
   **Redeploy**. Fastest, no git surgery.
2. **Or** revert the offending commit on the watched branch:
   ```bash
   git checkout claude/mobile-game-development-GifG7
   git revert <sha>
   git push origin claude/mobile-game-development-GifG7
   ```
   Railway rebuilds from the reverted state.

## Local dev = prod

The same `node server.js` runs in prod. No build step. Iteration is:

1. Change code locally → run the seven test scripts (see
   [`TESTING.md`](TESTING.md)).
2. `git push origin <feature-branch>` → review.
3. Merge into watched branch → `git push` → Railway redeploys.

## If Railway is unreachable

The app is a single Node process that reads `PORT` from the environment
and serves on `/`. You can host it on any platform that can build a
Dockerfile:

```bash
docker build -t game-304 .
docker run -p 3000:3000 game-304
# http://localhost:3000
```

The only Railway-specific details are the `railway.json` (builder +
health-check + restart policy) and the watched-branch convention above.
Nothing in the application code depends on Railway.
