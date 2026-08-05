# Take-Home Assignment — AI Product Engineer Intern

**Time budget:** 7 calendar days from the day you receive this. We expect
15–20 hours of actual work. If you find yourself at 40 hours, you have
misjudged the scope — stop, ship what you have, and write down what you cut.

**Read in this order:** this brief → `01-problem-context.md` →
`02-data-and-systems.md` → `03-deliverables-and-submission.md` →
`04-evaluation.md` → `05-faq.md`.

---

## The situation

You have been hired by the **Karnataka State Power Distribution Board**
(fictional, but modelled closely on how real ESCOMs in Karnataka operate) as
their first product engineer.

Here is their problem, in their words:

> When a domestic supply line develops a fault — a snapped low-tension wire, a
> blown fuse at a distribution transformer, a cut jumper — the electricity goes
> out for a cluster of houses. Our control room finds out when people start
> calling the complaint number.
>
> From that first call, it takes us **at least two hours** to work out *which
> specific span of wire* has failed. A lineman drives to the area and works
> backwards from the dark houses, pole by pole, until he finds the break. Only
> then do we know what vehicle, what material, and what crew to send.
>
> Outage frequency has gone up. We are rewiring the city, but that is a
> multi-year programme. In the meantime we need to cut that two-hour
> identification window down to minutes.

**What they want from the software:** the moment a fault happens, the control
room should know *where* it is — the exact span of line, coordinates precise
enough to drive to, and the PIN code. Dispatching the crew is their job, not
yours. But once the crew fixes it, the system must confirm from the field data
that power is actually flowing again, and close the ticket.

## What you have to work with

The department has already put an IoT device on most of their distribution
poles. Each device reports **one thing**: whether that pole is energized or
not. There is a lamp point at the pole, and the device knows whether it is
live.

You also have a registry of every pole with its GPS coordinates.

That's it. There is **no sensor on the wire itself.** You cannot measure
current, direction of flow, or impedance. You know pole-by-pole liveness and
pole-by-pole location, and you have to get from that to "the fault is on the
span between pole P-2211 and pole P-2212, at 12.9682° N 77.5946° E, PIN
560078."

`02-data-and-systems.md` gives you the exact payload formats, the scale, and
the ways this data is dirty. Read it carefully — some of the constraints in
there are the actual difficulty of the problem, not decoration.

---

## What you have to build

A working system, deployed and reachable on a public URL, that does all of
this:

### 1. Ingest
Accept telemetry from the pole devices. Your design should be honest about
volume, ordering, duplication, and device failure.

### 2. Detect and localize
Turn a stream of "pole is dark" signals into a small number of **located
faults**. For each one, output at minimum:

- the specific span or asset you believe has failed
- coordinates you would put into a vehicle's navigation
- the PIN code
- how many poles are affected downstream
- how confident you are, and why

A control room that receives 40 separate alerts for one snapped wire is worse
than no system at all. Grouping is part of the problem.

### 3. Don't cry wolf
Some poles go dark for reasons that are not faults. Some devices die while the
power is fine. There is scheduled load shedding. Your system has to be
trustworthy enough that an operator doesn't start ignoring it in week two.

### 4. Ticket workflow
Every detected fault becomes a ticket that moves through a lifecycle:
detected → acknowledged → crew assigned → resolved → verified → closed.

**Restoration must be verified from telemetry, not from someone clicking a
button.** When the affected poles come back to life, the system should say so
on its own. If a lineman marks it fixed and the poles are still dark, the
system should not believe him.

### 5. An operator console
A UI for the person sitting in the control room at 2 a.m. They are not an
engineer. They need to see, at a glance, that something has broken, where it
is, how bad it is, and what to do next.

The quality of this interface — what you chose to show, what you chose to
leave out, and why — is a substantial part of what we are evaluating. You will
be asked to explain your reasoning in writing.

### 6. A fault simulator
We cannot plug into a real substation. Ship a way for us to inject a fault
into your system and watch it get detected, localized, ticketed, and closed.
This is how we will actually evaluate your work, so make it easy to drive.

---

## Where the AI part comes in

The role is AI Product Engineer, so we are looking at two things.

**How you build.** We expect you to use AI tooling heavily and we want to see
how. You will document which tools you used, what you delegated, where the AI
was wrong or misleading, and what you threw away. There is no penalty for AI
having written most of the code. There is a penalty for not understanding it —
we will ask.

**Where AI belongs in the product.** Somewhere in this system there is
probably a place where an LLM earns its keep, and there are definitely places
where it does not. Pick one AI-shaped feature, build it, and justify it in a
paragraph. If you conclude that no part of this product should use an LLM,
that is a legitimate answer — argue it and we will read the argument on its
merits.

Be warned: reaching for an LLM to do the fault localization itself is a
choice we will interrogate hard.

---

## What we are not asking for

- Crew routing, vehicle allocation, or scheduling optimization
- Real authentication, SSO, or role-based permissions (a stub is fine)
- A mobile app
- Any actual hardware or firmware
- Historical analytics, reporting, or predictive maintenance
- Handling more than one city division

Building any of these instead of the core is a scoping failure, not bonus
credit.

---

## Constraints

- **Stack is yours to choose.** Use what you are fastest in. We have no
  preference and no hidden favourite.
- **Everything must run from a clean clone with one command.** Dockerized,
  `docker compose up`, seeded, working.
- **Everything must also be live on a public URL** we can open without
  installing anything or creating an account.
- **Assume we cannot ask you questions.** We review submissions by email, in
  batch, with no back-and-forth. Anything you would have explained on a call
  has to be in your documentation.

---

## Getting unstuck

The brief is deliberately incomplete in places. Where it is ambiguous, make a
decision, write down the assumption, and move on. Documented assumptions are
treated as correct answers even when we would have chosen differently.

If something is genuinely blocking — a broken link, a contradiction between
two documents — email **[HIRING CONTACT EMAIL]** and we will answer factual
questions. We will not answer "is this approach right?"

Full deliverable checklist and submission instructions:
[`03-deliverables-and-submission.md`](03-deliverables-and-submission.md).



# Problem Context — How the Network Works

Read this before you design anything. Most of the difficulty of the assignment
comes from the physical shape of the network, and you cannot design the
algorithm without understanding it.

> Everything below is the domain model for this exercise. It is a simplified
> but faithful picture of how low-voltage distribution works in Indian cities.
> Where we have simplified, we say so.

---

## 1. The network is a tree, not a mesh

Power reaches a domestic customer through a chain that looks like this:

```
  66/11 kV Substation
        │
        ├── 11 kV Feeder ──────────────┬──────────────┬─────────────
        │                              │              │
   Distribution              Distribution       Distribution
   Transformer (DT)          Transformer        Transformer
   11kV → 400/230V
        │
        ├─ LT line, on poles ─── P-1 ─── P-2 ─── P-3 ─── P-4
        │                                 │
        │                                 └─── P-5 ─── P-6   (branch/spur)
        │
        └─ another LT line ───── P-20 ── P-21 ── P-22

   Houses tap off individual poles via service drops.
```

The important property: **the low-tension side is radial.** There are no loops.
Every pole has exactly one path back to its distribution transformer, and every
DT has exactly one path back to the substation.

That single fact is what makes this problem solvable. It also tells you what
shape your core data structure should be.

## 2. What happens physically when a fault occurs

A fault is almost always on a **span** — the stretch of wire between two
adjacent poles — or at a **piece of equipment** (the DT itself, a fuse, a
jumper connection at a pole).

When a span fails, everything electrically downstream of it goes dark.
Everything upstream stays live.

```
   DT ── P-1 ── P-2 ──╳── P-3 ── P-4
                       │
                    fault here
                       │
   P-1: live      P-3: dark
   P-2: live      P-4: dark
```

So the observable signature of a fault is a **boundary**: the last live pole,
and the first dark pole beyond it. The fault is on the span between them.

Notice what this means for your algorithm. The fault is on an **edge**. Your
sensors report on **nodes**. You are inferring edge state from node state, and
the answer is the frontier between the live region and the dark region.

Notice also what it means for alerting. One snapped wire produces dozens of
dark poles. All of them are symptoms of a single cause. If your system reports
each dark pole as its own incident, you have built a system that makes the
control room's night worse.

### Multiple simultaneous faults

During a storm, three spans in the same division can fail within minutes. Each
one produces its own live/dark boundary. Your localization has to find *all*
the boundaries, not just one — and it must not merge two genuinely separate
faults into one ticket, or split one fault into two.

### Faults that are not on a span

Some things you should expect to see and be able to distinguish:

| What broke | What you observe |
|-----------|------------------|
| Span between two poles | Live/dark boundary mid-line |
| Distribution transformer / its HT fuse | Every pole under that DT goes dark at once, with no live pole beneath it |
| 11 kV feeder | Every pole under every DT on that feeder goes dark |
| A single pole's own lamp circuit | One pole dark, everything downstream of it still live — **not an outage**, a broken sensor point |

That last row is worth staring at. A single isolated dark pole with live
children is physically impossible as a line fault. It is the network telling
you your sensor is lying.

## 3. Why the control room currently takes two hours

The existing process:

1. Householders notice the power is out. Some fraction of them call the
   complaint number over the next 20–40 minutes.
2. The operator plots the complaints roughly on a paper map or a spreadsheet
   of ward names and guesses which DT is involved.
3. A lineman is sent to the area on a two-wheeler.
4. He starts at the DT and walks or rides the line, checking poles, until he
   finds the break. On a long LT line with spurs, this is slow.
5. Only now does the control room know what is actually broken, so only now can
   they dispatch the right vehicle, ladder, wire, and crew size.

Steps 1–4 are what you are compressing. Step 5 onwards is the department's own
operation and is explicitly out of scope.

## 4. The messy reality you must design around

These are real properties of the deployment, not hypotheticals.

**A device that loses power cannot talk for long.** Each pole device has a
small capacitor-backed reserve. When it loses supply it can transmit for a few
seconds — enough for one message. After that it is silent until power returns.
Design implications: you may get exactly one "I am dying" packet, or you may
get none if the radio was busy. Silence is ambiguous — a pole that stops
reporting might be dark, or its modem might be broken.

**Some poles have no device at all.** Coverage is incomplete. Your topology has
gaps, and the fault may be on a span between two poles neither of which reports.

**Devices fail on their own.** A meaningful fraction of the fleet is offline at
any given moment for reasons unrelated to power.

**Load shedding is scheduled and routine.** Whole feeders are taken down on
purpose. These are not faults and must not generate tickets.

**Clocks disagree and messages arrive out of order.** Two poles that lost power
in the same instant may report timestamps a minute apart, and the downstream
one may arrive first.

**The wiring diagram is incomplete.** This is the big one, and it is deliberate.
See `02-data-and-systems.md` §3. You know where every pole *is*. You do not
reliably know which pole feeds which. For a substantial share of distribution
transformers, nobody ever digitized the order of poles along the line.

That last constraint is the heart of the assignment. You cannot walk a tree you
do not have. What you do about it — infer it from geography, ask the department
for a survey, degrade to a coarser answer, or something we haven't thought of —
is the most interesting design decision you will make, and we will read it
first.

## 5. What "good" looks like to the customer

The department will consider this a success if:

- Time from fault occurring to control room knowing the location is **under two
  minutes**, versus two hours today.
- The location is precise enough to drive to and hand to a crew — a span, not a
  ward.
- Operators trust the alerts. A system that fires on load shedding and dead
  modems gets ignored, and an ignored system has zero value.
- Ticket closure reflects reality. "Fixed" means the poles are live again, as
  measured, not as claimed.

Now go read [`02-data-and-systems.md`](02-data-and-systems.md) for the actual
data contracts.


# Data and Systems

This document is the contract. Everything here is what the department can give
you on day one. Anything not listed here, you do not have — though you are free
to argue that you need it, and to say how you would get it.

All figures are for **one subdivision** of the city. You are not being asked to
handle the whole state.

---

## 1. Scale

| Thing | Count |
|-------|-------|
| 66/11 kV substations | 4 |
| 11 kV feeders | 31 |
| Distribution transformers | 412 |
| LT poles | 38,400 |
| Poles with a telemetry device fitted | 34,900 (≈91%) |
| Households served | ≈ 210,000 |
| Outage events per day, typical | 12–18 |
| Outage events per day, monsoon peak | up to 120 |

Poles per DT ranges from 9 to about 240, median around 70. LT lines run up to
about 1.4 km from the transformer, with one to five branches off the main run.

Telemetry volume: heartbeats every 15 minutes from 34,900 devices is roughly
**39 messages/second** steady state, with bursts of a few thousand messages in
the seconds after a large outage.

---

## 2. Telemetry from the pole devices

Devices push to an HTTPS endpoint you expose. (In production they publish over
NB-IoT to an MQTT broker; for this exercise, assume you can define the ingest
interface, and say in your architecture doc how you would adapt it.)

### Payload

```json
{
  "device_id": "KSPDB-SD07-D0112-4431",
  "pole_id": "P-024431",
  "event": "power_lost",
  "energized": false,
  "ts": "2026-07-29T02:14:07.412Z",
  "seq": 88213,
  "battery_mv": 3480,
  "rssi": -91,
  "fw": "1.4.2"
}
```

| Field | Notes |
|-------|-------|
| `device_id` | Stable per physical device. Devices get swapped; the same pole can change `device_id` over time. |
| `pole_id` | Foreign key into the pole registry. Trust this over `device_id` for location. |
| `event` | One of `heartbeat`, `power_lost`, `power_restored`, `boot`. |
| `energized` | Current state as the device sees it. |
| `ts` | Device clock. **Skew up to ±90 seconds.** Do not assume monotonicity across devices. |
| `seq` | Monotonic per device, resets to 0 on `boot`. Your one reliable tool for ordering and de-duplication within a device. |
| `battery_mv` | Reserve capacitor voltage. Below ~3200 the device may fail to send its dying message. |
| `rssi` | Radio signal strength. Useful for telling "this device is in a bad coverage spot" from "this device is dead." |
| `fw` | ~8% of the fleet is on firmware 1.2.x, which **does not send `power_lost` at all** — it simply stops heartbeating. |

### Behavioural rules you can rely on

- `heartbeat` every **15 minutes ± 45 seconds** of jitter while energized.
- On power loss, firmware ≥ 1.3 attempts a single `power_lost` message from
  capacitor reserve. It succeeds roughly **70%** of the time.
- On power return, the device sends `boot` and then `power_restored`, typically
  within 20 seconds.
- **At-least-once delivery.** Duplicates happen. Retries happen for up to 6
  hours from a device that was offline, so you can receive a very stale
  `power_lost` long after the event.
- **≈4% of the fleet is offline at any moment** for unrelated reasons — dead
  modem, vandalism, water ingress, expired SIM.

### What the device does *not* tell you

No current, no voltage magnitude, no direction of flow, no phase, no impedance,
no fault type. Just live or not live. Do not design around data you wish you
had.

---

## 3. The pole registry

A one-time export, CSV. This is the department's asset database.

```csv
pole_id,lat,lon,feeder_id,dt_id,seq_on_line,parent_pole_id,pole_type,ward,pincode,device_id
P-024431,12.968214,77.594612,F-07-03,D-0112,14,P-024430,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4431
P-024432,12.968901,77.594330,F-07-03,D-0112,15,P-024431,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4432
P-024433,12.969455,77.593980,F-07-03,D-0112,,,LT-8m-Steel,W-084,560078,
```

| Column | Notes |
|--------|-------|
| `pole_id` | Primary key. |
| `lat`, `lon` | Surveyed GPS. Accurate to about ±4 m. **Always present, always trustworthy.** |
| `feeder_id` | Which 11 kV feeder ultimately supplies this pole. Always present. |
| `dt_id` | Which distribution transformer supplies this pole. Always present. |
| `seq_on_line` | Position along the LT line from the transformer, 1 = closest. **Missing for about 60% of DTs** (see below). |
| `parent_pole_id` | The pole immediately upstream. **Missing wherever `seq_on_line` is missing.** |
| `pole_type` | Material and height. Cosmetic for this exercise. |
| `ward`, `pincode` | Administrative. `pincode` is missing for ~3% of rows. |
| `device_id` | Empty where no device is fitted (≈9% of poles). |

Separately you get the transformer registry:

```csv
dt_id,feeder_id,lat,lon,capacity_kva,households_served
D-0112,F-07-03,12.967801,77.595120,250,318
```

### The missing-topology problem

**For roughly 60% of distribution transformers, `seq_on_line` and
`parent_pole_id` are empty.** Those DTs were commissioned before the asset
digitization drive, and nobody recorded the order of poles along the line. You
know which DT each pole belongs to, and you know exactly where each pole is,
but not which pole feeds which.

This is not a bug in the data export and we will not be sending you a corrected
file. It is the state of the world.

Consider it the central design question of the assignment. Some directions
candidates have taken, none of which is the official answer:

- Infer the line order geometrically from pole coordinates and the transformer
  location, and say honestly how often that inference will be wrong.
- Fall back to a coarser localization (DT-level rather than span-level) where
  topology is unknown, and be explicit in the UI about which kind of answer the
  operator is looking at.
- Use observed outage history to learn the topology over time — poles that go
  dark together are probably adjacent.
- Push the problem back to the department: specify the survey you would ask for,
  and what it would cost them.

Whatever you choose, we want the reasoning, the failure modes, and a clear
statement of what the system does in the 60% case versus the 40% case.

---

## 4. The scheduled outage feed

The department publishes planned load shedding and maintenance shutdowns. Assume
this API exists and mock it:

```
GET /scheduled-outages?from=2026-07-29T00:00:00Z&to=2026-07-30T00:00:00Z

[
  {
    "id": "SO-2026-07-29-014",
    "scope": "feeder",
    "target_id": "F-07-03",
    "start": "2026-07-29T10:00:00Z",
    "end":   "2026-07-29T12:30:00Z",
    "reason": "Planned maintenance - jumper replacement"
  },
  {
    "id": "SO-2026-07-29-021",
    "scope": "dt",
    "target_id": "D-0112",
    "start": "2026-07-29T14:00:00Z",
    "end":   "2026-07-29T15:00:00Z",
    "reason": "Load shedding"
  }
]
```

Real-world caveats that apply: shutdowns start late and overrun by 20–40 minutes
routinely, and about one in ten is cancelled without the feed being updated.
Treating this feed as gospel will cause you to miss real faults during a window
where nothing was actually switched off.

---

## 5. Geocoding and PIN codes

You need to output a PIN code with each fault, and `pincode` is missing for ~3%
of poles.

You may use any offline dataset or public API you like. If you use a hosted
geocoding service, the deployed public URL must still work for us without our
own API key — so either commit a bounded offline dataset, ship your key via
environment variables you control, or degrade gracefully with a visible note in
the UI. A submission that shows "geocoding unavailable" everywhere because the
reviewer has no key counts as broken.

---

## 6. The simulator you must build

You are not being given a data generator. Building one is part of the work,
because how you choose to simulate reveals whether you understood the physics.

At minimum, your simulator must let us:

1. Load the pole and transformer registries (generate synthetic ones matching
   the schemas and scale above — you do not need all 38,400 poles, but the
   shape must be realistic and at least a few thousand poles).
2. Inject a fault of each type: span fault, DT fault, feeder fault.
3. Produce the telemetry that such a fault would actually cause — including the
   30% of dying messages that never arrive, and the firmware-1.2 devices that
   just go quiet.
4. Inject noise independently: a device dying while power is fine, a scheduled
   outage, out-of-order and duplicate messages.
5. Repair a fault, and produce the restoration telemetry.

Make it drivable from the UI or a single documented command. We will be using
it as our primary way of evaluating whether your system works, so if it is
awkward to operate, that costs you directly.

---

## 7. Performance targets

State whether you meet these, and measure rather than guess.

| Metric | Target |
|--------|--------|
| Fault occurrence → localized ticket visible in UI | < 120 s (p95) |
| Ingest throughput sustained | ≥ 500 msg/s |
| Ingest burst tolerated without data loss | 5,000 messages in 10 s |
| Operator console load, incident list | < 2 s |
| Restoration → ticket auto-verified | < 120 s |

You will not be penalised for missing a target you have measured, documented,
and explained. You will be penalised for claiming one you never tested.

Next: [`03-deliverables-and-submission.md`](03-deliverables-and-submission.md).


# Deliverables and Submission

We review submissions in batch, by email, with **no opportunity to ask you
anything**. Every gap in your documentation is a gap we have to guess at, and we
will guess unfavourably. Assume the reviewer is competent, has 45 minutes, and
has never seen your code.

---

## Acceptance gates

These are pass/fail. A submission that fails a gate cannot be scored, and we
will not chase you for a fix.

| Gate | Requirement |
|------|-------------|
| **G1** | A **public GitHub repository** we can clone without being granted access. |
| **G2** | `git clone <repo> && cd <repo> && docker compose up` brings up the entire stack — backend, frontend, database, anything else — on a machine with only Docker installed. No manual migration step, no hand-editing of config, no separately started services. |
| **G3** | The app is **seeded on startup** with a usable synthetic network, so a reviewer sees a working system immediately rather than an empty screen. |
| **G4** | A **public URL** where the deployed system is running. Openable in a browser with no account, no invite, no VPN, no API key of ours. Free tiers are fine. |
| **G5** | The fault simulator is runnable from that public URL or from one documented command, and injecting a fault visibly produces a localized ticket. |
| **G6** | A **5-minute demo video** (Loom, YouTube unlisted, Drive link — anything we can watch) showing a fault injected, detected, localized, ticketed, repaired, and auto-verified. This is your insurance: if your deploy is down when we review, the video is what we score. |

On G4: hosting a demo on a free tier that cold-starts is fine, but say so in the
README so we wait rather than assume it is broken.

---

## Documents in the repository

Five markdown files, at the repo root. Keep them tight — we would rather read
two focused pages than ten padded ones.

### `README.md`
The front door. What it does, the one-command start, the public URL, the demo
video link, and a map of the rest of the docs. A reviewer should be able to run
your system from this file alone.

### `ARCHITECTURE.md`
The technical heart of your submission. Include:

- **A diagram.** Data flow from pole device to operator screen. Mermaid in the
  markdown, or a committed image — either is fine, hand-drawn and photographed
  is fine. It must be legible and it must match what you actually built.
- **Data sourcing and ingestion.** How telemetry arrives, how you handle
  duplicates, out-of-order messages, clock skew, and bursts.
- **Storage and internal model.** Your schema, and how you represent the
  network topology. Why this representation and not another.
- **The localization algorithm.** Explain it well enough that we could
  reimplement it. Cover: how you find the fault boundary, how you group symptoms
  into one incident, how you handle simultaneous faults, how you compute
  confidence, and **what you do about the 60% of transformers with no recorded
  pole ordering**. Give its complexity, and its known failure cases.
- **Noise handling.** Dead sensors versus real outages. Scheduled outages.
  Debouncing. What your false-positive story is.
- **API surface.** Every endpoint, its method, path, purpose, and shape. A table
  is fine; OpenAPI is better if it is generated rather than hand-maintained.
- **UI reasoning.** What the operator sees first, and why. What you deliberately
  did not put on screen. Which decision you expect to be wrong.
- **The AI feature.** What it is, why that spot and not elsewhere, what it costs
  per call, and what happens when the model is unavailable or wrong.

### `DEPLOYMENT.md`
Written for someone who has your repo and nothing else.

- Prerequisites with versions.
- Exact commands, in order, copy-pasteable.
- Every environment variable: name, what it does, whether it is required, a safe
  default. Commit a `.env.example`.
- How to verify it worked — what URL to open, what you should see.
- **A troubleshooting section.** This is not optional and it is not filler. List
  the failure modes you actually hit while building and deploying: port
  conflicts, migrations racing the database, ARM versus x86 image problems,
  memory limits on free tiers, CORS, WebSocket upgrades behind a proxy,
  cold-start timeouts. For each: the symptom you would see, and the fix.
- How to reset to a clean state.

We weight this heavily, and it is not busywork. It is the closest proxy we have
for whether you can hand work to someone else.

### `DECISIONS.md`
A log, newest first. For each meaningful decision: what you chose, what you
rejected, and why. Include the assumptions you made where the brief was
ambiguous — an assumption written down is treated as correct even where we would
have chosen differently. End with what you would do with two more weeks, and
what you know is currently wrong or fragile.

### `AI-WORKFLOW.md`
How you actually worked.

- Which AI tools, for what.
- What you delegated wholesale versus wrote yourself, and why you drew the line
  there.
- Two or three concrete cases where the AI was wrong, misleading, or confidently
  produced something you had to throw away — and how you caught it.
- Roughly how much of the final code is AI-generated. An honest estimate; we are
  not scoring this number.
- The prompts or session excerpts you consider your best work.

We are not testing whether you use AI. We are testing whether you can tell good
AI output from bad, and whether you understand what shipped. **Expect us to pick
a function in your repo and ask you to explain it line by line.**

---

## Code expectations

Not a production system, but not a hackathon demo either.

- **Tests where they matter.** We are looking for tests on the localization
  logic specifically — that is where correctness lives. Broad coverage of
  controllers and components is not what we want. If you test one thing, test
  that a known fault in a known topology produces the expected span.
- **Real commit history.** Incremental commits with meaningful messages. A
  single "initial commit" containing everything tells us nothing about how you
  work and reads as though the repo was assembled elsewhere.
- **No secrets in the repo.** If you commit a key, we will notice, and it counts
  against you regardless of whether it was live.
- Consistent formatting, and a linter you actually run.

---

## How to submit

Reply to the email you received this from, before the deadline stated there,
with:

1. **GitHub repo URL** (public)
2. **Live public URL**
3. **Demo video link**
4. **A short note, under 300 words**, in the email body: what works, what
   doesn't, what you cut and why, and the one thing you would fix first. Being
   straight with us here is a positive signal, not a confession.

Then stop. Do not push commits after the deadline — we review the state of the
default branch at the deadline timestamp, and later commits are ignored.

## Self-check before you send

- [ ] Cloned my own repo into a fresh directory and ran `docker compose up`. It worked.
- [ ] Opened my public URL in a private browsing window. It worked, with no login.
- [ ] Injected a span fault. Got exactly one ticket, correctly located, with a PIN code.
- [ ] Injected three simultaneous faults. Got three tickets, not one and not thirty.
- [ ] Killed a device's telemetry with power still on. Did **not** get a fault ticket.
- [ ] Ran a scheduled outage. Did **not** get a fault ticket.
- [ ] Repaired a fault. Ticket auto-verified from telemetry without me clicking "resolved".
- [ ] Marked a ticket resolved while the poles were still dark. The system pushed back.
- [ ] All five documents present, and the architecture diagram matches the code I shipped.
- [ ] A stranger could follow `DEPLOYMENT.md` without messaging me.
- [ ] No secrets in git history.
- [ ] I can explain every file in this repo.

Rubric and weights: [`04-evaluation.md`](04-evaluation.md).


# How We Evaluate

You get the categories and the weights. We keep the detailed scoring bands
internal, so that you build the best system you can rather than the system that
games a checklist.

Two gates come before any of this. If the stack does not come up with one
command, or there is no reachable public URL and no demo video, we cannot review
the submission at all. See `03-deliverables-and-submission.md`.

---

## Weights

| Weight | Category | What we are looking at |
|-------:|----------|------------------------|
| **25%** | **Fault localization** | Does it actually find the fault, and is the reasoning sound? Correct handling of the live/dark boundary. Grouping many dark poles into one incident. Multiple simultaneous faults. A defensible answer for the 60% of transformers with no recorded pole ordering. Robustness to missing, duplicate, late, and out-of-order telemetry. Honest confidence reporting. |
| **20%** | **Product judgment** | Did you solve the department's problem or the problem that was easiest to build? What you chose to include and exclude. Whether false positives were taken seriously. Whether the AI feature you added is in a place where it earns its keep — and whether you can argue for it. |
| **20%** | **Architecture and data design** | Whether your ingestion design survives contact with 39 msg/s and a 5,000-message burst. Your topology representation. Schema quality. API design. Whether the design would extend from one subdivision to thirty without a rewrite, and whether you know where it wouldn't. |
| **15%** | **Operator experience** | Is this usable by a non-engineer at 2 a.m.? Information hierarchy — does the most important thing dominate the screen? Map and list working together. How ambiguity and low confidence are communicated. Whether the ticket workflow matches how the work actually happens. |
| **15%** | **Documentation and reproducibility** | Whether we could run, understand, and hand off your system without talking to you. Architecture doc matching reality. The deployment troubleshooting section. Quality of your decision log and assumptions. |
| **5%** | **Engineering craft and AI leverage** | Tests on the logic that matters. Commit history that shows how you worked. Your AI workflow write-up — specifically, evidence that you can distinguish good AI output from bad. |

---

## What moves the needle most

Since you have limited hours, here is where they are best spent:

**Get the localization right and explain it well.** This is a quarter of the
score and it is also what most submissions get wrong. A system that finds the
correct span and explains its reasoning clearly, with a plain UI, scores far
better than a beautiful dashboard that alerts on every dark pole.

**Treat the missing topology as the main problem, not an edge case.** It affects
the majority of the network. A submission that quietly assumes complete wiring
data has skipped the assignment's central difficulty.

**Make it run.** Reproducibility and documentation together are 15%, and they
also gate everything else. Time spent making `docker compose up` bulletproof is
never wasted.

**Say what is broken.** Every submission has rough edges. Candidates who
document theirs consistently score higher than those who hope we won't notice,
because we do notice, and the difference between "known and documented" and
"apparently unaware" is large.

## What actively costs you

- One alert per dark pole instead of one per fault.
- No distinction between a dead sensor and a real outage.
- Firing on scheduled load shedding.
- Ticket resolution based on someone clicking a button, with no telemetry
  verification.
- An LLM doing the fault localization. If you go this route, you had better have
  a strong argument, because a graph traversal is deterministic, instant, free,
  and explainable, and a language model is none of those.
- Claiming performance numbers you never measured.
- Documentation that describes a system other than the one in the repo.
- Building crew routing, auth, or analytics instead of the core.
- A repo you cannot explain.

## After submission

Shortlisted candidates get a **30-minute call**. We will:

- Ask you to walk us through your localization algorithm.
- Pick two or three parts of your code and ask you to explain them — including
  parts an AI most likely wrote.
- Change the problem on you: another data source appears, or a constraint you
  relied on disappears. We want to see you think, not recite.
- Ask what you would do differently.

The call is about whether you understand what you shipped. Submissions built by
someone who cannot explain them do not survive it, which is why we would rather
see a smaller system you know completely than a large one you don't.

---

Questions and ground rules: [`05-faq.md`](05-faq.md).


# FAQ and Ground Rules

---

## Ground rules

**Can I use AI to build this?**
Yes, and we expect you to. Claude Code, Cursor, Copilot, ChatGPT, whatever you
like. You must document how, in `AI-WORKFLOW.md`. The only real rule is that you
understand what shipped, because we will ask you to explain specific code on the
follow-up call.

**Can I use libraries, templates, boilerplate?**
Yes. Use a graph library, a map library, an admin template, a starter kit. Say
what you used in `DECISIONS.md`. Nobody is impressed by a hand-rolled quadtree.

**Can I discuss this with other people?**
Talk to whoever you like about the problem. Do not submit someone else's work as
yours, and do not share your solution repo with other candidates — we do compare
submissions, and matching submissions get both candidates dropped.

**Can I reuse something I built before?**
Yes, if you say so and it is genuinely yours.

**What if I can't finish?**
Submit anyway. A partial system with clear documentation of what is missing beats
silence, and beats a system that pretends to be complete. Write in the submission
note what you cut and why.

---

## Scope questions

**How real does the data need to be?**
Synthetic, but shaped like the real thing. Generate a network matching the
schemas and proportions in `02-data-and-systems.md`. A few thousand poles across
a few dozen transformers is plenty; you do not need all 38,400. What matters is
that the shape is right — radial lines, branches, varying line lengths, ~9% of
poles without devices, ~60% of transformers missing pole ordering.

**Do I need real map tiles?**
Any map that renders for a reviewer with no API key of theirs is fine. Free
OpenStreetMap tiles are fine. A schematic or graph view instead of a geographic
map is a legitimate choice if you can defend it — argue it in `ARCHITECTURE.md`.

**Do I need to handle the 11 kV / HT side?**
Only to the extent that a feeder-level outage is one of the fault types you must
distinguish. No modelling of transmission.

**Do I need authentication?**
No. A hardcoded operator identity is fine. Do not spend hours on auth.

**Real-time updates, or is polling fine?**
Your call. Polling is fine if you justify it. WebSockets are fine if you get
them working through your host's proxy — note that this is a classic deployment
failure, so if you use them, test them on the deployed URL and not just locally.

**Should the system handle historical analysis or predict future faults?**
No. Out of scope, and building it instead of the core will cost you.

**Can I add features not in the brief?**
Yes, once the core works, and only if you can justify them as product decisions.
Ranking incidents by households affected, or flagging a span that has failed
three times this month, are the kinds of additions that read as good judgment.
Extra features on top of a broken core read as poor prioritisation.

---

## The hard parts, answered as far as we will answer them

**The topology is missing for most transformers. Is that intentional?**
Yes. It is the central design problem. See `02-data-and-systems.md` §3.

**Then what's the right approach to it?**
We will not tell you, because how you approach an underspecified problem is what
we are measuring. Several different answers score full marks. What does not score
is silently assuming the data is complete.

**Am I allowed to say "the department needs to do a survey" and stop there?**
Not as your whole answer. In the real engagement you would be told the survey
takes eight months and asked what you can deliver in the meantime. Specify the
survey if you think it is needed, and also ship something that works today.

**How do I tell a dead sensor from a dark pole?**
That is a core part of the assignment. `01-problem-context.md` §2 and
`02-data-and-systems.md` §2 contain everything you need to reason about it. Read
the firmware notes and the physical reasoning about what is and isn't possible
when a pole's children are still live.

**A pole with no device is on the fault boundary. Now what?**
Also part of the assignment. Your answer will probably involve reporting a range
rather than a point, and being honest about it in the UI.

**What counts as "one fault" versus two?**
Your judgement, defended in writing. Two spans failing on the same line ten
minutes apart is arguably one incident for the crew and two for the algorithm.
There is no single right answer; there are answers with reasons and answers
without.

---

## Logistics

**Deadline?**
Stated in the email that carried this brief. Seven days from receipt.

**Can I get an extension?**
Ask before the deadline, with a reason, and we will usually say yes. Asking
afterwards, we usually won't.

**Who do I contact?**
**[HIRING CONTACT EMAIL]** — for factual questions: broken links,
contradictions between documents, logistics. We will not review your approach or
tell you whether a design is right; that is the assignment.

**Is this paid work? Will you use it?**
No, and no. It is a hiring exercise. The scenario is fictional, we have no
contract with any utility, and we will not use your code. Your repo is yours —
keep it public and put it on your CV if you like.

**What happens after I submit?**
We review in batch after the deadline and reply either way within two weeks.
Shortlisted candidates get a 30-minute call — see `04-evaluation.md`.
