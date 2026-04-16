# Deployment — Railway

## Prerequisites

- A GitHub repo with this code pushed.
- A Railway account (https://railway.app). Free tier suffices for a casual
  game.

## Steps

1. `git push origin claude/mobile-game-development-GifG7` (or merge to main).
2. In Railway → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects the `Dockerfile`.
4. Environment variables: **none required**. Railway injects `PORT`.
5. Click **Generate Domain** in the service settings → you get a
   `*.up.railway.app` URL.
6. Open the URL on your phone, create a room, share the link. Done.

## How the build works

- `Dockerfile` uses `node:20-alpine`, copies the project, runs `npm ci`,
  exposes the PORT, and runs `node server.js`.
- `server.js` binds to `process.env.PORT || 3000`.
- Static client assets are served from `public/`.

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
