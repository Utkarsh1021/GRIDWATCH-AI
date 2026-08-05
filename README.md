# GridWatch AI

Fault detection & localization for a distribution utility's low-voltage line.

When a pole device reports its section has lost power, this system turns that
into a small number of **located fault tickets** — the exact span (or DT /
feeder area), driving coordinates, PIN code, affected count, and confidence —
instead of 40 alerts for one snapped wire. Restored power is verified from
telemetry, not from a button click.

Built for a fictional Karnataka distribution board take-home assignment. Full
product brief: [`instructions.md`](instructions.md).

## Highlights

- Radial-network boundary inference: one snapped wire → **one** located ticket.
- Handles the **central data problem** — ~60% of transformers have no recorded
  pole ordering — via a recorded → geometric-inference → co-use-learned → DT
  fallback hybrid (see [ARCHITECTURE.md](ARCHITECTURE.md) §4.5).
- Don't-cry-wolf: ignores scheduled outages, dead sensors (a pole dark with live
  children), and the ~4% always-offline fleet.
- Telemetry-only ticket verification — a crew marking "fixed" while poles stay
  dark is pushed back.
- An operator console for a non-engineer at 2 a.m.: severity-ranked incident
  feed, live live/dark map, one clear next action.
- A fault simulator (UI + CLI) you can drive to inject span/DT/feeder faults
  and noise, then watch detect → localize → ticket → repair → auto-verify.

## Run it

```
git clone <repo-url>
cd <repo>
docker compose up
```

Open http://localhost:3000 — the app is seeded with a realistic synthetic
network on startup. Full setup, env vars, and troubleshooting:
[DEPLOYMENT.md](DEPLOYMENT.md).

## Live URL & demo

- **Public URL:** <PASTE-LIVE-URL-HERE> — free tier; **it cold-starts, so give
  it ~30 s** before concluding it's down.
- **Demo video (5 min):** <PASTE-LOOM-OR-DRIVE-LINK-HERE>

## Simulator

From the console: **Simulator** panel → pick *span / DT / feeder* fault, a
target, and *Inject*. Watch the ticket appear. Repairs are driven from the
same panel. From the CLI:

```
docker compose exec api pnpm --filter @gridwatch/api simulate fault --type span
docker compose exec api pnpm --filter @gridwatch/api simulate fault --type dt --dt D-0012
docker compose exec api pnpm --filter @gridwatch/api simulate repair
docker compose exec api pnpm --filter @gridwatch/api simulate noise --kind scheduled-outage
```

Injections default to `mode: clean` (every affected pole reports, so one fault
is always one ticket — the deterministic demo path); pass `--mode noisy` for
the realistic contract with fw-1.2 silence and lost dying messages.

See `02-data-and-systems.md` for what the simulator reproduces (dead dying
messages, firmware-1.2 silence, scheduled outages, duplicates, out-of-order).

## Docs map

| File | What's in it |
|------|--------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagram, ingest, storage, **localization algorithm**, the 60% missing-topology answer, noise handling, API, UI reasoning, AI feature, scale. |
| [approach.md](approach.md) | The design/planning document — why the system is shaped this way and the build order. |
| [DECISIONS.md](DECISIONS.md) | Running decision log (newest first), assumptions, known fragilities. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Prereqs, copy-paste steps, env vars, verification, troubleshooting, reset. |
| [AI-WORKFLOW.md](AI-WORKFLOW.md) | What AI was used for, where it went wrong, what's AI-generated. |
| [AGENTS.md](AGENTS.md) | Quick working summary + repo conventions. |

## Status

**Working end-to-end locally.** The full loop is verified: seed → inject a span
fault → one located ticket → repair → auto-verified/closed in ~45 s, all under
`docker compose up`. Remaining for submission: a public URL (G4), the 5-min demo
video (G6), and the measured ingest/perf numbers. See
[DECISIONS.md](DECISIONS.md) for the decision log and known gaps.