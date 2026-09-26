/**
 * Citizen report (SPEC §9, F1): photo -> location (browser GPS -> the photo's EXIF ->
 * a map pin) -> optional note -> result card with the confidence TIER and status.
 */
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type DetectPreview,
  type ReportCreateResponse,
} from "../api/client";
import { Icon } from "../components/Icon";
import { ScanPreview, type StampLocation } from "../components/ScanPreview";
import { PinPicker, type LatLon } from "../components/PinPicker";
import { ReportResult } from "../components/ReportResult";
import { Shell } from "../components/Shell";
import { Button, Card, cx } from "../components/ui";
import { metres } from "../lib/format";
import { useSession } from "../store/auth";

type Loc =
  | { mode: "locating" }
  | { mode: "gps"; lat: number; lon: number; accuracy: number }
  | { mode: "exif" }
  | { mode: "pin"; lat: number | null; lon: number | null; reason?: string };

function Step({
  n,
  title,
  done,
  children,
  aside,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Card pad="roomy">
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cx(
            "grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-colors",
            done ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
          )}
        >
          {done ? <Icon name="check" size={14} /> : n}
        </span>
        <h2 className="flex-1 font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export default function Report() {
  const session = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loc, setLoc] = useState<Loc>({ mode: "locating" });
  const [gpsNear, setGpsNear] = useState<LatLon | null>(null);
  const [reporterName, setReporterName] = useState(
    session?.user?.name && !session.user.name.startsWith("Demo")
      ? session.user.name
      : session?.user?.name === "Demo Citizen A"
      ? "Aarav Sharma"
      : session?.user?.name ?? "",
  );
  const [reporterPhone, setReporterPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    text: string;
    step?: "photo" | "location" | "phone" | "name";
  } | null>(null);
  const [result, setResult] = useState<ReportCreateResponse | null>(null);
  // The detector's answer for THIS photo, shown before the citizen commits to sending.
  const [scan, setScan] = useState<DetectPreview | null>(null);
  const [scanning, setScanning] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const isPhoneValid = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 10;
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setLoc({ mode: "exif" });
      return;
    }
    setLoc({ mode: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsNear(p);
        setLoc({ mode: "gps", ...p, accuracy: pos.coords.accuracy });
      },
      () => setLoc({ mode: "exif" }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  useEffect(locate, []);
  useEffect(() => {
    // A different photo means the previous detection no longer describes it.
    setScan(null);
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setFile(null);
    setNote("");
    setReporterPhone("");
    setResult(null);
    setScan(null);
    setError(null);
    locate();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const locationReady =
    loc.mode === "gps" || loc.mode === "exif" || (loc.mode === "pin" && loc.lat !== null);

  /** Run the detector on the photo without saving anything, so the citizen can see
   *  what was found and then decide. A failure here must NEVER block reporting. */
  const runScan = async () => {
    if (!file) {
      setError({ text: "Please add a photo of waste first.", step: "photo" });
      return;
    }
    if (!reporterName.trim()) {
      setError({
        text: "Please enter your name for citizen verification.",
        step: "name",
      });
      document.getElementById("reporter-name-input")?.focus();
      return;
    }
    if (!reporterPhone.trim()) {
      setError({
        text: "Please enter your phone number (proof for verification) before checking the photo.",
        step: "phone",
      });
      document.getElementById("reporter-phone-input")?.focus();
      return;
    }
    if (!isPhoneValid(reporterPhone)) {
      setError({
        text: "Please enter a valid phone number (at least 10 digits) so municipal authorities can verify your report.",
        step: "phone",
      });
      document.getElementById("reporter-phone-input")?.focus();
      return;
    }
    setScanning(true);
    setError(null);
    const form = new FormData();
    form.append("image", file);
    try {
      setScan(await api.upload<DetectPreview>("/detect", form));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "low_quality" || err.code === "not_an_image") {
        setError({ text: err.message, step: "photo" });
      } else {
        setError({
          text: `${err.message} The check could not run, but you can still send the report.`,
        });
      }
    } finally {
      setScanning(false);
    }
  };

  const submit = async () => {
    if (!file || !locationReady) return;
    if (!reporterPhone.trim() || !isPhoneValid(reporterPhone)) {
      setError({
        text: "A valid phone number (at least 10 digits) is required for citizen verification.",
        step: "phone",
      });
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("image", file);
    if (reporterName.trim()) form.append("reporter_name", reporterName.trim());
    form.append("reporter_phone", reporterPhone.trim());
    if (note.trim()) form.append("note", note.trim());
    if (loc.mode === "gps") {
      form.append("lat", String(loc.lat));
      form.append("lon", String(loc.lon));
      form.append("accuracy", String(Math.round(loc.accuracy)));
      form.append("source", "browser");
    } else if (loc.mode === "pin" && loc.lat !== null && loc.lon !== null) {
      form.append("lat", String(loc.lat));
      form.append("lon", String(loc.lon));
      form.append("source", "pin");
    } // exif: send no location; the server reads the photo's GPS

    try {
      const res = await api.upload<ReportCreateResponse>("/reports", form);
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "no_location") {
        setLoc({ mode: "pin", lat: null, lon: null, reason: err.message });
        setError({ text: err.message, step: "location" });
      } else if (err.code === "low_quality" || err.code === "not_an_image") {
        setError({ text: err.message, step: "photo" });
      } else {
        setError({ text: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl">
          <ReportResult result={result} onAnother={reset} />
        </div>
      </Shell>
    );
  }

  // Detector ran: show what it saw and let the citizen decide before anything is saved.
  if (scan && preview) {
    // Exactly the location submitting will record: browser GPS and pins are sent from
    // here; in EXIF mode nothing is sent and the server reads the photo's own GPS,
    // which /detect has already told us (null when the photo carries none).
    const stampLocation: StampLocation =
      loc.mode === "gps"
        ? { lat: loc.lat, lon: loc.lon, source: "browser", accuracyM: loc.accuracy }
        : loc.mode === "pin"
          ? { lat: loc.lat, lon: loc.lon, source: "pin" }
          : {
              lat: scan.exif_lat ?? null,
              lon: scan.exif_lon ?? null,
              source: scan.exif_lat != null ? "exif" : null,
            };
    return (
      <Shell>
        <div className="mx-auto max-w-xl space-y-4">
          <header className="mb-3 animate-rise rounded-card border border-line bg-surface/85 p-4 backdrop-blur-md shadow-sm">
            <div className="flex items-center gap-2 text-accent font-semibold text-xs mb-1">
              <Icon name="detect" size={15} />
              <span>AI Detection Preview</span>
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
              Check before you send
            </h1>
            <p className="mt-1 text-sm font-medium text-ink/80 dark:text-emerald-100/90 leading-relaxed">
              Nothing has been sent yet. This is what the detector found in your photo.
            </p>
          </header>
          {error && !error.step ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-field bg-danger-soft p-3 text-label text-danger"
            >
              <Icon name="alert" size={16} className="mt-0.5" /> {error.text}
            </p>
          ) : null}
          <ScanPreview
            scan={scan}
            imageUrl={preview}
            location={stampLocation}
            sending={busy}
            onSend={submit}
            onRetake={() => {
              setScan(null);
              setFile(null);
            }}
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl space-y-4">
        <header className="mb-2 animate-rise">
          <h1 className="font-display text-2xl font-bold tracking-tight">Report waste</h1>
          <p className="mt-1 text-sm text-muted">
            A clear photo and an accurate location help the most. Please avoid faces and
            vehicle number plates in the frame.
          </p>
        </header>

        <Step n={1} title="Photo" done={Boolean(file)}>
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={galleryInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {preview ? (
            <div className="space-y-3">
              <img
                src={preview}
                alt="Selected photo"
                className="max-h-[45dvh] w-full rounded-field bg-surface-2 object-contain"
              />
              <div className="flex gap-2">
                <Button icon="camera" onClick={() => cameraInput.current?.click()} className="flex-1">
                  Retake
                </Button>
                <Button icon="image" onClick={() => galleryInput.current?.click()} className="flex-1">
                  Choose another
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraInput.current?.click()}
                className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-field border-2 border-dashed border-line-strong text-sm font-semibold transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
              >
                <Icon name="camera" size={26} />
                Take a photo
              </button>
              <button
                onClick={() => galleryInput.current?.click()}
                className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-field border-2 border-dashed border-line-strong text-sm font-semibold transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
              >
                <Icon name="image" size={26} />
                From gallery
              </button>
            </div>
          )}
          {error?.step === "photo" ? (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-field bg-danger-soft p-3 text-sm text-danger">
              <Icon name="alert" size={16} className="mt-0.5" /> {error.text}
            </p>
          ) : null}
        </Step>

        <Step
          n={2}
          title="Location"
          done={locationReady}
          aside={
            loc.mode !== "pin" ? (
              <button
                onClick={() => setLoc({ mode: "pin", lat: gpsNear?.lat ?? null, lon: gpsNear?.lon ?? null })}
                className="min-h-11 rounded-field px-2 text-xs font-semibold text-accent hover:underline"
              >
                Drop a pin instead
              </button>
            ) : null
          }
        >
          {loc.mode === "locating" ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              Finding your location…
            </p>
          ) : loc.mode === "gps" ? (
            <div className="flex items-start gap-3 text-sm">
              <Icon name="crosshair" size={18} className="mt-0.5 text-accent" />
              <div>
                <p className="font-medium">Using your current location</p>
                <p className="text-muted">
                  Accurate to about {metres(loc.accuracy)}
                  {loc.accuracy > 30 ? " — that's rough; a pin may be more precise." : "."}
                </p>
              </div>
            </div>
          ) : loc.mode === "exif" ? (
            <div className="flex items-start gap-3 text-sm">
              <Icon name="image" size={18} className="mt-0.5 text-accent" />
              <div>
                <p className="font-medium">We'll use the location saved in your photo</p>
                <p className="text-muted">
                  Location access isn't available here. If the photo has no location, you'll
                  be asked to drop a pin. The stored copy has that data removed.
                </p>
                <Button variant="primary" icon="crosshair" onClick={locate} className="mt-3 w-full sm:w-auto">
                  Use my current location
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {loc.reason ? <p className="text-sm text-muted">{loc.reason}</p> : null}
              <PinPicker
                value={loc.lat !== null && loc.lon !== null ? { lat: loc.lat, lon: loc.lon } : null}
                near={gpsNear}
                onChange={(p) => setLoc({ mode: "pin", lat: p.lat, lon: p.lon })}
              />
              <Button variant="primary" icon="crosshair" onClick={locate} className="w-full">
                Use my current location
              </Button>
            </div>
          )}
        </Step>

        <Step
          n={3}
          title="Citizen Verification & Details"
          done={reporterName.trim().length > 0 && isPhoneValid(reporterPhone)}
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Your Name <span className="text-accent">*</span>
              </label>
              <input
                id="reporter-name-input"
                type="text"
                value={reporterName}
                onChange={(e) => {
                  setReporterName(e.target.value);
                  if (error?.step === "name") setError(null);
                }}
                maxLength={100}
                placeholder="e.g. Rahul Sharma"
                className={`w-full rounded-field border bg-surface px-3 py-2 text-sm placeholder:text-faint focus:outline-none transition-colors ${
                  error?.step === "name"
                    ? "border-danger focus:border-danger ring-1 ring-danger/30"
                    : "border-line focus:border-accent"
                }`}
              />
              {error?.step === "name" ? (
                <p role="alert" className="mt-1 text-xs font-semibold text-danger flex items-center gap-1">
                  <Icon name="alert" size={13} /> {error.text}
                </p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Phone Number (Proof for Verification) <span className="text-accent">*</span>
              </label>
              <input
                id="reporter-phone-input"
                type="tel"
                value={reporterPhone}
                onChange={(e) => {
                  setReporterPhone(e.target.value);
                  if (error?.step === "phone") setError(null);
                }}
                maxLength={15}
                placeholder="e.g. +91 98765 43210 (min 10 digits)"
                className={`w-full rounded-field border bg-surface px-3 py-2 text-sm placeholder:text-faint focus:outline-none transition-colors ${
                  error?.step === "phone"
                    ? "border-danger focus:border-danger ring-1 ring-danger/30"
                    : "border-line focus:border-accent"
                }`}
              />
              {error?.step === "phone" ? (
                <p role="alert" className="mt-1 text-xs font-semibold text-danger flex items-center gap-1">
                  <Icon name="alert" size={13} /> {error.text}
                </p>
              ) : (
                <p className="mt-1 text-micro text-faint">
                  Required: Municipal authorities verify this phone number before dispatching cleanup teams.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Landmark / Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="e.g. Near community drain behind the market"
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm placeholder:text-faint focus:border-accent"
              />
            </div>
          </div>
        </Step>

        {error && !error.step ? (
          <p role="alert" className="flex items-start gap-2 rounded-field bg-danger-soft p-3 text-sm text-danger">
            <Icon name="alert" size={16} className="mt-0.5" /> {error.text}
          </p>
        ) : null}

        <Button
          variant="primary"
          icon="detect"
          className="w-full !min-h-12 text-base"
          disabled={!file || !locationReady}
          loading={scanning}
          onClick={runScan}
        >
          {scanning ? "Looking at your photo…" : "Check this photo"}
        </Button>
        <p className="text-center text-micro text-faint">
          {!file
            ? "Add a photo to report waste."
            : "You will see what the detector found, and can still change your mind."}
        </p>
      </div>
    </Shell>
  );
}
