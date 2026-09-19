# Working with Claude Code — PlasticWatch

## How to work with Claude Code (10 rules)
1. **One stage per session.** `/clear` between stages so context stays clean; each stage in `docs/CLAUDE_CODE_STAGES.md` is self-contained.
2. **Always plan first.** Every stage forces plan mode — read the plan, correct it, *then* say "go". Never let it edit before you approve.
3. **Commit per stage.** After a stage's acceptance checks pass: `git add -A && git commit -m "Stage N: <what>"`. One green stage = one commit.
4. **Contract-first is sacred.** The detector contract (SPEC §6), OpenAPI stubs, and GeoJSON layer shapes are frozen on Day 1. If a stage would change a frozen contract, stop and confirm with the team first.
5. **Stub-first, always.** Keep `DETECTOR_MODE=stub` until ML-3 delivers real weights. The whole app must demo on the stub.
6. **Fight scope creep.** If Claude Code proposes anything in CLAUDE.md §8 "Do NOT build", reject it. New dependency? It must be justified in `docs/SPEC.md §4` first.
7. **When tests fail:** paste the failing output back, ask for a *minimal* fix, re-run the exact acceptance command. Don't let it "improve" unrelated code while fixing.
8. **Verify with the acceptance command, not vibes.** Run the literal curl/pytest/UI step in the stage. "Looks done" isn't done (CLAUDE.md §7).
9. **Honesty rules are non-negotiable.** If output ever says "plastic" (not "likely"), attributes blame, detects people/vehicles/plates, or auto-resolves — reject and cite CLAUDE.md §2.
10. **Keep files small; re-read CLAUDE.md if it drifts.** If Claude Code forgets a rule mid-session, tell it to re-read CLAUDE.md before continuing.

## Parallel work map (5 people)
Contracts frozen Day 1 unblock everyone: **OpenAPI stubs (Stage 1)**, **detect() shape (Stage 3/SPEC §6)**, **GeoJSON layer shapes (Stage 1/2)**.

| Person | Role | Owns (SPEC §19 tasks) | Claude Code stages | Can start after |
|---|---|---|---|---|
| **B** | Backend lead | B1–B12 | **Stage 0**, then 1, 3, 4, 5, 6, 7 | Stage 0 blocks everyone |
| **C** | GIS + data | G1–G8 | **Stage 2**, feeds 6, 10; P1-A routing | Stage 0 done |
| **A** | AI/ML lead | A1–A10 | **ML-1, ML-2, ML-3** (outside Claude Code); consult on Stage 3 contract | Day 0 (TACO download); ML-3 after ML-2 |
| **D** | Frontend lead | F1–F8 | **Stage 8, Stage 9** (on real API); P1-A team UI | Stage 1 (mocks) → real API after Stage 6/7 |
| **E** | Citizen/team UI + QA + docs | E1–E7 | citizen/team parts of Stage 8 + P1-B UI; runs E4 QA + E5 docs/deck + E7 photo session | Stage 1 for UI; Stage 10 for demo-script |

**Dependency spine:** Stage 0 (B) → {Stage 1 (B) ‖ Stage 2 (C) ‖ ML-1/2 (A)} → Stage 3 (B, needs §6 frozen) → Stage 4 → Stage 5 → Stage 6 (needs 2–5) → Stage 7 → {Stage 8 (D) ‖ Stage 9 (D/E)} → Stage 10 (B+C+E) → [cut line] → P1-A (C/D) → P1-B (A/B + E UI).
Frontend (D/E) works on Stage 1 fixtures from Day 1 and swaps to the real API after Stage 6/7 — never blocked waiting on backend.

## With 4 people (fold-down)
Drop Person E as a separate seat: fold citizen/team UI (E1–E3) into **D** after the queue lands; give QA/docs (E4/E5) to whoever is currently blocked; cut **F6 dashboard charts to KPI cards only** (allowed by SPEC §2). Build the **cut line** target: F1–F7 + F11 + KPI-only F8; describe F9/F10 as *designed, not built*.

## Suggested day plan (maps milestones → stages)
- **Day 0:** Stage 0 (`make up` for all). A starts TACO download. C picks demo area (SPEC §20 #1) + Overpass pull.
- **Day 1:** Stage 1 + Stage 2 + Stage 3. Freeze all three contracts. D builds shell on fixtures. A converts TACO (ML-1) + starts training (ML-2).
- **Day 2:** Stage 4 + Stage 5 + Stage 6 (golden test green). A finishes training, ML-3 swap-in. E runs the local photo session (feeds A6/G6).
- **Day 3:** Stage 7 + Stage 8. P0 path clickable.
- **Day 3–4:** Stage 9 + Stage 10 (one-command reset, time slider, 3 dry runs). **This is the safe cut line — a full demo exists here.**
- **Day 4–5 (only if ahead):** P1-A + P1-B.
- **Day 5–6:** deck, README, backup video, hosted backup, 3 more dry runs, freeze.
