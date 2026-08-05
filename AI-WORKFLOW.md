# AI-WORKFLOW.md

How this project was actually built with AI. Be honest; the number is not
scored, the judgment is.

## Tools used, and for what

| Tool | Used for |
|------|----------|
| opencode (Claude-family model) | Most code + docs. The session you're reading. |
| (fill in the others you use: Copilot, ChatGPT, Claude Code CLI) | *e.g. stack-trace reading, rubber-ducking the algorithm* |

Everything below reflects how I actually worked in the sessions that built this.

## What I delegated wholesale vs wrote myself

- **Delegated:** boilerplate (Dockerfiles, jest/vitest config, drizzle schema
  scaffolding, shadcn components), the docs scaffolding, and formatting.
- **Wrote myself / reviewed line-by-line:** the localization math. The boundary
  scan, the connected-component grouping, the confidence formula, and the
  missing-topology hybrid were written to a spec of my own and then I had to be
  able to defend every line — the brief says a reviewer will pick a function
  and I explain it.
- The line I drew: *an AI can scaffold a system, but correctness-critical
  inference stays something I can walk through on a whiteboard.* Everything the
  LLM produced in that path was treated as suspicious until a test proved it.

## Where the AI was wrong, misleading, or thrown away

1. **The queue question.** I told the model the ingest scale and the heading,
   and it immediately suggested Redis + BullMQ. That's scope-inflation dressed
   as architecture. I removed it — the brief penalizes building infra instead
   of the core, and at 39 msg/s it's not needed. Caught by reading the numbers I
   supplied back at it.
2. **Optimistic topology.** An early draft of the localization "helpfully"
   second-guessed missing `parent_pole_id` by assuming nearest-neighbour is
   correct and returned confident span answers on the ~60% DTs. That hides the
   central design problem instead of solving it. I threw it out and forced the
   fallback + `span | dt-area | feeder` labelling + stability check. Caught
   because the output contradicted the AGENTS.md core constraint — docs
   cross-referenced against the code is exactly this kind of guard.
3. **Fabricated telemetry contract details.** A draft pressed for voltage /
   current fields "to improve localization". The data contract explicitly has
   none. I deleted it. Caught by keeping the payload schema from
   `02-data-and-systems.md` open while reviewing.
4. **Deterministic-false-confidence.** Early AI output leaned on "LLM reasons
   about the boundary". That's < 120 s it can't guarantee and it isn't
   explainable; per the brief it's an interrogation risk. I kept localization
   deterministic and moved the LLM to the incident brief.

## Rough share of AI-generated code

Honest estimate: **~85–90%** of the scaffolding and non-core code, **~10–20%**
of the localization engine, and **all of the core algorithm** was either my own
structure or written by me and then independently re-verified. The number isn't
scored; the split exists so I can explain the code.

## Prompts/session excerpts I consider best

- *"Design the localization as a pure function: given pole liveness + a radial
  forest, return the cut edges and a confidence. Do not make it output text to
  a human."* — forced the deterministic core.
- *"Write the most important test first: a known fault in a known topology must
  yield the expected span. Add dead-sensor, scheduled-outage, duplicate,
  out-of-order, and multi-fault cases."* — pinned the correctness contract
  before implementation, and gave me a fixture to measure the inference error
  against.
- *"Where in this system does an LLM earn its keep? Make a case, and be honest
  about the spot where it does not."* — produced the D12 argument.

## The rule that kept this on the rails

Docs must match shipped code, and core inference must be explainable line by
line. AI output is faster, not smarter; every confident claim from a model was
treated as a hypothesis until a test or the data contract confirmed it.