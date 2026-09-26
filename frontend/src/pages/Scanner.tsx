/**
 * AI Plastic Scanner & Detection Interface.
 *
 * Uploads photos to the backend /detect endpoint which proxies requests to the
 * Roboflow model ("plastic-bags-aenhn/1" and ensemble) server-side, keeping
 * ROBOFLOW_API_KEY completely secret on the server.
 *
 * Draws returned bounding boxes and "Plastic" labels directly over the image,
 * with loading animations, empty state (no detections), and error handling.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type DetectPreview, type Detection, type DetectionClass } from "../api/client";
import { Icon } from "../components/Icon";
import { Shell } from "../components/Shell";
import { Button, Card, SimulatedBadge, Spinner, TierChip, cx } from "../components/ui";

const CLASS_LABEL: Record<DetectionClass, string> = {
  plastic_bottle: "Likely bottle",
  plastic_bag_film: "Likely bag / film",
  plastic_packaging: "Likely packaging",
  plastic_other: "Other likely plastic",
  non_plastic_litter: "Non-plastic litter",
};

const PLASTIC_CLASSES: DetectionClass[] = [
  "plastic_bottle",
  "plastic_bag_film",
  "plastic_packaging",
  "plastic_other",
];

const SAMPLES = [
  { name: "Plastic Bags on Curb", url: "/samples/bags.jpg", desc: "Single-use polythene bags" },
  { name: "Plastic Bottles near Drain", url: "/samples/bottles.jpg", desc: "Bottles choking drain grate" },
  { name: "Clean Pavement", url: "/samples/clean_street.jpg", desc: "No litter baseline check" },
];

export default function Scanner() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<DetectPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Sync preview object URL
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setScan(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setScan(null);
    setError(null);
    runInference(file);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const runInference = async (targetFile: File) => {
    setScanning(true);
    setError(null);
    setScan(null);

    const form = new FormData();
    form.append("image", targetFile);

    try {
      // Calls server-side /detect endpoint — ROBOFLOW_API_KEY stays strictly on the server!
      const result = await api.upload<DetectPreview>("/detect", form);
      setScan(result);
    } catch (e: any) {
      const msg = e?.message || "Failed to analyze image. Please try again or check connection.";
      setError(msg);
    } finally {
      setScanning(false);
    }
  };

  const loadSample = async (sampleUrl: string, sampleName: string) => {
    try {
      setScanning(true);
      setError(null);
      const res = await fetch(sampleUrl);
      const blob = await res.blob();
      const sampleFile = new File([blob], `${sampleName.toLowerCase().replace(/\s+/g, "_")}.jpg`, {
        type: "image/jpeg",
      });
      setFile(sampleFile);
    } catch {
      setError("Could not load sample image.");
      setScanning(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type.startsWith("image/")) {
      setFile(droppedFile);
    } else {
      setError("Please drop a valid image file (JPEG, PNG, WebP).");
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setScan(null);
    setError(null);
  };

  const detections = scan?.result.detections ?? [];
  const plasticCount = scan?.result.plastic_count ?? 0;
  const noDetectionsFound = scan !== null && !scanning && detections.length === 0;

  return (
    <Shell>
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        {/* Header & Model Metadata */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon name="detect" size={18} />
              </span>
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                AI Plastic Detector
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted">
              Roboflow Computer Vision inference for <span className="font-semibold text-ink">plastic-management/1</span> and ensemble models.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Server-side API · Private Key Protected</span>
          </div>
        </div>

        {/* Error Banner */}
        {error ? (
          <div className="mb-5 flex items-start gap-3 rounded-field border border-danger/30 bg-danger/10 p-4 text-sm text-danger animate-rise">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Detection Error</p>
              <p className="mt-0.5 text-xs opacity-90">{error}</p>
            </div>
            <Button
              variant="ghost"
              className="text-xs !min-h-8 !px-2.5"
              onClick={() => (file ? runInference(file) : reset())}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {/* Upload Zone (when no file is chosen) */}
        {!previewUrl ? (
          <div className="space-y-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={cx(
                "relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200",
                isDragOver
                  ? "border-accent bg-accent/5 scale-[1.01]"
                  : "border-line bg-surface hover:border-accent/60 hover:bg-surface-2",
              )}
            >
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-accent shadow-sm">
                <Icon name="upload" size={28} />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-ink">
                Upload or Drop an Image to Scan
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Accepts street, waterway, or drain photos. We'll run Roboflow inference to locate and box all plastic litter items.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                  }}
                />

                <Button
                  variant="primary"
                  icon="image"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose from Device
                </Button>

                <Button
                  variant="secondary"
                  icon="camera"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  Take Photo
                </Button>
              </div>
            </div>

            {/* Quick Test Samples */}
            <Card pad="roomy">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Instant Test Samples</h3>
                <span className="text-xs text-muted">1-click automated evaluation</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {SAMPLES.map((sample) => (
                  <button
                    key={sample.url}
                    type="button"
                    onClick={() => loadSample(sample.url, sample.name)}
                    className="group flex flex-col items-start rounded-field border border-line bg-surface p-3 text-left transition-all hover:border-accent hover:shadow-card active:scale-[0.98]"
                  >
                    <div className="relative mb-2 h-28 w-full overflow-hidden rounded-lg bg-surface-2">
                      <img
                        src={sample.url}
                        alt={sample.name}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <span className="text-xs font-bold text-ink group-hover:text-accent">
                      {sample.name}
                    </span>
                    <span className="mt-0.5 text-[11px] text-muted">
                      {sample.desc}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          /* Active Scan View with Bounding Boxes & Labels */
          <div className="space-y-6">
            <Card pad="none" className="overflow-hidden shadow-card animate-rise">
              {/* Image Viewport with Overlays */}
              <div className="relative flex items-center justify-center bg-black/90 min-h-[320px] max-h-[65dvh] overflow-hidden select-none">
                <img
                  src={previewUrl}
                  alt="Scanned item"
                  className="block max-h-[65dvh] w-full object-contain"
                />

                {/* Loading Scanner Animation */}
                {scanning ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                    {/* Laser scan beam sweep */}
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_15px_#22c55e] animate-pulse" />
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-surface/90 text-accent shadow-xl backdrop-blur-md">
                      <Spinner />
                    </div>
                    <p className="mt-4 font-semibold text-white drop-shadow">
                      Analyzing photo with Roboflow plastic detector...
                    </p>
                    <p className="mt-1 text-xs text-white/70">
                      Querying model stable endpoint via secure server proxy
                    </p>
                  </div>
                ) : null}

                {/* Bounding Boxes & "Plastic" Labels */}
                {!scanning && scan && showBoxes
                  ? detections.map((d: Detection, i: number) => {
                      const plastic = PLASTIC_CLASSES.includes(d.class_name);
                      const isHovered = hoveredIdx === i;
                      const leftPct = (d.x1 / scan.image_width) * 100;
                      const topPct = (d.y1 / scan.image_height) * 100;
                      const widthPct = ((d.x2 - d.x1) / scan.image_width) * 100;
                      const heightPct = ((d.y2 - d.y1) / scan.image_height) * 100;

                      return (
                        <div
                          key={`${d.x1}-${d.y1}-${i}`}
                          onMouseEnter={() => setHoveredIdx(i)}
                          onMouseLeave={() => setHoveredIdx(null)}
                          className={cx(
                            "absolute transition-all duration-150 cursor-pointer pointer-events-auto",
                            isHovered ? "z-30 scale-[1.01]" : "z-10",
                          )}
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                          }}
                        >
                          {/* Box Border */}
                          <div
                            className={cx(
                              "h-full w-full rounded-[3px] border-2 transition-colors",
                              plastic
                                ? isHovered
                                  ? "border-emerald-400 bg-emerald-500/20 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                                  : "border-accent bg-accent/10 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                                : "border-slate-400 bg-slate-500/10",
                            )}
                          />

                          {/* Floating "Plastic" Label Tag pinned over box */}
                          {showLabels ? (
                            <div
                              className={cx(
                                "absolute -top-6 left-0 z-20 flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold tracking-tight shadow-md transition-all",
                                plastic
                                  ? "bg-accent text-accent-fg"
                                  : "bg-slate-700 text-white",
                                isHovered ? "ring-2 ring-white scale-105" : "",
                              )}
                            >
                              <span>
                                {plastic ? "Plastic: " : ""}
                                {CLASS_LABEL[d.class_name]}
                              </span>
                              <span className="opacity-90 tabular font-mono">
                                {Math.round(d.confidence * 100)}%
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  : null}

                {/* Simulated Badge if in stub mode */}
                {scan?.is_simulated ? (
                  <div className="absolute left-3 top-3 z-20">
                    <SimulatedBadge title="Detections are simulated demo fixtures." />
                  </div>
                ) : null}
              </div>

              {/* Controls & Detection Summary Bar */}
              <div className="border-t border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg font-bold text-ink">
                      {scanning
                        ? "Scanning photo..."
                        : plasticCount > 0
                        ? `Detected ${plasticCount} Plastic Item${plasticCount === 1 ? "" : "s"}`
                        : noDetectionsFound
                        ? "No Plastic Litter Found"
                        : "Analysis Complete"}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {plasticCount > 0
                        ? `Estimated ${((scan?.result.plastic_area_frac ?? 0) * 100).toFixed(1)}% plastic coverage area`
                        : noDetectionsFound
                        ? "Model evaluated image above confidence threshold with 0 matches"
                        : "Ready for civic reporting"}
                    </p>
                  </div>

                  {/* Toggle Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBoxes(!showBoxes)}
                      className={cx(
                        "rounded-field px-3 py-1.5 text-xs font-semibold border transition-colors",
                        showBoxes
                          ? "bg-accent/10 border-accent/40 text-accent"
                          : "bg-surface-2 border-line text-muted",
                      )}
                    >
                      {showBoxes ? "Boxes: ON" : "Boxes: OFF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLabels(!showLabels)}
                      className={cx(
                        "rounded-field px-3 py-1.5 text-xs font-semibold border transition-colors",
                        showLabels
                          ? "bg-accent/10 border-accent/40 text-accent"
                          : "bg-surface-2 border-line text-muted",
                      )}
                    >
                      {showLabels ? "Labels: ON" : "Labels: OFF"}
                    </button>
                    <Button variant="secondary" icon="refresh" onClick={reset}>
                      New Photo
                    </Button>
                  </div>
                </div>

                {/* Detections List Breakdown */}
                {detections.length > 0 ? (
                  <div className="mt-5 border-t border-line/60 pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted">
                        Identified Objects ({detections.length})
                      </span>
                      {scan?.confidence_tier ? (
                        <TierChip
                          tier={scan.confidence_tier}
                          value={scan.result.report_confidence}
                        />
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {detections.map((d, idx) => {
                        const plastic = PLASTIC_CLASSES.includes(d.class_name);
                        const isHovered = hoveredIdx === idx;
                        return (
                          <div
                            key={idx}
                            onMouseEnter={() => setHoveredIdx(idx)}
                            onMouseLeave={() => setHoveredIdx(null)}
                            className={cx(
                              "flex items-center justify-between rounded-lg border p-2.5 text-xs transition-all cursor-pointer",
                              isHovered
                                ? "border-accent bg-accent/5 shadow-sm"
                                : "border-line bg-surface-2/50 hover:bg-surface-2",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cx(
                                  "h-2 w-2 rounded-full",
                                  plastic ? "bg-accent" : "bg-slate-400",
                                )}
                              />
                              <span className="font-semibold text-ink">
                                {CLASS_LABEL[d.class_name]}
                              </span>
                            </div>
                            <span className="font-mono text-muted">
                              {Math.round(d.confidence * 100)}% conf
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* No Detections Found State */}
                {noDetectionsFound ? (
                  <div className="mt-4 rounded-field border border-line bg-surface-2/50 p-6 text-center animate-rise">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted">
                      <Icon name="check" size={20} />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-ink">
                      No Plastic Litter Detected
                    </h3>
                    <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                      The Roboflow model analyzed the image and did not identify single-use plastics or litter above the confidence threshold. If plastic is present, try capturing from a closer distance or with better lighting.
                    </p>
                    <div className="mt-4 flex justify-center gap-3">
                      <Button variant="secondary" icon="refresh" onClick={reset}>
                        Test Another Image
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Action to proceed to Citizen Report */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-4">
                  <div className="text-xs text-muted">
                    Found plastic waste? Submit a verified report to alert municipal authorities.
                  </div>
                  <Link to="/report">
                    <Button variant="primary" icon="arrowRight">
                      Create Civic Report
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}
