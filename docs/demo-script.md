# PlasticWatch — 5-minute demo runbook

Click-by-click version of SPEC §19. Rehearse it **three times from a fresh reset** before
presenting. Every number below is what a fresh reset produces — if you see something
different, reset again.

> Everything on screen is **simulated demo data**: geotags, photos and detections are
> fabricated, and the UI says so (SIMULATED badges, the amber banner, the watermark on
> annotated photos). Say it out loud once, early.

---

## Before you present (10 minutes before)

1. Start the stack: `make up` (Windows without make: `docker compose up -d --build`).
2. First time on this machine only: `make load-geo` (sample wards, drains, water).
3. Reset the demo: `make reset-demo` — or **Dashboard → Reset demo data** (~20 s).
   Expect: `61 reports, 16 hotspots, 12 users, 6 cleanup tasks`.
4. Frontend: `cd frontend && npm run build && npm run preview` → <http://localhost:4173>
   (or `npm run dev` → <http://localhost:5173>).
5. Health: `curl -s localhost:8000/health` → `{"status":"ok","postgis":true}`.
6. Open **two browser windows** side by side:
   - Window 1 (citizen): sign in as **Citizen — Demo Citizen A**.
   - Window 2 (authority): sign in as **Authority — Demo Ward Authority**, open **Map**.
7. Have `seed/demo_images/` open in a file picker. The photos you'll use:
   `demo_01_bottles_by_drain.jpg` and `demo_02_bags_on_kerb.jpg`.
8. Location: on a laptop, browser GPS will put you in the wrong city. On the Report page
   use **Drop a pin instead** and tap just north of the blue drain line in Ward A, about
   halfway along it. (Phones need HTTPS for GPS — use the laptop.)

---

## The flow

### 0:00 — The problem (30 s, slide)
Plastic piles block drains and flood streets. Complaints arrive as scattered photos with no
location discipline, no deduplication and no way to say which pile matters most — and
existing apps tend to blame whoever is nearby. PlasticWatch ranks likely-plastic hotspots
by impact, grades the evidence separately, and lets **people, not the model**, decide.

### 0:30 — A citizen reports (60 s) · Window 1
1. **Report** tab → **From gallery** → `demo_01_bottles_by_drain.jpg`.
2. **Drop a pin instead** → tap north of the drain line (see step 8 above).
3. Note: *"Bottles against the drain cover"* → **Send report**.
4. Point at the result card:
   - the annotated photo — *"the model draws what it thinks is **likely** plastic"*;
   - **High confidence 0.8x** — *"always a tier next to the number: model confidence is not a
     probability"*;
   - the **SIMULATED DETECTION** watermark — *"demo mode; we never pass stub output off as real"*;
   - the tracker at **Pending** — nothing is verified by the AI.

### 1:30 — A second report merges (45 s) · Window 1
1. Top right → switch role to **Demo Citizen B**.
2. **Report** → `demo_02_bags_on_kerb.jpg` → pin **a few metres** from the first one → Send.
3. Result says **"Joined a nearby hotspot"** — *"reports within 30 m merge; a second
   independent reporter is what queues it for a human."*

### 2:15 — The authority's view (60 s) · Window 2
1. Refresh the **Map**. The new hotspot is there, dashed (not yet human-verified).
   - Toggle **Heatmap** — heat is weighted by Impact.
   - Point out the **drain line**: *"distance to drains and water drives Sensitivity."*
   - Drag the **time slider** back to around day 10 — the city 5 weeks ago — then **Back to live**.
2. Click the new marker → **Open evidence ledger**.
   - **Impact 50.4 / High** vs **Evidence 0.72** — *"two separate axes: Impact ranks, Evidence
     says how sure we are. A confident but wrong model can't make a pile look worse."*
   - The explanation: *"High mainly because a lot of likely plastic is visible and it's
     50 m from a drain."* Weights are tunable proposals — it says so.
   - The ledger: every step, who did it, when.

### 3:15 — The human gate (45 s) · Window 2
1. On the new hotspot: **Verify — waste is present**. Status flips to **Verified**,
   Evidence becomes **1.00 Human-verified**, and a ledger entry names you.
2. **Queue** tab → find **#14** (Ward B, the photo is mostly cans and paper) → **Reject** →
   reason **Not plastic** → Reject. *"The model flagged it; a person ruled it out. That's the point."*

### 4:00 — Outcomes (30 s) · Window 2
1. **Dashboard**: 6 KPIs, reports per day over 45 days, opened vs resolved, open hotspots by
   priority, wards. *"Every number is computed from the database — nothing hard-coded."*
2. The median time to resolve comes from real (simulated) resolve events.

### 4:30 — The honest slide (30 s)
- Detection runs on a stub in this demo; the real YOLO11s model and its measured
  precision/recall per class are in `ml/reports/` — **we do not promise an accuracy figure**.
- All geotags here are simulated; TACO photos have no GPS.
- **Reports show waste appears to be present; they do not establish who is responsible.**
  There is no field anywhere for "who dumped it".
- Future scope: real local photo set, trained weights, hosted deployment.
- Careful novelty claim: *"we found no existing system combining these."*

---

## If something goes wrong

| Symptom | Do this |
|---|---|
| Numbers differ from this script | Dashboard → **Reset demo data** (or `make reset-demo`) and restart the flow. |
| "Photo is too blurry" | That's the quality gate working (`demo_08_blurry.jpg` shows it on purpose). Use `demo_01`. |
| "No likely plastic was found" | You picked `demo_07_clean_street.jpg` — the rejection path. Use `demo_01`. |
| Result says "Same photo already reported" | You uploaded `demo_01` twice — pHash dedupe caught it. Use `demo_02` for the second report. |
| Map tiles are grey / "Map tiles unavailable" | No internet. Hotspots, drains and wards still render; carry on. |
| Upload hangs | The detector cache answers the demo photos instantly; check `docker compose logs api`. |
| Routing / OpenRouteService unavailable | Routes fall back to the built-in greedy route automatically. |
| A 403 / "Only an authority can…" toast | You're signed in as the wrong role — use the role switcher (top right). |

## Reference: a fresh reset contains

16 hotspots over 45 days in 3 wards · 61 reports (all simulated) · 5 in the verification queue ·
2 resolved · 2 ruled out · 2 hotspots that came back after cleanup (recurrence) · 1 duplicate
photo · 3 reports rejected as "no likely plastic" · 6 cleanup tasks with cached routes.
