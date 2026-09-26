# PlasticWatch — jury brief

Everything you need to explain and defend the solution. `demo-script.md` is the timed live
walkthrough; **this** is what to study so you can answer anything they ask.

Rule for the whole session: **never claim a number you cannot show.** The strongest thing
about this project is that it is honest about what it does not know. Lead with that.

---

## 1. The 60-second answer

> Cities cannot clean what they cannot see. Complaints arrive as scattered phone calls with no
> location, no evidence and no priority.
>
> PlasticWatch turns a citizen photo into a ranked, verifiable cleanup task. The photo is
> checked for quality, an AI model flags **likely** plastic, duplicate reports of the same spot
> are merged into one hotspot, and that hotspot is ranked by how much damage it can do — how
> severe, how often it returns, how close it is to a drain or water, how long it has stayed open.
>
> The officer sees a ranked queue instead of an inbox. **Nothing is ever marked verified or
> resolved by the software — only a person can do that.**

If you say only one more sentence, say this one:

> We designed it to work even when the AI is wrong.

---

## 2. What actually happens to one photo

Walk this out loud; it is the spine of the whole product.

| # | Step | What it does | Why it matters |
|---|---|---|---|
| 1 | **Photo in** | Location from phone GPS, photo EXIF, or a manual map pin | Reports without location are useless |
| 2 | **Quality gate** | Rejects blurry / too dark images *before* storing | Stops garbage entering the evidence base |
| 3 | **Detect** | YOLO11s finds likely-plastic objects, returns boxes + confidence | The AI signal |
| 4 | **Dedupe** | Perceptual hash (pHash) + 30 m radius | Ten people photographing one pile = one hotspot, not ten |
| 5 | **Cluster** | Report attaches to an existing hotspot or opens a new one | Turns reports into places |
| 6 | **Score** | Impact = Severity + Recurrence + Sensitivity + Persistence | Turns places into a work order |
| 7 | **Human gate** | An authority verifies, schedules, and closes | The software never closes anything |

**Impact weights** (tunable proposals, shown in the UI breakdown — not published truth):
Severity `0.35` · Recurrence `0.25` · Sensitivity to drains/water `0.30` · Persistence `0.10`.

**Promotion rule:** a hotspot only enters the human review queue at **2+ distinct reporters**
and **evidence ≥ 0.6**. One person cannot create work for the council on their own.

---

## 3. Tech stack — what, and *why*

Expect "why did you choose X?" for every row. These are the answers.

| Layer | Choice | Why this one |
|---|---|---|
| Detection | **Ultralytics YOLO11s** | Runs in real time on one modest GPU, small enough to self-host, mature tooling. We need boxes, not pixel-perfect masks — so segmentation would cost more for no decision value. |
| Duplicate detection | **pHash (`imagehash`)** | Near-duplicate photos of the same pile hash alike even at different exposure/crop. No model, no training, milliseconds. |
| Spatial engine | **PostgreSQL + PostGIS** | The ranking is a spatial question — "how close to a drain?". PostGIS answers it in SQL with a real geodesic distance (`::geography`), GiST-indexed. Doing this in Python would be slow and wrong at scale. |
| API | **FastAPI** | Typed request/response models via Pydantic, OpenAPI generated automatically — the frontend's TypeScript types are generated from that schema, so the contract cannot silently drift. |
| Frontend | **React + Vite + Tailwind** | Fast iteration, and design tokens live in one file so the whole UI stays consistent. |
| Map | **Leaflet + OSM** | No API key, no per-load billing, works offline-ish for a demo. |
| Routing | **OpenRouteService**, greedy nearest-neighbour fallback | Real optimisation when the quota allows; the fallback means a dead API never kills the demo. |
| Auth | **PBKDF2-HMAC-SHA256, stdlib only** | No new dependency, no secret sent anywhere. See §6. |

**Why coordinates are stored once.** Every distance (to drain, water, ward) is computed **when
the hotspot is created or moves**, then stored on the row. We never recompute per request. That
is why the map stays fast with a growing dataset.

**Scale of the build:** 8 API routers · 20 domain services · 33 endpoints · **147 automated tests**.

---

## 3.5 The model's real numbers — memorise these

Quote these exactly. They are reproducible from `ml/reports/metrics.md`.

**YOLO11s, trained on TACO, validated on 340 held-out images (1,017 instances):**

| | value |
|---|---|
| **mAP50 (all classes)** | **0.249** |
| mAP50-95 | 0.181 |
| Precision | 0.329 |
| Recall | 0.340 |
| Best class | `plastic_bottle` — mAP50 0.304 |
| Weakest class | `plastic_bag_film` — mAP50 0.202 |

**Context that makes this defensible:**

- The previous run scored **mAP50 0.041**. This is a **6.1× improvement**.
- Training ran **90 of a planned 150 epochs** and was interrupted — the curve had not
  flattened, so this is a floor.
- The validation split is **by TACO batch folder, never random**. TACO batches are repeated
  shoots of the same location; a random split would leak near-duplicate photos into validation
  and inflate every number. We chose the harder, honest split. **Say this if challenged** — it
  is a methodological point most teams get wrong.

**How to say it out loud:**

> Our detector reaches mAP50 of 0.25 on a held-out split. That is modest, and we are not going
> to dress it up. It is what fifteen hundred cluttered real-world photos support. What matters
> is that the system was designed for exactly this: two independent reporters and a human
> officer stand between any detection and any action.

**Never say "accuracy".** mAP is not accuracy, and a juror who knows the difference will notice.

---

## 4. What is genuinely new here

Be careful with novelty language. Say *"we found no existing system combining these"* — never
"first ever". A jury will punish an overclaim and reward precision.

1. **Evidence before authority.** Most reporting apps treat one report as one ticket. We treat a
   report as *evidence*, and require corroboration before a human is asked to spend time.
2. **Ranking by environmental pathway, not by volume.** A small pile beside a storm drain
   outranks a large pile in a dry lot, because the drain is how plastic reaches water.
3. **Designed around an unreliable model.** The architecture assumes the detector is mediocre and
   still produces trustworthy output. That is a design stance, not a limitation.
4. **Honesty enforced in code, not in the pitch.** See §5 — these are rules in the repository,
   with tests, not promises on a slide.

---

## 5. The honesty architecture — your strongest card

Nine rules are written into the project's own law file and enforced in code and tests:

- Always **"likely plastic"**, never "plastic" — the class comes from our own category map, not
  from a ground truth label.
- **All simulated data is badged.** TACO photos have no GPS, so our demo geotags are invented —
  and the UI says so, everywhere it shows them.
- **No attribution, ever.** There is no database column, API field or UI string that names who
  dumped anything. A persistent note says: *reports show waste appears to be present; they do
  not establish who is responsible.*
- **No detection of people, vehicles or licence plates.** The detector drops those labels before
  they can leave the module — and there is a test that proves it.
- **Nothing is verified or resolved without a human action.**
- **Absence of detections after cleanup is not proof of cleanliness.**
- **Raw confidence is never shown without a Low/Medium/High tier**, because a model's confidence
  is not a calibrated probability.
- **Scoring weights are labelled tunable proposals**, and the breakdown is shown in the UI.

> If a juror asks "how do we know you're not overstating the AI?" — this section *is* the answer.
> Offer to show the non-attribution note and the SIMULATED badge on screen.

---

## 6. Security and auth — answer this honestly

This is where teams get caught. Do not claim production security. Claim *appropriate* security
with a clear upgrade path.

### What we did

| Area | Implementation |
|---|---|
| Password storage | **PBKDF2-HMAC-SHA256**, 100,000 iterations, **16-byte random salt per user**, constant-time comparison. No plaintext, no reversible encoding. |
| Dependencies | Python standard library only — no third-party crypto to audit or patch. |
| Role enforcement | Every endpoint declares its role. Citizen / authority / team are separated server-side; a role violation returns **403**, not a hidden button. |
| State machine | Illegal workflow transitions return **409 Conflict**. You cannot skip the verification gate by crafting a request. |
| Data minimisation | The one public endpoint returns **counts only** — no coordinates, no hotspot ids, no reporter data. Everything that could locate a hotspot sits behind an authority role. |
| Privacy by design | The detector is structurally incapable of reporting people or vehicles. |

### What we did NOT do — say this before they ask

- **The demo login is not production authentication.** Seeded accounts share a known password so
  judges can get in fast. The token secret is a default value in the example config.
- **No rate limiting.** A determined attacker could brute-force the login endpoint.
- **No email verification, password reset, or session revocation.**
- **No HTTPS enforcement or secure-cookie policy** — the token is handled client-side.
- **No audit log of authority actions** beyond the hotspot event trail.

**The honest framing:**

> We built the security that the trust model actually needs — hashed passwords, server-side role
> enforcement, and a privacy-preserving detector. We deliberately did not build the operational
> hardening a municipal deployment requires: rate limiting, credential recovery, session
> revocation, audit logging. Those are known, scoped, and listed — not forgotten.

That answer is stronger than pretending it is secure.

---

## 7. Known limitations — own them first

| Limitation | The honest line |
|---|---|
| **Detector accuracy is modest** | Trained on TACO: ~1,500 photos. Published results on this dataset sit in a similar range. Our architecture is built to survive it. |
| **One class is badly under-trained** | `plastic_packaging` has only 141 training examples versus 2,009 for non-plastic litter. More epochs cannot fix a data shortage. |
| **Demo geotags are simulated** | TACO images carry no GPS. Every simulated value is badged in the UI. |
| **Single city** | The spatial layers are loaded for one demo area. |
| **Reporter reliability is static (0.5)** | We do not learn who is trustworthy — that needs real usage data and raises fairness questions we chose not to hand-wave. |
| **Free-tier hosting sleeps** | The hosted API cold-starts after idle. Wake it before presenting. |

---

## 8. What we would do next

Ordered by impact, so you can answer "what's your roadmap?" crisply.

1. **More and better training data.** The single biggest lever. TACO alone caps accuracy; adding
   locally-photographed Indian street waste would matter more than any architecture change.
2. **Calibrate confidence.** Convert raw model scores into probabilities that mean what they say,
   so the Low/Medium/High tiers are statistically grounded rather than threshold-based.
3. **Harden auth for deployment** — rate limiting, password reset, session revocation, audit log.
4. **Close the feedback loop.** Every authority verify/reject is a free training label. Feeding
   those back would improve the detector with real municipal data.
5. **Learned reporter reliability**, with an explicit fairness review — deliberately deferred.
6. **Multi-city** — the schema supports wards; the spatial loading step needs generalising.

---

## 9. Likely questions, and the answers

**"How accurate is your AI?"**
Give the real number, then reframe: *"Our detector is modest, and that's why the system doesn't
depend on it. Two independent reporters and a human officer stand between a detection and any
action."* Never quote an accuracy figure you cannot reproduce on screen.

**"What if the AI is wrong?"**
Then nothing bad happens. A false positive sits in a queue until a human rejects it. A false
negative means the hotspot needs one more citizen report. There is no automated consequence.

**"Isn't this just a complaint app?"**
A complaint app produces tickets. We produce *ranked, corroborated, spatially-aware evidence*.
The difference is the merge step and the impact score.

**"How do you stop misuse / false reports?"**
Corroboration: 2+ distinct reporters before anything enters the human queue. Duplicate photos are
detected by hash and do not count as new evidence.

**"Is citizen data safe?"**
Passwords are salted and hashed with PBKDF2. The detector cannot report people or vehicles. The
public endpoint exposes counts only. Then state the gaps from §6 before they find them.

**"Why not use satellite imagery / CCTV?"**
Resolution and privacy. Street-level plastic is below useful satellite resolution, and CCTV
raises surveillance issues we deliberately refused — no person or vehicle detection, ever.

**"Can this scale?"**
The expensive spatial work is done once at write time and indexed. Reads are simple queries.
The detector is the bottleneck, and it scales horizontally.

---

## 10. Three things to say in the last 30 seconds

1. It works **because** it does not trust the AI blindly.
2. Every number on screen is either live from the database or badged as simulated.
3. The limitations in §6 and §7 are written down in our repository — we found them ourselves.
