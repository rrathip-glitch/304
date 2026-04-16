# 304 — Mobile Multiplayer Card Game

A web-based implementation of **304**, a Sri Lankan trick-taking card game.
Built mobile-first for seamless play between two humans (e.g. you and your
dad) with AI partners/opponents filling empty seats.

## Quick Start

```bash
npm install
npm start
# -> http://localhost:3000
```

Open the URL on your phone. Create a room. Share the join link with your dad.
Any empty seats are filled by the AI.

## How to Play (30-second version)

- 4 players in 2 teams of 2, partners sit opposite.
- You are dealt 8 cards (in two batches of 4, with bidding between).
- One team **bids** a target point total (min 160) they promise to win in
  tricks. Highest bidder picks a **trump** suit (secretly: one card face-down).
- Play 8 tricks, counter-clockwise. Must follow suit; if you can't, your card
  is played **face-down** (this is the "closed trump" mechanic).
- Bidders win tokens if they meet their bid; otherwise opponents win tokens.
- First team to hold all **22 tokens** wins the match.

Full rules are in [`docs/RULES.md`](docs/RULES.md).

## Deployment (Railway)

Push to GitHub, create a Railway project from the repo. Railway uses the
`Dockerfile` to build. The `PORT` env var is set automatically.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Documentation for Future Contributors (Human or AI)

**If you are a new AI instance continuing this project, read
[`docs/SOUL.md`](docs/SOUL.md) first.** It is the orientation file.

- [`docs/SOUL.md`](docs/SOUL.md) — Identity, principles, and self-improvement
  protocol for any agent working on this codebase.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — File map, data flow,
  state shape.
- [`docs/RULES.md`](docs/RULES.md) — Canonical 304 rules as implemented here.
- [`docs/API.md`](docs/API.md) — Socket.IO event protocol.
- [`docs/TASKS.md`](docs/TASKS.md) — What's done, what's pending, priorities.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Why we made key design choices.
- [`docs/TESTING.md`](docs/TESTING.md) — Test scenarios and how to verify.
