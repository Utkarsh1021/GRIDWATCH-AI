# AGENTS.md

This file tells an AI agent (or a human) everything needed to work in this
repo without re-reading the full brief. The authoritative source of the
product requirements is `instructions.md` at the repo root; this file is the
working summary and repo conventions.

## What this project is

A take-home assignment: an **AI Product Engineer Intern** role building a
fault-detection system for a (fictional) Karnataka distribution utility.

**Core value proposition:** turn a stream of per-pole liveness telemetry into
a small number of *located faults*. When a wire breaks, the control room knows
which span failed, its driving coordinates, and its PIN code — in minutes, not
two hours.

**Explicitly out of scope** (do not build these — they count as scoping
failure, not bonus):
- Crew routing / vehicle allocation / scheduling optimization
- Real authentication, SSO, or role-based permissions (a stub operator is fine)
- A mobile app
- Any hardware/firmware
- Historical analytics, reporting, predictive maintenance
- More than one city subdivision

## Domain model (must not be violated)

- The low-tension network is a **radial tree** (no loops). Every pole has
  exactly one path back to its distribution transformer (DT); every DT has one
  path to a feeder/substation.
- A fault is almost always on a **span** (edge between two poles) or at a piece
  of equipment (DT, fuse, jumper). When a span fails, everything downstream
  goes dark; upstream stays live. Observable signature = a **live/dark boundary**.
  Sensors report on **nodes**; the fault is an **edge** — infer edge state from
  node state.
- One snapped wire => dozens of dark poles => **one** incident. Group symptoms.
  Also handle **multiple simultaneous faults** (return several tickets, not
  one merged and not one per dark pole).
- Physical signatures to distinguish (see `01-problem-context.md` §2):
  - Span fault: live/dark boundary mid-line.
  - DT fault: every pole under a DT dark at once, no live pole beneath it.
  - Feeder fault: every DT under the feeder dark.
  - Single isolated dark pole with **live children**: physically impossible as
    a line fault = **dead sensor**, not an outage.

## Telemetry contract (`02-data-and-systems.md` §2)

Devices POST JSON: `{ device_id, pole_id, event, energized, ts, seq, battery_mv, rssi, fw }`.

- `event`: `heartbeat` | `power_lost` | `power_restored` | `boot`.
- `seq`: monotonic per device, resets to 0 on boot — the one reliable ordering/
  de-dup tool **within a device**.
- `ts`: device clock, skew up to ±90 s, not monotonic across devices.
- Heartbeat every **15 min ± 45 s** while energized.
- On power loss, fw ≥1.3 sends a single `power_lost` from capacitor reserve,
  succeeds **~70%** of the time.
- fw 1.2 (~8% of fleet) **never sends `power_lost`** — just stops heartbeating.
- At-least-once delivery: duplicates + retries up to 6 h (very stale `power_lost`).
- **~4% of fleet offline at any moment** for reasons unrelated to power.
- No current/voltage/direction/impedance. Only live-or-not.

Encoder of all this is in `ARCHITECTURE.md`; the design decisions are in
`DECISIONS.md`.

## Pole registry (`02-data-and-systems.md` §3)

CSV per pole: `pole_id, lat, lon, feeder_id, dt_id, seq_on_line, parent_pole_id, pole_type, ward, pincode, device_id`.

- `lat/lon`: always present, always trustworthy (±4 m).
- `feeder_id`, `dt_id`: always present.
- **`seq_on_line` / `parent_pole_id` are missing for ~60% of DTs** — the
  deliberate central design problem. You know where each pole is and which DT it
  belongs to, but NOT which pole feeds which. Handle it explicitly, don't assume
  the topology is complete. Geometric inference + DT-level fallback + co-use
  history is the intended hybrid; see ARCHITECTURE.DECISIONS.
- `pincode` missing for ~3%. `device_id` empty for ~9% (no device → coverage gaps).

Transformer registry CSV: `dt_id, feeder_id, lat, lon, capacity_kva, households_served`.

## Scale and performance targets (`02-data-and-systems.md` §1, §7)

One subdivision: 4 substations, 31 feeders, 412 DTs, 38,400 poles (~91% wired),
≈210k households, 12–18 outages/day (up to 120 monsoon).

- ~39 msg/s steady state, bursts of a few thousand in seconds after a big outage.
- Measure (don't guess), meet or explain, these:
  | Metric | Target |
  |--------|--------|
  | Fault → localized ticket visible in UI | < 120 s (p95) |
  | Ingest sustained throughput | ≥ 500 msg/s |
  | Ingest burst w/o data loss | 5,000 msgs / 10 s |
  | Console incident list load | < 2 s |
  | Restoration → ticket auto-verified | < 120 s |

Reduced synthetic network is fine (a few thousand poles, a few dozen DTs) as
long as the *shape* is real: radial lines, branches, varying line lengths,
~9% poles without devices, ~60% DTs missing ordering.

## Required deliverables (pass/fail gates)

1. **G1** Public GitHub repo.
2. **G2** `git clone && docker compose up` brings up the **entire** stack — no
   manual migrations, no hand-edited config, no separately-started services.
3. **G3** Seeded on startup with a usable synthetic network.
4. **G4** **Public URL**, openable with no account/VPN/key. Free tier cold-start
   is OK — say so in README.
5. **G5** Fault simulator runnable from that URL or one documented command;
   injecting a fault visibly produces a localized ticket.
6. **G6** A ~5-min demo video (fault injected → detected → localized → ticketed
   → repaired → auto-verified).

Five required docs at repo root: `README.md`, `ARCHITECTURE.md`,
`DEPLOYMENT.md`, `DECISIONS.md`, `AI-WORKFLOW.md`. See boundaries in each.

Requirement details live in `03-deliverables-and-submission.md`,
`04-evaluation.md`, `05-faq.md`.

## Repo conventions

- Turborepo monorepo. Shared domain types live in `packages/domain`; DB schema/
  Drizzle in `packages/db`; HTTP contracts in `packages/api-contract` (or similar
  — keep types shared so frontend/backend/simulator never drift).
- TypeScript everywhere. Zod for validation at every boundary.
- **No code comments unless the logic is non-obvious.** Prefer named functions/
  clear types. Follow existing style.
- Linter IS run (eslint + prettier). Formatting consistent.
- **Tests:** the localization logic is the highest-value place for tests. The
  single most important test: a known fault in a known topology yields the
  expected span. Include dead-sensor, scheduled-outage, duplicate, out-of-order,
  and multi-fault cases. Broad controller/component coverage is NOT the goal.
- **Commits:** incremental, meaningful messages. Never one giant "initial commit".
- **No secrets in the repo or git history, ever.**
- Docs *must match the code that ships* — a mismatch is scored as a significant
  negative (the reviewer inspects by cross-referencing).
- Suspected AI-written code is expected and fine, but you must be able to explain
  any function line-by-line on a follow-up call.

## When asked to work here

Read `instructions.md` (the full brief) before designing. The evaluation weights
in `04-evaluation.md` are: localization 25%, product judgment 20%, architecture
20%, operator UX 15%, docs/reproducibility 15%, engineering craft + AI leverage 5%.
Spend effort accordingly — localization correctness and the missing-topology
answer move the score most; reproducible run + honest "what's broken" notes
gate everything.