# GridWatch AI
### From 40 dark-pole alerts to *one* located fault ticket — in minutes.

A telemetry-driven fault detection & localization system for a distribution
utility's low-voltage (LT) line. When pole devices report their section has
lost power, this system turns that stream of noise into a small number of
**located fault tickets** — the exact **span** (edge between two poles), a DT
area, or a feeder — with driving coordinates, PIN code, affected count, and an
honest confidence label. One snapped wire becomes **one incident**, not 40
alerts. Restoration is verified from telemetry, not from a crew click.

Built as the take-home assignment for an **AI Product Engineer Intern** role —
a fictional Karnataka distribution board. Full brief:
[`instructions.md`](instructions.md).

---

## Why this project is strong (a 30-second pitch)

The assignment is not "detect that power is out." It is: *given ~96% of poles
reporting only live/not-live, find the failed edge in minutes, and make the
answer one the operator at 2 a.m. can act on.* This repo answers that
comprehensively:

| The hard part | What we did |
|---|---|
| **~60% of DTs have no recorded pole order** (the deliberate central trap) | A 3-tier hybrid: recorded order → **geometric inference anchored at the transformer** → DT-level fallback with a labeled, honest answer. Co-use history refines it over time. Never silently assume complete topology. |
| **One snapped wire → dozens of dark poles → one ticket** | Boundary/cut-edge localization + connected-component grouping. Monotonic: number of tickets = number of boundary components, not dark poles. |
| **Multiple simultaneous faults** | Disjoint dark components → disjoint tickets. Never merged, never one-per-pole. |
| **Don't cry wolf** | Scheduled outage windows, dead sensors (dark with live children = impossible line fault), the ~4% always-offline fleet, duplicates/late/out-of-order/stale-6h retries — all handled. |
| **Fixing is proven telemetry, not a button** | Auto-verify only when ≥90% of affected poles report live; a crew "resolved" over dark poles is pushed back to `disputed`. |
| **Blind poles (no device)** | Contracted, not treated as live — one dark region stays one incident across a coverage gap; costs confidence, never correctness. |
| **Explainability** | Localization is a **deterministic graph traversal**, unit-tested, walk-through-able on a whiteboard. The LLM is confined to an optional plain-language incident *brief* (async, cached, degradeable) — never the localization math. |

Every one of these is verified end-to-end (see **Quick start** and the measured
numbers in  **Highlights**) — the numbers are **measured, not claimed**.

---

## Highlights

- **Radial-network boundary inference:** one snapped wire → **one** located
  ticket, verified end-to-end in one command.
- **Answers the central data problem** (~60% DTs missing ordering) via a
  recorded → geometric-inference → co-use-learned → DT-fallback hybrid
  (see [ARCHITECTURE.md](ARCHITECTURE.md) §4.5).
- **Don't-cry-wolf:** ignores scheduled outages, dead sensors, and the ~4%
  always-offline fleet.
- **Telemetry-only ticket verification** — a crew marking "fixed" while poles
  stay dark is pushed back.
- **Severity-ranked operator console** for a non-engineer at 2 a.m.: incident
  feed, live live/dark map, one clear next action.
- **Fault simulator** (UI + CLI) — inject span/DT/feeder faults and noise, then
  watch detect → localize → ticket → repair → auto-verify.
- **Measured performance, in-repo and repeatable** (see ARCHITECTURE §11):
  - Fault → localized ticket visible: **15.5 s p95** (target < 120 s)
  - Ingest sustained: **991 msg/s**, 0 dropped (target ≥ 500)
  - Ingest burst: **5,000 msgs / 10 s, 0 lost**
  - Console incident list: **15 ms p50 / 20 ms p95**
  - Restoration → auto-verified: **15.3 s p95**
- **AI used where it earns its keep** — the incident brief (async, cached,
  degradeable), never the localization math. `AI-WORKFLOW.md` is honest about
  exactly where we drew the line.

---

## Quick start (entire stack, one command)

```
docker compose up
```

That starts **db (Postgres) + api (Express) + web (Next console)** — seeded
with a realistic synthetic network on startup, no manual migrations.

- Console: http://localhost:3000
- API health: http://localhost:3001/health

First build takes a few minutes. Then from the **Simulator** panel: pick a
*span / DT / feeder* fault, inject, and watch a single located ticket appear.
Repairs are driven from the same panel.

Full setup, env vars, and troubleshooting: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Live URL & demo

- **Public URL:** https://gridwatch-ai.onrender.com — free tier; **it
  cold-starts, so give it ~30–60 s (and a refresh)** before concluding it's
  down.
- **Demo video (~5 min):** *<link pending>* — inject a fault → localize →
  ticket → repair → auto-verify.

---

## Simulator (G5)

From the console: **Simulator** panel → pick *span / DT / feeder* fault, a
target, and *Inject*; watch the ticket appear. Repairs run from the same panel.

From the CLI (inside the api container):

```
docker compose exec api pnpm --filter @gridwatch/api simulate fault --type span
docker compose exec api pnpm --filter @gridwatch/api simulate fault --type dt --dt D-0012
docker compose exec api pnpm --filter @gridwatch/api simulate repair
docker compose exec api pnpm --filter @gridwatch/api simulate noise --kind scheduled-outage
```

Default is `mode: clean` (every affected pole reports, deterministic demo path);
pass `--mode noisy` for the realistic contract (dead dying messages, firmware
1.2 silence, scheduled outages, duplicates, out-of-order).

---

## Docs map

| File | What's in it |
|------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full system: diagram, ingest, storage, **localization algorithm**, the 60% missing-topology answer, noise handling, API, UI, AI, scale, measured perf. |
| [approach.md](approach.md) | The design/planning document — why the system is shaped this way, build order, verification checklist. |
| [DECISIONS.md](DECISIONS.md) | Running decision log (newest first), assumptions, known fragilities. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Prereqs, copy-paste steps, env vars, deploy (incl. free-tier Render path for G4), verification, reset, troubleshooting. |
| [AI-WORKFLOW.md](AI-WORKFLOW.md) | How AI was used — human-directed, what was reviewed/verified, where AI was wrong and thrown away. |
| [AGENTS.md](AGENTS.md) | Working summary + repo conventions for agents/humans working in this repo. |

---

## Status

**Working end-to-end locally and deployed.** Full loop verified under a single
`docker compose up`, and the ingest/perf targets are **measured and published**
(ARCHITECTURE §11). Remaining for submission: recording the 5-min demo video
(G6) — everything else is shipped.