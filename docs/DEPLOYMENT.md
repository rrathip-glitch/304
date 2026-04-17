# Deployment — Railway

## Prerequisites

- A GitHub repo with this code pushed.
- A Railway account (https://railway.app). Free tier suffices for a casual
  game.

## Initial setup (one-time)

1. In Railway → **New Project** → **Deploy from GitHub repo** → pick the
   repo.
2. In the service's **Settings → Source** panel, set **Branch** to the
   branch you want auto-deployed (this is the only place Railway tracks
   branch — `railway.json` does not control it).
3. Environment variables: **none required**. Railway injects `PORT`.
4. Click **Generate Domain** → you get a `*.up.railway.app` URL.

## Pushing a new release

`railway.json` is pinned to `"builder": "DOCKERFILE"` — Railway will
*always* build from `Dockerfile`, ignoring Nixpacks heuristics. This
matters because the Nixpacks Node detector caches aggressively and can
miss redeploys when only `public/` files change.

To ship:

```bash
git push origin <watched-branch>
```

Railway picks up the push, runs `docker build`, and rolls the deployment.
Verify by hitting `https://<your-domain>/version` — the JSON response
includes the current `package.json#version`.

If a push didn't trigger a redeploy:

1. Confirm the watched branch matches the branch you pushed to
   (Settings → Source → Branch).
2. Confirm the build is using `DOCKERFILE` (Settings → Build → Builder).
3. If both are correct, hit **Redeploy** on the latest deployment in the
   Deployments tab. (No state is lost — Railway runs the same image.)

## How the build works

- `Dockerfile` uses `node:20-alpine`, copies the project, runs `npm ci
  --omit=dev`, exposes `PORT`, and runs `node server.js`.
- `server.js` binds to `process.env.PORT || 3000`.
- Static client assets are served from `public/` with `?v=<version>`
  cache-bust query strings (matching `package.json#version`).
- `/health` returns `200 ok`; `railway.json` uses it as the healthcheck.
- `/version` returns `{ version, startedAt }` — verify deploy success
  with `curl https://<domain>/version | jq`.

## Custom domain (optional)

In Railway service settings → **Custom Domain** → add your domain and set
the CNAME as instructed.

## Monitoring

Railway provides logs in the dashboard. The server logs:
- Connection/disconnection per socket.
- Room create/destroy.
- Invalid action attempts (security signal).

For a game with max ~50 concurrent players (which this scope can easily
handle), no external monitoring is needed.

## Resource Sizing

- **RAM**: < 128MB for dozens of rooms. Railway's smallest plan is fine.
- **CPU**: negligible. AI decisions are <1ms.
- **Network**: trivial. Each Socket.IO message is <1KB typical.

## Rollback

If a deploy breaks the game:
- In Railway → **Deployments** → click a prior deploy → **Redeploy**.
- Or `git revert <sha> && git push`.

## Local Dev = Prod

The same `node server.js` runs in prod. No build step. Iteration is:
1. Change code locally.
2. `git push`.
3. Railway redeploys automatically.
