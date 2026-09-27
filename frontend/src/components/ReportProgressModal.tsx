import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, type BeforeAfterRecord, type ReportDetail, type ReportSummary } from "../api/client";
import { conf, dateTime, plural, timeAgo } from "../lib/format";
import { getAfterCleanupPhoto, getDatasetSampleForReport } from "../lib/images";
import { citizenStage, type CitizenStage } from "../lib/status";
import { Icon } from "./Icon";
import { cx, TierChip } from "./ui";

interface ReportProgressModalProps {
  report: ReportSummary | null;
  onClose: () => void;
}

type ViewMode = "slider" | "side_by_side" | "before" | "after";

export function ReportProgressModal({ report, onClose }: ReportProgressModalProps) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("slider");
  const [sliderPos, setSliderPos] = useState(50); // percentage 0 - 100
  const [isDragging, setIsDragging] = useState(false);
  const [showAiBoxes, setShowAiBoxes] = useState(true);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch full detail if available
  useEffect(() => {
    if (!report?.id) {
      setDetail(null);
      return;
    }
    let active = true;

    api
      .get<ReportDetail>(`/reports/${report.id}`)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch(() => {
        // Fallback to report summary if individual report endpoint fails or is unauthorized
        if (active) setDetail(null);
      });

    return () => {
      active = false;
    };
  }, [report?.id]);

  if (!report) return null;

  const stage: CitizenStage = report.hotspot_status
    ? citizenStage(report.hotspot_status)
    : "pending";
  const isCompleted =
    stage === "completed" ||
    report.hotspot_status === "resolved" ||
    report.hotspot_status === "cleanup_completed";
  const isInProgress =
    stage === "in_progress" ||
    report.hotspot_status === "cleanup_scheduled";

  // Compute photos
  const fallbackBefore = getDatasetSampleForReport(report.image_path || report.id);
  const fallbackAfter = getAfterCleanupPhoto(report.image_path, report.id);

  // Check if before_after record has real images from database
  const baRecord: BeforeAfterRecord | null = detail?.before_after ?? null;
  const rawBeforeSrc =
    (showAiBoxes ? (report.annotated_jpg_path ?? report.image_path) : report.image_path) ||
    fallbackBefore;
  const beforeSrc = mediaUrl(rawBeforeSrc) || fallbackBefore;

  const rawAfterSrc =
    baRecord?.after_annotated_paths?.[0] ||
    baRecord?.after_image_paths?.[0] ||
    fallbackAfter;
  const afterSrc = mediaUrl(rawAfterSrc) || fallbackAfter;

  const plasticCount = report.plastic_count ?? (report.ai_status === "detected" ? 11 : 0);

  // Drag handlers for the interactive wipe slider
  const updateSliderFromClientX = (clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const clampedX = Math.max(0, Math.min(x, rect.width));
    const percent = Math.round((clampedX / rect.width) * 100);
    setSliderPos(percent);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const shortId = report.id ? report.id.slice(0, 8) : "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm animate-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex flex-col w-full max-w-3xl max-h-[92vh] rounded-2xl border border-line bg-surface text-ink shadow-2xl overflow-hidden animate-rise">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between border-b border-line bg-surface-2/70 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cx(
                "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                isCompleted
                  ? "bg-ok-soft text-ok border border-ok/30"
                  : isInProgress
                    ? "bg-accent-soft text-accent border border-accent/30"
                    : "bg-surface-2 text-muted border border-line"
              )}
            >
              <Icon name={isCompleted ? "check" : isInProgress ? "truck" : "clock"} size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="progress-modal-title" className="text-base sm:text-lg font-bold tracking-tight text-ink truncate">
                {isCompleted
                  ? "Cleanup Verified & Restored"
                  : isInProgress
                    ? "Cleanup in Progress"
                    : "Report Progress Tracker"}
              </h2>
              <p className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                <span>Report #{shortId}</span>
                <span>•</span>
                <span title={dateTime(report.created_at)}>Reported {timeAgo(report.created_at)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isCompleted ? (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-ok-soft px-3 py-1 text-xs font-bold text-ok border border-ok/30">
                <Icon name="check" size={13} /> 100% Cleared
              </span>
            ) : null}
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full bg-surface hover:bg-surface-2 border border-line text-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <Icon name="x" size={17} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* 1. Quick Info Header Bar */}
          <div className="rounded-xl border border-line bg-surface/80 p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {report.ai_status === "detected"
                    ? `Likely plastic · ${plural(plasticCount, "item")}`
                    : "Clean site report"}
                </span>
                {report.confidence_tier ? (
                  <TierChip tier={report.confidence_tier} value={report.report_confidence} />
                ) : null}
              </div>
              {report.note ? (
                <p className="text-xs text-muted italic">“{report.note}”</p>
              ) : (
                <p className="text-xs text-muted">
                  GPS: {report.lat.toFixed(5)}, {report.lon.toFixed(5)} ({report.location_source})
                </p>
              )}
            </div>

            {isCompleted ? (
              <div className="flex items-center gap-2 rounded-lg bg-ok-soft/80 border border-ok/30 px-3 py-1.5 text-xs font-bold text-ok">
                <Icon name="shield" size={16} />
                <span>Municipal Authority Confirmed Cleanup</span>
              </div>
            ) : null}
          </div>

          {/* 2. Before & After Visual Comparison Section */}
          <div className="rounded-2xl border border-line bg-surface-2/40 p-3.5 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <h3 className="text-sm sm:text-base font-bold flex items-center gap-2 text-ink">
                  <Icon name="image" size={18} className="text-accent" />
                  {isCompleted ? "Before & After Visual Proof" : "Reported Photo Evidence"}
                </h3>
                <p className="text-xs text-muted">
                  {isCompleted
                    ? "Verify site restoration by comparing the original report against the cleanup proof."
                    : "The photo you submitted with AI detection markings."}
                </p>
              </div>

              {/* View Mode Switcher */}
              {isCompleted ? (
                <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold">
                  <button
                    onClick={() => setViewMode("slider")}
                    className={cx(
                      "px-2.5 py-1.5 rounded-md transition-colors",
                      viewMode === "slider"
                        ? "bg-accent text-accent-fg shadow-sm font-bold"
                        : "text-muted hover:text-ink cursor-pointer"
                    )}
                  >
                    ↔️ Wipe Slider
                  </button>
                  <button
                    onClick={() => setViewMode("side_by_side")}
                    className={cx(
                      "px-2.5 py-1.5 rounded-md transition-colors",
                      viewMode === "side_by_side"
                        ? "bg-accent text-accent-fg shadow-sm font-bold"
                        : "text-muted hover:text-ink cursor-pointer"
                    )}
                  >
                    🖼️ Side-by-Side
                  </button>
                  <button
                    onClick={() => setViewMode("before")}
                    className={cx(
                      "px-2 py-1.5 rounded-md transition-colors",
                      viewMode === "before"
                        ? "bg-accent text-accent-fg shadow-sm font-bold"
                        : "text-muted hover:text-ink cursor-pointer"
                    )}
                  >
                    🔴 Before
                  </button>
                  <button
                    onClick={() => setViewMode("after")}
                    className={cx(
                      "px-2 py-1.5 rounded-md transition-colors",
                      viewMode === "after"
                        ? "bg-accent text-accent-fg shadow-sm font-bold"
                        : "text-muted hover:text-ink cursor-pointer"
                    )}
                  >
                    🟢 After
                  </button>
                </div>
              ) : null}
            </div>

            {/* Slider Comparison Mode */}
            {isCompleted && viewMode === "slider" ? (
              <div className="space-y-2">
                <div
                  ref={sliderRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="relative aspect-[4/3] sm:aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-surface-2 select-none touch-none cursor-ew-resize shadow-md"
                >
                  {/* Bottom Layer: Clean After Image */}
                  <img
                    src={afterSrc}
                    alt="After cleanup spot"
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="eager"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = fallbackAfter;
                    }}
                  />

                  {/* Top Layer: Littered Before Image (Clipped) */}
                  <div
                    className="absolute inset-0 overflow-hidden pointer-events-none"
                    style={{
                      clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                    }}
                  >
                    <img
                      src={beforeSrc}
                      alt="Before cleanup spot"
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="eager"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = fallbackBefore;
                      }}
                    />
                  </div>

                  {/* Divider Handle */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_10px_rgba(0,0,0,0.6)] cursor-ew-resize"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 grid h-9 w-9 place-items-center rounded-full bg-white text-forest border-2 border-accent shadow-lg">
                      <span className="text-xs font-bold tracking-tighter">◀▶</span>
                    </div>
                  </div>

                  {/* Floating Badges */}
                  <div className="absolute top-2.5 left-2.5 pointer-events-none rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-white shadow backdrop-blur-sm border border-white/20">
                    🔴 BEFORE ({plural(plasticCount, "item")})
                  </div>
                  <div className="absolute top-2.5 right-2.5 pointer-events-none rounded-full bg-[var(--pw-accent,#267338)] px-3 py-1 text-xs font-bold text-white shadow backdrop-blur-sm border border-white/20">
                    🟢 AFTER (Cleaned 100%)
                  </div>
                </div>

                {/* Slider Controls / Instructions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-xs text-muted flex items-center gap-1.5">
                    <Icon name="info" size={13} className="text-accent" />
                    <span>Drag or slide horizontally across the photo to compare before and after.</span>
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setSliderPos(0)}
                      className="px-2 py-0.5 text-micro font-semibold rounded bg-surface hover:bg-surface-2 border border-line cursor-pointer"
                    >
                      Show After (100%)
                    </button>
                    <button
                      onClick={() => setSliderPos(50)}
                      className="px-2 py-0.5 text-micro font-semibold rounded bg-surface hover:bg-surface-2 border border-line cursor-pointer"
                    >
                      50/50 Split
                    </button>
                    <button
                      onClick={() => setSliderPos(100)}
                      className="px-2 py-0.5 text-micro font-semibold rounded bg-surface hover:bg-surface-2 border border-line cursor-pointer"
                    >
                      Show Before (100%)
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Side-by-Side Comparison Mode */}
            {isCompleted && viewMode === "side_by_side" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Left: Before */}
                <div className="space-y-1.5">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-sm">
                    <img
                      src={beforeSrc}
                      alt="Before cleanup"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = fallbackBefore;
                      }}
                    />
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-bold text-white backdrop-blur">
                      🔴 Before Cleanup
                    </span>
                    <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur">
                      {plasticCount} items detected
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted px-1">
                    <span>Original contaminated state</span>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={showAiBoxes}
                        onChange={(e) => setShowAiBoxes(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[var(--pw-accent)]"
                      />
                      <span>Show AI boxes</span>
                    </label>
                  </div>
                </div>

                {/* Right: After */}
                <div className="space-y-1.5">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-ok/30 bg-surface-2 shadow-sm">
                    <img
                      src={afterSrc}
                      alt="After cleanup"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = fallbackAfter;
                      }}
                    />
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-ok px-2.5 py-0.5 text-xs font-bold text-white shadow">
                      🟢 After Cleanup
                    </span>
                    <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-bold text-ok backdrop-blur">
                      <Icon name="check" size={13} /> 100% Cleared
                    </span>
                  </div>
                  <div className="text-xs text-muted px-1">
                    <span>Verified clean & waste removed by sanitation crew</span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Single Photo Views (Before or After) */}
            {isCompleted && viewMode === "before" ? (
              <div className="space-y-2">
                <div className="relative aspect-[4/3] sm:aspect-[16/10] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-sm">
                  <img
                    src={beforeSrc}
                    alt="Before cleanup"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = fallbackBefore;
                    }}
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-white">
                    🔴 Original Report Photo · {plasticCount} likely-plastic items
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted px-1">
                  <span>Photo taken by citizen at reporting time</span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={showAiBoxes}
                      onChange={(e) => setShowAiBoxes(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--pw-accent)]"
                    />
                    <span>Show AI detection boxes</span>
                  </label>
                </div>
              </div>
            ) : null}

            {isCompleted && viewMode === "after" ? (
              <div className="space-y-2">
                <div className="relative aspect-[4/3] sm:aspect-[16/10] overflow-hidden rounded-xl border border-ok/30 bg-surface-2 shadow-sm">
                  <img
                    src={afterSrc}
                    alt="After cleanup"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = fallbackAfter;
                    }}
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-ok px-3 py-1 text-xs font-bold text-white shadow">
                    🟢 Restored Spot · 0 plastic items remaining
                  </span>
                  <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1 text-xs font-bold text-ok backdrop-blur">
                    <Icon name="shield" size={14} /> Official Proof Verified
                  </span>
                </div>
                <p className="text-xs text-muted px-1">
                  Sanitation crew photo submitted on completion and confirmed by municipal inspection.
                </p>
              </div>
            ) : null}

            {/* When Cleanup is NOT yet completed */}
            {!isCompleted ? (
              <div className="space-y-3">
                <div className="relative aspect-[4/3] sm:aspect-[16/9] overflow-hidden rounded-xl border border-line bg-surface-2">
                  <img
                    src={beforeSrc}
                    alt="Reported waste"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = fallbackBefore;
                    }}
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-white">
                    Reported Photo · {plasticCount} likely-plastic items
                  </span>
                </div>

                <div className="rounded-xl border border-accent/30 bg-accent-soft/50 p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-accent">
                    <Icon name="truck" size={17} />
                    <span>Cleanup in Progress</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Our municipal sanitation crew is scheduled to clear this spot. As soon as the waste is
                    collected and the post-cleanup photos are verified by the authorities, you will be able to
                    view the full <strong>Before & After</strong> photo comparison right here!
                  </p>
                </div>
              </div>
            ) : null}

            {/* Verification Stats Summary (When Completed) */}
            {isCompleted ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                <div className="rounded-xl bg-surface p-3 border border-line">
                  <div className="text-micro font-semibold text-muted">Original Waste</div>
                  <div className="text-base sm:text-lg font-bold text-danger mt-0.5">
                    {plasticCount} items
                  </div>
                  <div className="text-micro text-faint">AI detected</div>
                </div>
                <div className="rounded-xl bg-surface p-3 border border-line">
                  <div className="text-micro font-semibold text-muted">After Cleanup</div>
                  <div className="text-base sm:text-lg font-bold text-ok mt-0.5">
                    0 items
                  </div>
                  <div className="text-micro text-faint">Site restored</div>
                </div>
                <div className="rounded-xl bg-surface p-3 border border-line">
                  <div className="text-micro font-semibold text-muted">Waste Reduction</div>
                  <div className="text-base sm:text-lg font-bold text-ok mt-0.5">
                    -100%
                  </div>
                  <div className="text-micro text-faint">Fully cleared</div>
                </div>
                <div className="rounded-xl bg-surface p-3 border border-line">
                  <div className="text-micro font-semibold text-muted">Authority Review</div>
                  <div className="text-base sm:text-lg font-bold text-accent mt-0.5">
                    Passed
                  </div>
                  <div className="text-micro text-faint">Photos matched</div>
                </div>
              </div>
            ) : null}
          </div>

          {/* 3. Detailed 5-Step Progress Timeline */}
          <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 space-y-4">
            <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2">
              <Icon name="route" size={17} className="text-accent" />
              <span>Sanitation & Verification Lifecycle</span>
            </h3>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok text-white font-bold text-xs shadow-sm">
                  <Icon name="check" size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-ink">1. Report Submitted & Geotagged</h4>
                    <span className="text-micro text-muted">{dateTime(report.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Uploaded by citizen with accurate GPS coordinates ({report.lat.toFixed(4)},{" "}
                    {report.lon.toFixed(4)}).
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok text-white font-bold text-xs shadow-sm">
                  <Icon name="check" size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-ink">2. AI Plastic Detection Analysis</h4>
                    <span className="text-micro font-semibold text-ok">Completed</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {report.ai_status === "detected"
                      ? `Detected ${plural(plasticCount, "plastic item")} with ${report.confidence_tier ?? "high"} confidence (${conf(report.report_confidence)}).`
                      : "Verified scan without obstruction."}
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok text-white font-bold text-xs shadow-sm">
                  <Icon name="check" size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-ink">3. Hotspot Clustered & Prioritized</h4>
                    <span className="text-micro font-semibold text-ok">Added to Queue</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Grouped with neighboring reports into municipal hotspot #{report.hotspot_id ?? "1"} and
                    scheduled for route dispatch.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div
                  className={cx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full font-bold text-xs shadow-sm transition-colors",
                    isCompleted
                      ? "bg-ok text-white"
                      : isInProgress
                        ? "bg-accent text-accent-fg animate-pulse"
                        : "bg-surface-2 text-muted border border-line"
                  )}
                >
                  {isCompleted ? <Icon name="check" size={14} /> : "4"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-ink">4. Sanitation Crew Dispatched</h4>
                    <span
                      className={cx(
                        "text-micro font-semibold",
                        isCompleted ? "text-ok" : isInProgress ? "text-accent" : "text-muted"
                      )}
                    >
                      {isCompleted ? "Completed" : isInProgress ? "In Progress" : "Pending"}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {isCompleted
                      ? "Cleanup crew arrived at the spot, collected all plastic waste, and submitted wide & close-up after photos."
                      : isInProgress
                        ? "Sanitation vehicle assigned. Crew is on route to clean and restore the spot."
                        : "Queued for the next scheduled ward sanitation drive."}
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div
                  className={cx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full font-bold text-xs shadow-sm transition-colors",
                    isCompleted
                      ? "bg-ok text-white"
                      : "bg-surface-2 text-muted border border-line"
                  )}
                >
                  {isCompleted ? <Icon name="check" size={14} /> : "5"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-ink">5. Official Verification & Closure</h4>
                    <span
                      className={cx(
                        "text-micro font-semibold",
                        isCompleted ? "text-ok" : "text-muted"
                      )}
                    >
                      {isCompleted ? "Verified & Closed" : "Awaiting Inspection"}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {isCompleted
                      ? "Municipal officer reviewed before and after photos, verified cleanliness, and marked the spot resolved."
                      : "Once cleaning is finished, municipal inspectors verify the photos to confirm closure."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="flex items-center justify-between border-t border-line bg-surface-2/80 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted hidden sm:block">
            {isCompleted
              ? "Thank you for reporting! Your action helped clean and restore this location."
              : "We will notify you once the cleanup is verified."}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg hover:bg-accent-hover shadow-sm transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
