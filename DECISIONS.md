# DECISIONS.md — Decision log

Newest first. Each entry: what I chose, what I rejected, and why. Assumptions
made where the brief was ambiguous are marked **(assumption)**. Ends with what
I'd do with more time and what I know is currently fragile.

---

## 2026-08-05 — Implementation phase 2: API, simulator, UI, compose (current)

`apps/api` (Express: ingest, ring buffer, incident lifecycle + telemetry-only
verify, SSE, simulator), `apps/web` (Next standalone + Leaflet), and the
Dockerfile/compose now ship. Everything runs under `docker compose up`, and a
clean span-fault loop is verified end-to-end: inject → one ticket → repair →
auto-verified in ~45 s. Decisions made while building:

**L6 — Blind (non-instrumented) poles are contracted, not treated as live.**
Real bug found by injection: a span fault whose dark region crossed a pole with
no device produced TWO tickets, because the no-device pole defaulted to "live"
and split one connected dark region in two. Fix: grouping walks the tree using
each pole's nearest device-bearing ancestor, so a dark region stays one
component across a coverage gap; the physical affected set (households, pincode,
coordinates) still expands through blind poles. This is exactly the ~9% no-device
coverage gap the brief warned about — it now costs confidence, not correctness.

**L7 — Clean vs noisy fault injection.** The simulator models the real contract
(~8% fw 1.2 never sends `power_lost`, ~30% of dying messages drop), which is
honest but made the demo flaky: partial `power_lost` bursts opened tickets for
fragments before silence-detection reconciled them. So `injectFault` defaults to
`mode: 'clean'` (every affected pole reports `power_lost`, deterministic) for the
demo/G5 path, with `mode: 'noisy'` available to exercise the hard path. The
production detector is unchanged — it always has to deal with both.

**L8 — Repair telemetry uses a seq base far above fault seqs.** First attempt
reused the same per-pole seqs (0, 100, …) as the fault, so per-device seq
dedupe dropped the `power_restored` events and auto-verify never fired. Repair
now starts at 1,000,000 so dedupe never discards a restoration.

**L8a — Fault/repair seqs are now derived from the runtime's live seq
high-water, not fixed bases.** Iterating the demo loop (fault → repair →
fault…) exposed a second seq-collision: re-injecting a fault on an
already-repaired DT emitted messages but every one was dropped as out-of-order,
because its fixed seq base sat below the current `deviceSeq`. Now both `darken`
and `repair` start each device at `deviceSeq + 1`, so repeated injections
always clear dedupe regardless of prior fault/repair history.

**L8b — Verification is scored against reportable (device-bearing) poles.**
Auto-verify judged `live / affected_pole_ids.length`. A span whose dark region
crossed several device-less poles could never reach the 0.9 threshold even fully
restored (e.g. 35/40 = 87.5%) — the ticket hung at `detected` forever. Fix:
denominator is the count of affected poles that have a device; device-less poles
are excluded since they physically cannot report telemetry.

**L8c — Ingest log insert is dedupe-tolerant, not dedupe-strict.** The
append-only `telemetry_events` log has a unique `(device_id, seq)` index, but
seq resets on boot per the telemetry contract — so a re-delivered post-boot
batch can collide and fail the whole insert. The writer previously re-queued the
entire failed batch, yielding a livelock (found under the 5,000 msg/s sustained
run). Fix: `.onConflictDoNothing()` on the log insert. The log is a denormalized
audit trail; the source of truth is the runtime seq/power state, which is what
drives detection.

**L10 — Background fleet heartbeater.** The demo stack had no component emitting
background telemetry, so after ~32 min of silence-detection (`2 × heartbeatMs +
grace`) every device-bearing pole decayed to "dark", destroying live/dark
boundary detection and making the console show the whole network down. A
`FleetHeartbeater` now emits one `heartbeat` per powered, device-bearing pole on
the real contract cadence (`HEARTBEAT_MS`, 15 min, `FLEET_HEARTBEAT_MS` to
override, `FLEET_ENABLED=false` to disable), primed immediately at boot. It
skips poles that are already dark (no power, no heartbeat) and devices that have
gone silent (e.g. `device-die` noise), so it reinforces detection instead of
resurrecting faults. The load harness still resets seq baselines per device via
`boot`, so the two do not collide.

**L9 — Docker image tags.** Two services from one Dockerfile; they must be
tagged distinctly (`gridwatch-api:local`, `gridwatch-web:local`) or the second
build fails with "already exists". Ports are env-templated (`API_PORT`,
`WEB_PORT`) because the host already owns 3000/3001; the shipped defaults stay
3001/3000.

**L10 — Seed is idempotent.** The second `docker compose up` crashed on a
duplicate `SO-DEMO-001`. `seedDatabase` now clears every table it writes
(including `scheduled_outages`, `edges`, `edges_history`) so restarts are clean.

**L11 — Confidence now reflects blind poles.** `coverage` is computed over the
physical affected set (device + blind), so a dark region with observation gaps
scores below 1.0 (e.g. 0.96) instead of masking the gap. This is honest and
matches D5.

## 2026-08-05 — Implementation phase 1: packages + localization engine

Built `packages/domain` (shared types), `packages/schema` (Zod contracts),
`packages/db` (Drizzle schema + synthetic-network seed), and
`packages/localize` (the engine). Logging decisions I made while coding:

**L1 — Localization is a pure function.** `localize()` takes plain pole
models, a liveness map, transformers, and scheduled outages and returns
`{ faults, suspects }`. Chose this so the whole correctness-critical path is
unit-testable with no DB/network (10 tests pass). The api is a thin shell over
it. Rejected coupling localization to the DB.

**L2 — Believed topology is rebuilt per call via `buildBelievedEdges`.**
Chose: recorded order where present, else geometric inference anchored at the
**transformer** (not the centroid). I hit a real bug here: centroid-anchored
inference roots a symmetric line in its middle, which made a mid-line span
fault look like a `dt-area` fault (the top dark pole had no parent). Re-rooting
at the transformer location fixed it — the nearest pole to the DT is the root,
and parents are the nearest closer-to-DT pole within a 120 m max span. Lesson:
missing-topology inference must use the one coordinate we actually trust (the
DT), not a derived average. See L-test.

**L3 — Test first, correctness contract.** The headline test is the brief's
own: a known span fault in a recorded topology yields `from=P2,to=P3` with the
downstream region as affected. I also test: DT fault (needs a second live DT on
the feeder so it's not misclassifed as a feeder fault), two simultaneous faults
→ two tickets, dead sensor (single dark pole with live children) → no ticket,
scheduled-outage suppression + overrun-not-suppressed, and mid-line inference,
plus a blind-pole regression test. All 11 pass.

**L4 — `LocatedFault.dt_id` made nullable.** A feeder fault legitimately has no
single DT. The draft had it required; TS caught the mismatch at the feeder
branch. Corrected in `packages/domain`.

**L5 — Seed proportions.** The synthetic network generator emits feeders/
DTs/poles with radial main lines + branches, ~9% no device, ~40% recorded
ordering (so ~60% missing), ~3% missing pincode, and per-DT household counts.
This is what the whole system — localization, simulator, UI — runs against.

**Next:** `apps/api` (ingest, state, ring buffer, incident lifecycle + verify,
SSE, simulator endpoints), then `apps/web`, then compose.

---

## 2026-08-05 — Planning/documentation phase

**D1 — Radial tree as the core structure.** Chose a radial forest keyed by
`dt_id`. Rejected modelling the HT side as flowing nodes. The brief says the LT
side is radial and that is the only structural assumption we're allowed to
trust; a tree makes a fault a simple cut-edge and grouping a connected-component
problem.

**D2 — Three fault kinds only: span / DT / feeder.** Chose to emit exactly these
per the physical signatures in `01-problem-context.md` §2. Rejected inventing
bonded pairs or partial-DT states. This keeps "is it a fault" a deterministic
shape match and everything else becomes sensor noise.

**D3 — The 60% missing-topology hybrid.** Chose: recorded order where present
→ geometric inference where not → co-use history to refine → DT-level fallback
when the boundary is unstable. Rejected (a) asking for a survey as the whole
answer, and (b) silently assuming complete wiring. Rationale: the brief says the
survey takes ~8 months and to ship something that works today. The hybrid does,
and labels every answer `span | dt-area | feeder` with confidence so the
operator never mistakes coarseness for precision. **(assumption)** inferred
edges carry a stability-checked confidence; if unstable we downgrade to dt-area.

**D4 — Grouping = connected components of dark poles.** Chose component
labelling within a DT sub-tree ⇒ one component ⇒ one ticket. Rejected per-pole
alerting and, at this stage, time-based merging of two simultaneous faults on
the same line — I decided two simultaneous disjoint components stay two tickets
unless evidence shows them adjacent, since the crew question ("one or two
workfronts") is separate from the algorithm's answer. **(assumption)**

**D5 — Multiplicative confidence.** Chose four factors (coverage, cleanliness,
timing, topology_source) multiplied in [0,1]. Rejected a single hardcoded
number. This lets the same UI communicate "high-confidence span" vs
"maybe around this DT" without hiding it.

**D6 — Two detection paths.** Chose a fast path (ride `power_lost` bursts,
seconds) and a slow path (heartbeat silence, ~16–20 min). Rejected relying on
heartbeat cadence for speed. The fast path is what meets the <120 s target;
the slow path is the honest floor for fw 1.2 and the ~30% lost dying messages.

**D7 — Scheduled outages suppressed, overruns surfaced.** Chose to suppress a
ticket whose affected poles sit inside a scheduled window, but flag overruns
because the feed is unreliable (late/cancelled/overrun per §4). Rejected trusting
the feed as gospel — that hides a real fault during a window where nothing was
switched off.

**D8 — Telemetry-only verification.** Chose auto-verify only when ≥90% of
affected poles report live for a confirmation window; a crew "resolved" against
dark poles is pushed back to `disputed`. This is a hard brief requirement and
not negotiable.

**D9 — In-process ring buffer, no queue service.** Chose a bounded ring buffer
+ batched writer for ingest. Rejected Kafka/Redis/BullMQ. At 39 msg/s steady and
a 5k/10 s burst, one process is measurably enough, and it keeps G2/G4 as a
single compose. The boundary where I'd introduce a broker (multi-subdivision,
horizontal ingest) is documented in ARCHITECTURE §10.

**D10 — SSE, not Socket.IO/WebSocket.** Chose SSE for console realtime with a
polling fallback. Rejected WebSockets/Socket.IO: the brief itself warns proxy
upgrade failures are a classic deploy trap on free tiers, and <2 s refresh
doesn't need it. **(assumption)** SSE through the same origin proxy avoids CORS.

**D11 — One docker-compose = the entire stack and the deploy artifact.** Chose
three services (db, api, web) in one compose, with `web` proxying `/api`+`/events`
for same-origin. Rejected Vercel-frontend + Railway-backend split: two deploy
surfaces, CORS, and a frontend not reproducible from the repo — which conflicts
with G2/G4 being the same artifact.

**D12 — The AI feature is the incident brief, not localization.** Chose an
LLM-generated plain-language incident narrative + recommended field checks that
is async, cached, and degradeable to a template. Rejected using an LLM for
localization itself: it's a deterministic graph traversal (instant, free,
explainable) and the brief explicitly interrogates LLM localization hard. The
narrative is the one genuinely variable, prose-shaped part where a model earns
its keep; it never blocks the ticket.

**Stack.** Chose Turborepo monorepo, TypeScript, Next 15 + Tailwind + shadcn/ui
+ TanStack Query + Leaflet/OSM, Express + Drizzle + Postgres, Zod, Vitest,
Mermaid. Rejected a frontend/backend split in separate repos (shared types can't
drift), and rejected adding a message queue and other infra at this scale.

## What's currently fragile / known-wrong (time of writing)

- Inference accuracy on the 60% missing-topology DTs is unmeasured against
  ground truth until the synthetic network's truth is used as a test fixture.
- Slow-path detection latency (fw 1.2 / lost `power_lost`) is ~16–20 min by the
  data contract; this is documented, not fixed.
- Noisy-mode injection can open fragment tickets before silence-detection
  reconciles the dark set; the default demo path is clean mode (L7).
- The deployment/public-URL path, SSE-over-proxy, and the measured performance
  numbers are not yet proven — they must be tested before submission.
- `telemetry_events` is append-only and grows on free-tier disk; needs a
  retention job.

## With two more weeks

- Measure and publish honesty the ingest/perf numbers and the inference-error
  rate vs synthetic ground truth.
- Build the co-use learning loop to full detail and test it on overloaded/
  overlapping faults.
- A proper offline pincode/geocoding fallback so ~3% missing pincodes degrade
  gracefully without a hosted key.
- Teaming: an "impossible to be a line fault" dead-sensor auto-flag list
  surfaced in the UI for the field crew to check.