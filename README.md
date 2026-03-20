# Multitank

This repository now contains the smallest useful baseline for an online multiplayer tank game:

- a dedicated authoritative Node.js server
- browser clients connected over WebSockets
- room-based joins so players can share the same match
- persistent player profiles and cumulative stats stored on the server
- a file-backed backend account system with sessions, profile progression, inventory/loadouts, MMR, season stats, purchases, entitlements, cloud saves, transaction logging, and admin rollback/restore tools
- authoritative match state machine for waiting, warmup, live round, overtime, pause, round end, results, map transition, and shutdown
- server-side tank movement, bullets, hit detection, deaths, and respawns
- server-side obstacles, capture objective control, AI bots, and per-round credits
- client-side movement prediction with rollback/replay, correction smoothing, predicted shot feedback, and remote snapshot interpolation/extrapolation
- projectile-focused lag compensation with capped shot rewind, fairness bias, timestamp-based validation, and historical target sampling
- auto-reconnect with session reclaim during a live match
- session-aware joins with duplicate-login takeover handling, spectator mode, queued slot promotion, reserved reconnect slots, and AFK ready reset
- room browser, lobby ownership, map/team/class selection, post-game results, and rematch voting
- disconnect and failure handling for reconnect grace, stalled state recovery, objective drop on disconnect, version mismatch rejection, and shutdown signalling
- explicit compatibility gates for build version, protocol version, asset bundle version, and persistent profile-schema migration
- cheat resistance basics: server-side packet validation, rate limiting, duplicate-input rejection, movement sanity checks, cooldown/fire-rate validation, and inventory normalization
- trust boundaries with per-viewer visibility filtering, private inventory replication, spectator full vision, and server-only AI/RNG internals
- fixed-step server simulation with deterministic tick order, room-seeded RNG, and stable action processing
- backend-ops primitives for allocator-driven room creation, maintenance/drain mode, metrics, region-aware instance identity, and graceful shutdown control
- explicit tick system with server tick numbering, tick-aligned snapshot production, per-tick input processing, and client simulation/render separation
- interest management with spatial cell partitioning, per-viewer prioritization, team/visibility filtering, and culling of low-priority distant entities
- animation networking with replicated pose/reload/aim state, server animation events, and client-side correction for fire, hit, spawn, and death
- combat event networking with server-side damage modifiers, assist tracking, kill feed/effect events, stun status handling, and ordered combat replication
- protocol ACKs for reliable control messages, snapshot sequencing, heartbeat timeouts, and chunked state delivery
- a shared versioned packet codec with input packing, packet validation, schema normalization, and explicit state/event serialization
- a per-client replication system with network IDs, full sync for late join, dirty/delta updates, despawns, ownership metadata, and bullet interest filtering
- centralized spawn/despawn cleanup with client-requested full resync if delta lifecycles lose their baseline
- state snapshots and a client-side smoothing layer
- a smoke test that proves two remote clients can join the same room

## What you need for a real multiplayer system

If players in different locations need to play together reliably, the core pieces are:

1. A public dedicated server. This is the source of truth for movement, shooting, health, scoring, and anti-cheat validation.
2. A real-time transport. WebSockets are enough for a first browser prototype; later you might move parts of the simulation to UDP or WebRTC depending on platform and latency goals.
3. Session management. Players need a shared room or match identifier so they connect to the same game instance.
4. A server simulation loop. The server should tick the world at a fixed rate and apply validated player input there.
5. State replication. Clients send input; the server sends snapshots of players, bullets, scores, lobby state, and match state.
6. Client smoothing and prediction. Remote players should be interpolated, and the local player should predict movement and reconcile to server truth.
7. Persistence. Profiles, cumulative stats, and identity need to survive reconnects and server restarts.
8. Internet-ready deployment. Host the server on a public VM or container, put it behind HTTPS/WSS, and keep one stable address for clients.

This starter now implements items 1 through 7 locally and is ready for item 8 when you deploy it.

## Project Multiplayer

Use this as the current priority order for the remaining work:

- [x] Deployment readiness basics: health endpoints, graceful shutdown, metrics, container files, allocator hooks, and maintenance/drain controls
- [x] Public-hosting support: public origin config, allowed WebSocket origins, HTTPS/WSS reverse-proxy files
- [x] GitHub and Render deployment prep
- [ ] Live DNS/domain deployment on a real host
- [x] Reconnect-safe session recovery inside live matches
- [x] Protocol basics: heartbeat, ACK/dedup, snapshot sequencing, and throttled chunked state sync
- [x] Serialization basics: versioned packet schemas, compact input packing, safe packet decoding, and explicit event/inventory state
- [x] Replication basics: network IDs, full sync, delta replication, despawns, ownership metadata, and interest filtering
- [x] Lifecycle recovery: centralized despawn cleanup and forced full resync when delta baselines go stale
- [x] Player session management: reconnect-safe slots, spectator sessions, duplicate-login handling, ready checks, and AFK tracking
- [x] Lobby and match flow: room browser, room codes, map/team/class selection, countdown sync, post-game results, and rematch flow
- [x] Authoritative match state machine: waiting, warmup, live round, overtime, pause, round end, results, map transition, and shutdown handling
- [x] Disconnect and failure handling: reconnect grace, stalled state recovery, late stale-build rejection, and disconnect-safe objective/action cleanup
- [x] Versioning and compatibility: protocol/build/asset rejection and persistent-data schema migration
- [ ] Real account authentication across devices
- [x] Backend persistence foundation: file-backed accounts, authenticated sessions, progression/inventory storage, purchase/entitlement tracking, cloud saves, transaction logging, and restore tools
- [x] Cheat resistance basics: packet validation, anti-spam rate limiting, duplicate-input rejection, movement sanity checks, cooldown checks, and inventory normalization
- [x] Trust boundaries: per-viewer visibility filtering, private inventory state, spectator omniscience, and server-only AI/RNG decisions
- [x] Deterministic simulation basics: fixed-timestep server ticks, room-seeded RNG, and deterministic player/shot processing order
- [x] Tick system: authoritative server tick loop, tick-numbered snapshots, per-tick input processing, and separate client simulation/render paths
- [x] Interest management: spatial cell partitioning, proximity/visibility/team filtering, prioritized update selection, and distant-entity culling
- [x] Animation networking: replicated pose/aim/reload state, server animation events, and correction for fire, hit, spawn, and death
- [x] Combat event pipeline: validated attack requests, ordered damage/death resolution, class-based armor/crit/status logic, assist tracking, and replicated kill-feed/effect cues
- [x] Server-side map collision and obstacle authority
- [x] Server-authoritative objectives, AI bots, and round economy
- [x] Projectile lag compensation: capped shot rewind, fairness bias, and timestamp-based validation
- [ ] Hitscan/melee rewind rules if instant-fire or melee weapons are added later
- [ ] Advanced behavioral anti-macro / anti-bot heuristics if the game needs them later
- [ ] Public matchmaking and team/lobby assignment
- [ ] Real database and persistent progression storage
- [ ] Moderation/admin tooling
- [ ] Multi-process scaling and room routing
- [ ] Client/server build-version compatibility checks
- [ ] Load, reconnect, and desync regression tests

## Run it

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs or on two devices, enter the same room name, and connect.
Each browser keeps a local profile id, so your lifetime stats survive reconnects on that device.

## Deploy Locally With Docker

```bash
docker compose up --build
```

## Render-Like Local Preview

If you want the fastest feedback loop before pushing to GitHub, rebuild and test the Docker image locally:

```bash
npm run render:local
```

That command:

- builds the repo's `Dockerfile`
- starts the container on `http://127.0.0.1:10000`
- uses Render-style env vars like `PORT`, `DATA_DIR`, `DEPLOY_REGION`, and allocator/admin keys
- keeps data in `.render-local-data/` so you can manually reconnect and inspect gameplay changes

Useful companion commands:

```bash
npm run render:local:logs
npm run render:local:down
npm run render:local:smoke
```

`npm run render:local:smoke` is the fast regression path for gameplay changes. It builds the Docker image, starts a temporary container, and runs the full multiplayer smoke suite against that live container so you can catch gameplay breakage without waiting on a Render deploy.

Useful operational endpoints after startup:

- `GET /healthz`: liveness and runtime summary
- `GET /readyz`: readiness signal for load balancers and container platforms
- `GET /meta`: version and server metadata
- `GET /metrics`: Prometheus-style uptime, capacity, and maintenance metrics
- `GET /api/allocator/status`: allocator-facing capacity and joinable-room summary with `x-allocator-key`
- `POST /api/allocator/allocate`: allocate or reuse a room on this instance with `x-allocator-key`
- `GET /api/admin/ops`: deep operational summary with recent security state
- `POST /api/admin/maintenance`: toggle maintenance/drain mode with `x-admin-key`
- `POST /api/admin/shutdown`: trigger graceful shutdown with `x-admin-key`

Backend account and progression endpoints:

- `POST /api/auth/register`: create an account and session token
- `POST /api/auth/login`: sign in with username/email and password
- `POST /api/auth/logout`: revoke the active session
- `GET /api/auth/me`: fetch the current authenticated account/profile
- `GET/PATCH /api/profile`: read or update display name and saved loadouts
- `GET/PUT /api/inventory`: read or replace persistent loadout inventory
- `GET /api/rank`: read persistent MMR/tier and the season leaderboard
- `GET /api/season`: read season stats and ranking state
- `POST /api/purchases`: buy catalog items with persistent wallet coins
- `POST /api/entitlements/check`: validate owned entitlements server-side
- `GET/PUT /api/cloud-save`: read or write cloud save data
- `GET /api/transactions`: inspect the authenticated account's transaction history
- `GET /api/admin/security`: inspect recent security events and abuse signals with `x-admin-key`
- `GET /api/admin/transactions`: inspect full transaction history with `x-admin-key`
- `POST /api/admin/rollback`: restore the `before` snapshot of a transaction
- `POST /api/admin/restore`: restore a transaction's `after` snapshot or selected mode

All mutating backend requests must include a unique `x-request-id` header. The server keeps a replay window and rejects duplicate mutation ids to protect purchases, cloud saves, profile edits, and admin restore tools from accidental or malicious replays.

Operational rollout flow:

1. `POST /api/admin/maintenance` with `{"enabled":true,"draining":true,"reason":"deploy"}` to stop new joins/allocations and fail readiness.
2. Wait for active rooms to drain or finish, watching `/readyz`, `/metrics`, or `GET /api/admin/ops`.
3. Stop or replace the instance cleanly with `SIGTERM` or `POST /api/admin/shutdown`.
4. Start the updated build and clear maintenance mode when the new instance is healthy.

## Deploy Publicly With HTTPS/WSS

1. Copy `.env.example` to `.env` and set `CADDY_DOMAIN`, `ACME_EMAIL`, and `PUBLIC_ORIGIN`.
2. Point your domain DNS at the machine running Docker.
3. Start the public stack:

```bash
docker compose -f compose.public.yaml --env-file .env up --build -d
```

Files involved:

- `compose.public.yaml`: app + HTTPS reverse proxy
- `deploy/Caddyfile`: automatic TLS and WebSocket-safe reverse proxy
- `.env.example`: required public-origin and domain variables

The server now supports:

- `PUBLIC_ORIGIN`: the canonical public site URL advertised by the server
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed to open WebSocket sessions
- `X-Forwarded-Proto` and `X-Forwarded-Host`: proxy-aware metadata for hosted deployments

When hosted publicly, players can share room links like `https://your-domain.example/?room=default`.

## Deploy On Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint using `render.yaml`.
3. Keep the persistent disk so `profiles.json` survives restarts.
4. After the first deploy, optionally set `PUBLIC_ORIGIN` and `ALLOWED_ORIGINS` to your custom domain if you add one.

Files involved:

- `render.yaml`: Render Blueprint for a Node web service with persistent disk storage
- `.gitignore`: ignores generated runtime data so the repo stays clean

Render-specific behavior in this repo:

- `DATA_DIR` lets the server store runtime files on Render's mounted disk instead of the repo directory.
- `PORT` is configurable and defaults cleanly for managed platforms.
- Same-origin hosted WebSocket upgrades are accepted automatically, which helps the default Render URL work without extra manual config.
- `npm run render:local` and `npm run render:local:smoke` let you test Render-style container behavior locally before pushing code.

## Verify it

```bash
npm run smoke
```

That test boots the server, connects two WebSocket clients, readies both players, and verifies the room progresses into an active match.
It also verifies that a disconnected player can reconnect into the same live match before the grace timer expires.

## Project layout

- `server.js`: authoritative game server and static file host
- `shared/protocol.js`: shared config, message types, and sanitizers
- `public/client.js`: browser input, rendering, and snapshot smoothing
- `public/index.html`: simple join UI and game canvas
- `data/profiles.json`: generated server-side profile and cumulative stat storage
- `data/backend.json`: generated backend account/session/progression/purchase/transaction storage
- `smoke-test.js`: end-to-end multiplayer smoke test

## Next steps I recommend

1. Connect this repo to GitHub and do the first Render deploy from `render.yaml`.
2. Add real authentication if you want secure accounts across devices.
3. Replace the open arena with a tile map, spawn zones, and obstacle collision.
4. Add lag compensation for hitscan weapons if you introduce instant-fire guns later.
5. Expand testing into heavier load, autoscaling, and desync scenarios.

Host migration is not on the checklist because this project uses a dedicated authoritative server, not a peer-hosted match owner model.
