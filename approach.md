# approach.md — System Design & Build Plan

This is the working plan for how the GridWatch AI system will be designed,
built, and verified. It is the "thinking document": `ARCHITECTURE.md` is the
frozen technical description of what ships, `DECISIONS.md` is the running log,
and this file explains *why* the system is shaped the way it is and the order
we build it in.

Status: **initial design, before implementation.**

---

## 1. The core problem, restated

Poles report only **live/not-live**. We must infer the failed **edge**. The
network is a radial tree — that is the assumption that makes the problem
solvable, and it is the only structural assumption we are allowed to trust.

The three hard things, in order of difficulty:

1. **Boundary inference on an incomplete tree.** For ~60% of DTs nobody recorded
   which pole feeds which. We know every pole's GPS and its DT, not its parent.
2. **Grouping + noise.** 40 alerts for one wire = failure. Dead sensors, 4%
   always-offline fleet, scheduled shedding, dup/late/out-of-order messages —
   the system must fire *only* on real faults.
3. **Speed.** Ticket visible < 120 s (p95). Heartbeats arrive every 15 min, so
   fast detection must ride on `power_lost` bursts and *stopped heartbeats* as a
   slow secondary path, not on the heartbeat cadence.

## 2. Decisions that shape everything (each justified in DECISIONS.md)

| # | Decision | Short reason |
|---|----------|--------------|
| D1 | Radial tree as the core data structure, keyed by `dt_id` | Matches physics; makes boundary finding a cut-edge computation |
| D2 | Per-DT sub-trees; feeder/DT/span faults are the only three kinds we emit | Exhaustive per the brief; everything else is sensor noise |
| D3 | **Hybrid topology**: use recorded order where it exists (40%); geometric inference where it doesn't; DT-level fallback when inference is ambiguous; co-use history to refine over time | Answers the central question with something that works today and gets better |
| D4 | Grouping = connected components of dark poles within a DT sub-tree | One fault ⇒ one downward-closed connected dark region ⇒ one ticket |
| D5 | Confidence = multiplicative score from coverage, boundary cleanliness, timing coherence, and topology source | Operators must be able to weigh a "coarse" vs "span" answer |
| D6 | Two detection paths: fast (`power_lost` bursts, ~seconds) and slow (heartbeat silence, ~2 intervals) | Fast path meets the 120 s target; slow path catches fw 1.2 / missed dying messages |
| D7 | Suppress faults inside scheduled-outage windows; flag overrun | Shedding is not a fault; the feed is unreliable so overrun stays visible |
| D8 | Verification is telemetry-only; "resolved" by crew without live poles is rejected | The brief's rule, not a nice-to-have |
| D9 | In-process ring buffer + batched writer for ingest; no Kafka/Redis | 39 msg/s, 5k/10s burst fits one process; measure, don't buy a queue |
| D10 | SSE for console realtime, not Socket.IO/WebSocket | Proxy-friendly on free tiers; console target is < 2 s |
| D11 | One docker-compose runs the whole stack; the public URL is that same compose | G2/G4 are the same artifact, no dual-deploy drift |
| D12 | LLM generates the operator-facing incident brief only. Localization stays a deterministic graph traversal | An LLM can't do the arithmetic; it earns its keep on prose |

## 3. Architecture at a glance

```
 pole devices ──HTTPS──▶ /ingest  (Express, Zod, ring buffer → batched writer)
                               │
                               ▼
                      PostgreSQL (Drizzle)
                     poles │ transformers │ topology │ telemetry │ incidents │ tickets
                               │                          ▲
                               ▼                          │
                     localizer (boundary + grouping)      │ telemetry state
                               │                          │
                               ▼                          ▼
                      incident service ──▶ SSE ──▶ Operator console (Next.js)
                               │                    map + incident list + actions
                               ▼
                      AI brief (optional, cached)
                               │
                     simulator (UI + CLI) ──injects faults/noise──▶ /ingest
```

Build order and rationale in §5. Full detail in `ARCHITECTURE.md`.

## 4. The missing-topology strategy (the heart of the score)

Three sources of topology, in priority order:

1. **Recorded** (`seq_on_line`/`parent_pole_id` present, ~40% of DTs): trust
   it. Build the sub-tree directly. Span-level answers, high confidence.
2. **Geometric inference** (~60% of DTs): for each DT, take its poles and
   build an approximate line/branch tree:
   - Root at the DT's coordinates.
   - Order by angle/distance to find the trunk direction, then assign each pole
     a parent = nearest pole closer to the DT, subject to a max span distance
     and an anti-fork rule (a pole with degree > 2 is a branch point).
   - Accept the inference only if it is *stable*: the same boundary result
     under small perturbation (e.g., drop each candidate parent and re-infer).
   - **Honest failure rate:** inference is wrong at branches and on parallel
     streets. We quantify it on the synthetic network where we control the
     ground truth, and report it.
3. **Co-use history:** when poles go dark together repeatedly (and are both
   dark in the same incident), that is strong evidence of electrical adjacency.
   Promote those edges; verify against future incidents. This is how the system
   gets better without a survey.

**Fallback when confidence is too low to claim a span:** localize to the **DT**
("fault area = DT D-0112 and its poles, exact span unknown") and say so in the
UI. The operator gets a driving coordinate (the DT) and a PIN, not a lie. The
UI always labels the answer: `span` vs `dt-area` vs `feeder`, with confidence.

**What we would ask the department for (in DOC, not as the whole answer):** a
GPS walk of each un-ordered line (≈8 months). Until then, the hybrid ships.

## 5. Build plan (the order that de-risks the score)

1. **packages/domain + packages/db** — types, Drizzle schema, seed script that
   generates a realistic synthetic network (few thousand poles, a few dozen DTs,
   radial lines + branches, ~9% no device, ~60% DTs missing order, ~3% missing
   pincode, ~8% fw 1.2 devices).
2. **packages/api-contract** — shared Zod schemas + types for every endpoint, so
   frontend/backend/simulator can't drift.
3. **Localization engine** (pure TS, no I/O) — build, then write the tests
   FIRST: known fault ⇒ expected span; dead sensor; scheduled outage;
   duplicates; out-of-order; simultaneous faults; the single most important
   test is a known fault in a known topology.
4. **Ingest + state builder** — ring buffer, batched writer, per-device
   `seq` de-dup, per-pole liveness materialized view, heartbeat-silence
   detector.
5. **Incident service + verification** — grouping, debounce, ticket lifecycle,
   telemetry-only resolution.
6. **Simulator** — fault injection per type, noise injection, repair; drivable
   from CLI and later from the UI.
7. **API surface + SSE** — REST for the console, SSE for live updates.
8. **Operator console** — incident list (severity-ranked), map (live/dark
   poles + fault marker), incident detail timeline, one primary action.
9. **AI brief** — LLM-generated incident narrative + recommended checks, cached,
   degradeable.
10. **Docs + deploy** — README, ARCHITECTURE, DEPLOYMENT, DECISIONS, AI-WORKFLOW,
    demo video. Load-test ingest, write the measured numbers.

Rough time allocation by evaluation weight: localization+tests ≈ 35%,
ingest+incidents ≈ 25%, UI ≈ 15%, simulator ≈ 10%, docs+deploy ≈ 15%.

## 6. Verification checklist (before we call it done)

- `git clone <repo> && docker compose up` from clean → console loads, seeded.
- Inject span fault → **one** ticket, correct span, PIN, confidence, < 120 s.
- Inject 3 simultaneous faults → **three** tickets.
- Kill a device (power fine) → **no** ticket.
- Scheduled outage → **no** ticket.
- Repair → auto-verified from telemetry, no click.
- Mark resolved while still dark → rejected.
- Measured ingest: ≥ 500 msg/s sustained; 5,000 msgs/10 s no loss.
- All five docs present; architecture diagram matches shipped code; no secrets
  in history; every file explainable.

## 7. Risks and honest unknowns

- **Inference accuracy on the 60%** is the biggest unknown; mitigated by
  DT-level fallback + co-use history + explicit labeling.
- **Detection latency without `power_lost`** (fw 1.2 / lost dying messages) is
  bounded by the heartbeat window (~16–20 min) — document, don't hide.
- **Free-tier public URL cold start** — say so in README, rely on the demo video.
- **Proxied SSE** must be tested on the deployed URL, not just locally.
- **AI brief latency/cost** — make it async and cached so a slow model never
  blocks the ticket.
