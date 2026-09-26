# PlasticWatch — MVP Presentation & Pitch Script
*The Ultimate Hackathon Jury & Demo Walkthrough Guide*

---

## ⏱️ Pitch Formats at a Glance

| Format | Timing | Ideal For |
|---|---|---|
| **Elevator Pitch** | 30–45 seconds | Quick judge introductions, booth walk-bys |
| **Standard Hackathon Pitch** | 3 minutes | Stage presentations, standard judge rounds |
| **Full Technical Walkthrough** | 5 minutes | Deep-dive jury rounds with live clicking |

---

## 🚀 Part 1: The 30-Second Elevator Pitch

> *"Every monsoon, cities drown not because of excess rain, but because storm drains are clogged with plastic waste. Existing civic portals like Swachhata fail because they act as dumb digital complaint boxes—inundated with duplicate photos, zero location discipline, and no clue which pile actually threatens a waterway.*
> 
> *Enter **PlasticWatch**: an AI-GIS intelligence platform that turns citizen smartphone photos into prioritized municipal action. We run an ensemble of edge-optimized YOLO models and PostGIS spatial clustering to merge duplicate reports within 30 meters, rank hotspots by **drain-proximity flood risk**, and keep a **human in the loop** with an auditable verification ledger. We don't just find garbage; we stop urban flooding before it starts."*

---

## 🎙️ Part 2: The 3-Minute Standard Hackathon Pitch

### 0:00 – 0:45 | Act 1: The Pain Point (Why Current Solutions Fail)
*"Honorable jury members, consider this common scenario: A resident snaps a blurry picture of trash on a street corner and uploads it to a municipal portal. Three other neighbors upload the same pile. 
Now the municipal ward officer has four unranked, unverified tickets in their inbox. They have no idea if that pile is 50 meters upstream of a critical storm nala or just an empty paper carton on an empty sidewalk.
Result? Response fatigue, delayed cleanup, clogged storm drains, and urban street flooding.

**PlasticWatch solves this broken pipeline with three foundational pillars: Spatial Intelligence, Model Ensembling, and Civic Honesty.**"*

### 0:45 – 2:00 | Act 2: Live Product Demonstration (Citizen to City Hall)
*(Switch screen to Browser Window 1: Citizen View at `/report`)*

*"Let's look at the citizen experience.
1. **Pre-Submission AI Scan**: As Citizen A, I upload a photo of plastic litter near a kerbside drain. Instantly, our client-side pre-check tests for blur. Before even submitting, the user sees an interactive **Scan Preview** powered by our YOLO and Roboflow cloud ensemble. It identifies single-use plastics—bottles, plastic films, food packaging—labeled with confidence tiers: High, Medium, or Low.
2. **Geo-Deduplication**: When I pin the location and submit, it doesn't create an isolated ticket. If Citizen B submits another photo 15 meters away, PlasticWatch's PostGIS spatial engine automatically recognizes proximity and merges them into a single consolidated **Hotspot**.*

*(Switch screen to Browser Window 2: Authority Dashboard at `/dashboard`)*

*3. **Authority Command Center**: Now, looking at the Ward Authority dashboard, notice how the map isn't just pins—it's a live risk intelligence layer. We overlay **active stormwater drains, nalas, rivers, and sensitive institutions like schools and hospitals**.
4. **Dual-Axis Ranking**: Notice our prioritization. We separate **Impact Score** from **Evidence Score**. 
   - A hotspot 15 meters from an open drain gets an immediate high impact score because of flood and marine contamination risk.
   - But we never let AI act as judge and jury. The status remains **Pending** until a municipal officer clicks **Verify**. One click records the official's identity onto an immutable audit ledger and dispatches a route-optimized cleanup crew.*

### 2:00 – 2:35 | Act 3: Verification & The Cleanup Loop
*(Click into Hotspot drawer -> Before/After comparison)*

*"PlasticWatch doesn't stop at dispatch. When the sanitation team finishes, they upload after-photos. 
Our vision pipeline runs a comparative feature match:
- It computes plastic surface area reduction (e.g., -100%).
- It performs a keypoint background check to confirm the photo was taken at the exact same location, preventing fraudulent cleanup sign-offs.
- The authority inspects the side-by-side slider and closes the ticket with absolute civic accountability."*

### 2:35 – 3:00 | Act 4: Civic Honesty & Tech Stack
*"Under the hood, we run **FastAPI with PostGIS**, a lightweight **YOLO11n + Roboflow Serverless Cloud API ensemble**, perceptual image hashing (pHash) for duplicate photo rejection, and a snappy **React 19 + Tailwind** interface.

Most importantly, we built PlasticWatch on a strict **Non-Attribution Principle**: our model detects waste presence—it never surveils or attributes blame to individuals. 
PlasticWatch transforms civic complaints into prioritized flood-prevention intelligence. Thank you, and we're ready for your questions!"*

---

## 🖱️ Part 3: Click-by-Click Live Demo Runbook (5-Minute Deep Dive)

### Setup Checklist (Do this 5 minutes before presenting)
- [ ] Open Browser 1: `http://localhost:5173/#/report` (Logged in as **Locals — Demo Citizen A**)
- [ ] Open Browser 2: `http://localhost:5173/#/dashboard` (Logged in as **Government — Demo Ward Authority**)
- [ ] Have test images ready on your desktop:
  - `demo_01_bottles_by_drain.jpg`
  - `demo_02_bags_on_kerb.jpg`
  - `demo_05_after_cleanup_wide.jpg` / `demo_06_after_cleanup_close.jpg`

---

### Step 1: The Citizen Report (`/report`)
- **Action**: Click **From gallery** or drag & drop `demo_01_bottles_by_drain.jpg`.
- **What to say**:
  > *"When a resident takes a photo, PlasticWatch immediately executes two client-side gates: a Laplacian blur quality check, and an interactive scan preview. Notice the bounding boxes: plastic bottles and films are highlighted with their confidence tiers."*
- **Action**: Tap **Drop a pin instead**, drop it near the blue drain line on the map. Type note: *"Bottles blocking storm drain grate."* Click **Send report**.
- **What to say**:
  > *"Notice the receipt card: it's clearly tagged with confidence tiers, and the status is 'Pending'. We never promise accuracy numbers we can't prove; we present confidence tiers."*

---

### Step 2: Spatial Merging & Deduplication
- **Action**: Switch user role to **Demo Citizen B** (top right dropdown). Upload `demo_02_bags_on_kerb.jpg`, drop pin 10–15 meters away from the first. Click **Send report**.
- **What to say**:
  > *"Look at the feedback message: 'Joined a nearby hotspot'. Instead of spamming the municipality with two separate complaints for the same corner, PostGIS spatial clustering merged them. A second independent report also increases the evidence score."*

---

### Step 3: The Ward Authority Dashboard (`/dashboard`)
- **Action**: Switch to Browser Window 2 (Dashboard). Point at top KPI cards, then GIS Map.
- **What to say**:
  > *"Here is the Ward Authority view. Across the top, live KPIs track Hotspots, Merged Reports, and Cleanup Progress.
  > On the map, toggle our spatial layers: **Drains & Nalas**, **Water Bodies**, and **Heatmap**."*
- **Action**: Click the newly merged hotspot pin (or select it from the Priority list).
- **What to say**:
  > *"Look at the ranking criteria: this isn't first-come, first-served. It's ranked by **Impact**. Because this hotspot is within 30 meters of a stormwater nala, its sensitivity multiplier spikes. It poses an immediate drainage hazard."*

---

### Step 4: The Human Gate & Dispatch
- **Action**: In the drawer, point out the **Dual Axis**: Impact (e.g. 50.4) vs Evidence (e.g. 0.75). Point to the immutable ledger.
- **Action**: Click **Verify — waste is present**. Evidence turns to `1.00 Human-verified`.
- **Action**: Click **Dispatch cleanup**.
- **What to say**:
  > *"Notice this pivotal architectural principle: AI only recommends; humans authorize. When the officer clicks 'Verify', the evidence score locks to 1.00 Human-verified and logs their name and timestamp. Clicking 'Dispatch' moves the ticket into 'Work in progress' and computes the optimal pickup route."*

---

### Step 5: Before / After Verification & Resolution
- **Action**: Open hotspot **#5** (Cleanup Scheduled) from the list. Scroll to **Cleanup photos**.
- **Action**: Upload `demo_05_after_cleanup_wide.jpg` and `demo_06_after_cleanup_close.jpg`. Click **Send after-photos**.
- **What to say**:
  > *"When the crew finishes, they submit wide-angle and close-up proof. The system performs two checks:
  > First, a vision re-scan showing a 100% reduction in detected plastic area.
  > Second, an invariant street-feature check confirming the before and after photos match the same physical geolocation.
  > The officer reviews the split slider and approves completion."*

---

## 🛡️ Part 4: Jury Trap Defense & Rapid-Fire Q&A

### Q1: "What if someone uploads a meme, a downloaded stock photo, or a fake image?"
> **Your Answer**:
> *"We have a multi-stage defense in depth:
> 1. **EXIF & Temporal Validation**: We inspect camera metadata and timestamp freshness.
> 2. **Perceptual Hashing (pHash)**: Rejects identical image bytes or cropped duplicates instantly.
> 3. **AI Class Filter**: If no recognized plastic or waste classes are detected above threshold, the report is rejected at the gate.
> 4. **Spatial Consensus**: A single unverified report cannot trigger a costly municipal dispatch without either spatial cluster reinforcement or human officer sign-off."*

### Q2: "Why can't you just run the model on the citizen's phone?"
> **Your Answer**:
> *"We actually support a hybrid architecture: lightweight client-side pre-filtering (blur detection, resolution, basic object bounds) happens in the browser. However, authoritative verification runs our server-side ensemble—combining our custom YOLO11 weights trained on TACO with Roboflow cloud models via Non-Maximum Suppression (NMS). This prevents client-side tampering, keeps mobile battery consumption minimal, and allows model updates without requiring app store updates."*

### Q3: "What prevents municipal workers from taking a photo of a clean street elsewhere to fake a cleanup?"
> **Your Answer**:
> *"Our 'Same-Place' verification algorithm analyzes background visual invariants (kerb contours, building facades, road textures) between the before-photo and after-photo. If the background features fail to correlate, the UI flags the upload as 'Inconclusive / Location Unverified' and disables one-click auto-approval, requiring supervisor escalation."*

### Q4: "What about user privacy and surveillance concerns?"
> **Your Answer**:
> *"Privacy is baked into our code through our **Forbidden Class Filter**. Any detection bounding boxes matching persons, faces, or vehicle license plates are strictly stripped before storage or display. Furthermore, our system adheres to strict **Non-Attribution**: we document where plastic accumulates to protect waterways; we never record or speculate on who put it there."*

### Q5: "How does this scale to an entire mega-city?"
> **Your Answer**:
> *"Because all spatial operations run on PostGIS with R-tree spatial indexing (`ST_DWithin`, spatial partitions by Ward ID), clustering millions of points takes single-digit milliseconds. Inference runs asynchronously via background workers and serverless endpoints, ensuring the API never blocks."*

---

## 🏆 Part 5: Winning Delivery Tips
1. **Never say 'Our AI is 99% accurate'**: Hackathon judges hate fake precision. Say: *"We provide calibrated confidence tiers (High/Medium/Low) and keep humans in the loop."*
2. **Emphasize the Problem-to-Impact link**: Remind them: *"This isn't an aesthetic litter app; it's a flood mitigation and drainage protection system."*
3. **Show, Don't Tell**: Keep your hands on the trackpad. Let the screen do the talking while you explain the *why*, not just the *what*.
