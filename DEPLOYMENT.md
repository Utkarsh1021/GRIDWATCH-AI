# DEPLOYMENT.md

For someone with this repo and nothing else. Every command is copy-pasteable.

---

## Prerequisites

- **Docker** ≥ 24 with **Docker Compose v2** (`docker compose` plugin, not the
  old `docker-compose`). Windows: Docker Desktop with WSL2 backend.
- **Node** ≥ 20 only if you want to run outside Docker or use pnpm locally.
- **pnpm** ≥ 9 only if running locally. Inside Docker, pnpm is managed for you.
- No database, no SDKs, no API keys required.

## Quick start (the whole thing)

```bash
git clone <repo-url>
cd <repo>
cp .env.example .env        # optional; defaults work for local dev
docker compose up --build
```

First build takes several minutes (dependencies + images). Afterwards:

- **Console:** http://localhost:3000
- **API health:** http://localhost:3001/health
- Seeded automatically on startup — wait for the "seed complete" log line in
  the `api` service before clicking around.

To verify it worked: open http://localhost:3000, confirm you see a map with
poles and an empty (or demo) incident list, then use the **Simulator** panel
to inject a span fault and watch one ticket appear with a PIN code.

## What `docker compose up` starts

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| `db` | postgres:16-alpine | 5432 | volume-mounted, seeded |
| `api` | node:20-alpine (build) | 3001 | Express: ingest, localizer, incidents, SSE, simulator |
| `web` | node:20-alpine (Next `standalone`) | 3000 | Operator console, server-side renders, proxies `/api` + `/events` |

`web` proxies `/api/*` and `/events` to `api` so the browser only ever talks to
one origin — no CORS issues and SSE works through the same path.

## Environment variables

Commit a `.env.example`. Copy to `.env` to override defaults.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `POSTGRES_URL` | no (dev) | `postgres://gridwatch:gridwatch@db:5432/gridwatch` | Drizzle connection. |
| `PORT` | no | `3001` | API listen port (inside the container). |
| `API_PORT` | no | `3001` | Host port published for the API (`API_PORT:3001`). |
| `WEB_PORT` | no | `3000` | Host port published for the console (`WEB_PORT:3000`). |
| `SEED_ON_START` | no | `true` | Seed/reset the synthetic network on boot. |
| `SEED_SCALE` | no | `small` | `small` (few thousand poles) or `full` (38.4k, slower). |
| `HEARTBEAT_MS` | no | `900000` | Heartbeat interval the simulator emits. |
| `DEBOUNCE_MS` | no | `30000` | Fast-path fault confirmation window. |
| `SILENCE_GRACE_MS` | no | `120000` | Extra grace beyond 2 heartbeats before "silent = dark". |
| `VERIFY_THRESHOLD` | no | `0.9` | Fraction of affected poles that must be live to auto-verify. |
| `AI_API_KEY` | no | *(none)* | LLM key for the incident brief. Absent ⇒ template brief (feature degrades). |
| `AI_MODEL` | no | `gpt-4o-mini` | Model for the brief. |
| `SCHEDULED_OUTAGE_FEED_URL` | no | *(internal mock)* | Mock planned-outage feed (per brief). |

No variable is required for the app to boot.

## Reset to a clean state

```bash
docker compose down -v    # -v also deletes the Postgres volume
docker compose up --build # fresh seed on boot
```

## Deploying to a public URL (G4)

The same compose is the deploy artifact, but the included `render.yaml` is the
quick path to a free, public URL. It runs **api + web in one Render service**
(a single container via `entrypoint.sh`), so the free tier's per-service sleep
does not double the cold-start window — one free sleep cycle, one URL.

1. **Free Postgres (Neon):** sign up at neon.tech → create a project → copy the
   `postgres://...` connection string. It never expires and pauses when idle.
   (The app re-seeds on boot, so the DB is throwaway anyway.)
2. **Deploy:** push this repo, then in the Render Dashboard:
   **New → Blueprint → connect the GitHub repo → Apply.** `render.yaml` creates
   the `gridwatch-ai` web service for you.
3. **Wire the DB:** after Apply, open the service → **Environment** → set
   `POSTGRES_URL` to your Neon string (Render prompts for it because
   `sync: false`) and save.
4. **Open the URL:** Render shows `https://gridwatch-ai-<hash>.onrender.com`.
   Free tier cold-starts, so **give it ~30–60 s** (and a refresh) the first
   time — say this is expected (already called out in `README.md`).

Env vars Render needs on the service (all preset in `render.yaml`):
`API_URL=http://localhost:3001` (baked web proxy target), `PORT=10000`,
`GW_APP=` (empty = run both processes), `POSTGRES_URL`.

> The Next `standalone` server lives at
> `apps/web/.next/standalone/apps/web/server.js`, not `apps/web/server.js`.
> `entrypoint.sh` `cd`s into the standalone dir before `node`, mirroring what
> compose's per-service `working_dir` did — if you customise the deploy, keep
> this path in mind (it's what causes "Cannot find module apps/web/server.js").

To test manually instead of via Blueprint: **New → Web Service → connect repo →
Language = Docker**. The Dockerfile bakes `API_URL` from a build arg (defaults to
`http://api:3001` for compose); on a split deployment pass
`--build-arg API_URL=https://<api-public-url>`.

Alternative host styles (documented caveats):

1. **One host, compose as-is (recommended if you have a `$5/mo` VPS):** run the
   `docker-compose.yml` verbatim; `DB` and `web` share the compose network, so
   `API_URL=http://api:3001` is correct. One public port through `web`.
2. **Railway + Vercel is a poor fit here:** the `api` is a long-lived Express
   server doing SSE + a persistent Postgres pool — Vercel serverless can't hold
   the SSE stream or pool, and the `web` standalone proxies `/events`
   server-side. If forced, run the full compose on Railway and keep Vercel out.
3. **Free-tier caveats:** free instances **sleep after 15 min idle** and
   cold-start 20–60 s. **Say this in the README** and keep the demo video as the
   fallback (G6). Railway free tier is a $5 credit, not forever-free.
4. **TLS:** Render/Railway give an https URL directly. On a raw VPS put Caddy
   (auto-TLS) in front, or accept http for the demo and note it.

Known: the demo URL is free tier, so if it's cold when you open it, wait ~30 s
and refresh before concluding it's down.

## Troubleshooting

Real failure modes we hit while building and deploying — symptom, then fix.

**Port already in use (`0.0.0.0:3000` bind failed)**
Symptom: compose `web` exits with an address-in-use error.
Fix: `netstat -ano | findstr :3000`, kill the PID, or change the host ports in
`docker-compose.yml` (`"3000:3000"` → `"3010:3000"`).

**Migrations racing the database (`relation does not exist` on first boot)**
Symptom: api/web crash-loop right after `up`; `db` wasn't ready.
Fix: `api` and `web` retry with backoff until `db` answers `pg_isready`
(built in), and a compose `depends_on: db: condition: service_healthy`.
Check `docker compose logs api | tail`.

**Drizzle push vs migrate confusion**
Symptom: schema changes don't appear; or migrations fail on a fresh clone.
Fix: the `api` image runs `migrate()` (drizzle-orm/postgres-js) as a boot step,
so a fresh clone needs **no manual step** (G2). After a schema change, add a new
migration in `packages/db` (`pnpm --filter @gridwatch/db generate`) and rebuild
the `api` image.

**Windows line endings breaking shell scripts**
Symptom: `exec /bin/sh: not found` or CRLF errors in the entrypoint.
Fix: set `core.autocrlf=input` in git, or add `.gitattributes` forcing `lf` for
Dockerfiles/entrypoints. Committed `.dockerignore` keeps build context small.

**SSE not updating the console on the deployed URL**
Symptom: map/list fine, live updates dead; works locally, not on Render.
Fix: SSE is served from the same origin via the `web` proxy; ensure the proxy
does not buffer (`proxy_buffering off` equivalent). If using a CDN in front,
disable buffering for `/events`. We also ship a 5 s polling fallback so the
console still refreshes.

**CORS errors opening the console**
Symptom: browser blocks `/api` calls.
Fix: the deployed app must be opened at the **public origin** (the `web` proxy
makes everything same-origin). If you hit the API host directly, add
`CORS_ORIGIN` env to `api` and set it to the console origin.

**Cold start timeouts (free tier)**
Symptom: first request hangs or 502s for ~30 s.
Fix: Render/railway: set the service to never sleep (paid) or accept the cold
start and say so in the README. The demo video covers the evaluator if down.

**Postgres volume grows / out of disk (free tier)**
Symptom: writes start failing; `telemetry_events` is append-only.
Fix: retention job trims events older than N days; or `docker compose down -v`
for a clean demo reset.

**Node image platform mismatch (ARM Macs)**
Symptom: image build fails on `pnpm install` for a linux/arm64 arch.
Fix: images are multi-arch (`node:20-alpine` is). If a native dep breaks, set
`platform: linux/amd64` on the service in compose (slower but works).

## Verifying end-to-end (self-check)

1. Fresh clone → `docker compose up` → console loads, seeded.
2. Inject a **span** fault via Simulator → exactly **one** ticket, correct span,
   PIN, confidence. 
3. Inject **three simultaneous** faults → three tickets, not one/not thirty.
4. Inject a **device die** (no power event) → no ticket.
5. Schedule an outage → no ticket.
6. Repair a fault → auto-verified from telemetry, no click.
7. Mark **resolved while poles dark** → system rejects/`disputed`.
8. All five docs present; architecture diagram matches code; `git log` is
   incremental; `git grep` for keys returns nothing.