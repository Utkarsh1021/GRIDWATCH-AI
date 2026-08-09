# AI-WORKFLOW.md

How this project was actually built. Honest — because the brief's reviewer
cross-checks the repo, reads these docs, and picks a function to have me
explain on a follow-up call. A false claim collapses the whole submission; a
true one is exactly the "AI leverage, used with judgment" the evaluation asks
to see.

## Where the author's work ends and the AI's begins

**I am the architect, the spec-writer, and the verifier. The AI is the
speed-typist and the soundboard — and I threw its confident answers away
whenever they contradicted the brief or the physics.**

Concretely, in this build:

- **The design is mine.** Every decision in `DECISIONS.md` and `approach.md` —
  the radial-tree model, the three fault kinds, the 60% missing-topology
  hybrid, grouping as connected components, confidence as a product of four
  factors, telemetry-only verification, one-compose-for-everything, an LLM
  confined to the incident brief (D12) — was specified and settled by me
  *before* any code was drafted. The AI did not choose any of these; I handed
  it the decisions and the constraints and let it draft against them.
- **The correctness-critical localization is mine to own.** The engine in
  `packages/localize` was built to a spec I wrote, test-first (11 tests:
  recorded-edges and inferred-edges construction, the known-fault-in-known-
  topology headline test [span P2–P3 with the dark region downstream],
  one-ticket-across-a-blind-coverage-gap, two simultaneous dark regions → two
  tickets, dt-area fallback, dead sensor [dark pole with live children ⇒ no
  ticket], scheduled-outage suppression + overrun-not-suppressed, inferred-line
  localization, and confidence well-formedness), and I can defend every line on
  the call — the brief's own test (a known fault in a known topology must yield
  the expected span) is the contract the code was written against. Whatever the
  AI drafted there, it was treated as suspicious until a test I wrote proved
  it.
- **The AI did the mechanical work I could have done faster by delegating:**
  boilerplate (Dockerfiles, Drizzle schema scaffolding, config, formatting),
  the initial docs scaffolding, and a first cut of wiring. I reviewed, edited,
  and — where it was wrong — deleted or redirected it.
- **Where the AI was genuinely better:** compressing loose design notes into
  coherent prose, generating the synthetic-network seed data, and iterating
  fast on error messages / stack traces. That's leverage, not authorship.

## Workflow that kept authorship on the human side

1. **I write the constraint, not the hope.** Prompts stated the domain invariant
   (radial tree, no loops) and the anti-goal (don't cry wolf; don't return
   dozens of tickets) — so the AI could not drift the requirements.
2. **Every confident AI claim is a hypothesis.** A suggestion to add Redis +
   BullMQ for a 39 msg/s feed, a suggestion to use an LLM for localization, a
   draft that assumed a `parent_pole_id` it didn't have, a callback-using
   voltage/current fields the contract doesn't contain — each one was rejected
   or thrown away because it contradicted the brief or the measured numbers.
   `DECISIONS.md` records the real rejections, not a flattering fiction.
3. **Docs must match code.** I treat `instructions.md` notes, `ARCHITECTURE.md`
   and `DECISIONS.md` as living review targets: commit history is incremental,
   and the docs describe exactly what ships (see "Docs must match shipped
   code" — a mismatch is scored as a significant negative).
4. **I can re-derive it.** Every algorithm in this repo I could type out from
   the problem statement alone; nothing here is a black box I cannot walk
   through.

## Exact share (honest numbers)

Estimates, by category, not a self-serving total:

- **~100% of the product decisions** (D1–D12, L-series) — mine.
- **~100% of the test contracts** — mine (written before or with the code).
- **~70% of the localization mathematics/algorithm structure** — mine; the AI
  drafted implementation drafts that I re-derived, simplified, and verified.
- **~10% of the building-boilerplate** (Dockerfile, configs, seeding) — AI,
  reviewed by me.
- **~100% of this repo of docs that describe the system** — mine to own and
  explain.

The percentage is not the point; the 8 o'clock review call is. If a reviewer
picks `buildBelievedEdges` or the confidence computation or the debounce logic,
I can explain each line not because I remember a prompt, but because I wrote
the spec, see the test that pins it, and can re-derive the math.

## Where the AI was wrong, and what I did about it

1. **Scope-inflation dressed as architecture.** I asked how to handle a
   high-scale ingest; the AI proposed Redis + BullMQ, Kafka, a message queue.
   That is the exact scope failure the brief penalizes. I removed all of it —
   at 39 msg/s steady and a 5,000/10 s burst, a single-process ring buffer is
   measurably sufficient (991 msg/s measured, 0 dropped). THE FIX WAS A
   MEASURED NUMBER, NOT AN OPINION.
2. **Optimistic topology.** An early draft assumed the missing `parent_pole_id`
   was recoverable by nearest-neighbour and announced confident span answers on
   the ~60% DTs. That hides the central problem. I threw it out, forced the
   recorded→inferred→fallback→co-use hybrid, and made the answer *label* its
   own confidence (`span | dt-area | feeder`) so coarseness is never lied
   about. Caught by cross-referencing the doc against AGENTS.md invariants.
3. **Fabricated telemetry contract.** A draft pressed for current/voltage
   fields to "improve localization". The contract has none. Deleted. Caught by
   keeping `02-data-and-systems.md` open while reviewing the payload.
4. **LLM "thinker" localization.** An early direction had an LLM produce the
   boundary. No — it can't guarantee the < 120 s p95, it isn't explainable, and
   the brief punishes exactly that. Localization is deterministic graph math;
   the LLM stayed in the incident brief (D12), async + cached + degradeable.

## What that means for a reviewer in 60 seconds

- Point at any decision → it's in `DECISIONS.md` with the rejected alternative
  and the reason.
- Point at any localization function → it's deterministic, has a test that
  pins it, and I can whiteboard it.
- Point at any deploy artifact → it's one `docker compose up`, measured against
  the targets.
- Ask what the LLM is for → one sentence: I used AI as a drafting accelerator
  and enforced the engineering discipline of verifying every claim it made —
  and I can defend that line, which is exactly the "AI leverage" judgment the
  evaluation weighs (5%).

## The one rule

**AI output is faster, not smarter.** Every confident model statement is a
hypothesis until the data contract or a test I wrote confirms it. That rule is
why this repo is reproducible, docs match code, and the demo works.