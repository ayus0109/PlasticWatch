/**
 * The cleanup team's two after-photos (SPEC §14): one wide from where the report was
 * taken, one close-up. The server checks quality, location and viewpoint and suggests
 * a verdict — it never resolves anything; an authority reviews the photos.
 */
import { useEffect, useState } from "react";
import { api, type BeforeAfterRecord } from "../api/client";
import { VerdictChip } from "./BeforeAfter";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { Button, cx } from "./ui";

type Kind = "wide" | "close";
const SLOTS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "wide", label: "Wide shot", hint: "The whole spot, from where the report photo was taken" },
  { kind: "close", label: "Close-up", hint: "The ground where the waste was" },
];

function currentPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null), // the server falls back to photo EXIF, then the check-in
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

function Slot({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <label
      className={cx(
        "group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition-colors",
        file ? "border-transparent" : "border-line hover:border-accent hover:bg-accent-soft/40",
      )}
    >
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {url ? (
        <>
          <img src={url} alt={`${label} preview`} className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute left-2 top-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
            {label} · tap to change
          </span>
        </>
      ) : (
        <span className="px-3">
          <Icon name="camera" size={22} className="mx-auto text-muted group-hover:text-accent" />
          <span className="mt-1 block text-sm font-semibold">{label}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
      )}
    </label>
  );
}

export function AfterPhotos({
  taskId,
  stopId,
  onDone,
  retake = false,
}: {
  taskId: number;
  stopId: number;
  onDone: () => void;
  retake?: boolean;
}) {
  const toast = useToast();
  const [files, setFiles] = useState<Record<Kind, File | null>>({ wide: null, close: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BeforeAfterRecord | null>(null);

  const submit = async () => {
    if (!files.wide || !files.close) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("wide", files.wide);
      form.append("close", files.close);
      const at = await currentPosition();
      if (at) {
        form.append("lat", String(at.lat));
        form.append("lon", String(at.lon));
      }
      const rec = await api.upload<BeforeAfterRecord>(`/tasks/${taskId}/stops/${stopId}/after`, form);
      setResult(rec);
      setFiles({ wide: null, close: null });
      toast("ok", "After-photos sent. An authority will compare them with the before photo.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const reasons = (result.quality_flags.reasons as string[] | undefined) ?? [];
    return (
      <div className="mt-3 space-y-2 rounded-xl bg-surface-2 p-3 animate-rise" role="status">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          Suggested verdict <VerdictChip verdict={result.verdict} />
        </div>
        {reasons.length ? (
          <ul className="list-disc pl-5 text-sm text-muted">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted">
          {result.verdict === "inconclusive"
            ? "You can retake the photos until the authority reviews them."
            : "This is only a suggestion — an authority reviews the photos before anything is closed."}
        </p>
        <Button variant="primary" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted">
        {retake
          ? "Retake both photos — they replace the ones the authority hasn't reviewed yet."
          : "Cleanup done? Take two after-photos."}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((s) => (
          <Slot
            key={s.kind}
            label={s.label}
            hint={s.hint}
            file={files[s.kind]}
            onPick={(f) => setFiles((prev) => ({ ...prev, [s.kind]: f }))}
          />
        ))}
      </div>
      <Button
        variant="primary"
        icon="upload"
        className="w-full"
        disabled={!files.wide || !files.close}
        loading={busy}
        onClick={submit}
      >
        {busy ? "Checking photos…" : "Send after-photos"}
      </Button>
      <p className="text-[11px] text-faint">Even a “likely cleaned” verdict never closes a hotspot by itself.</p>
    </div>
  );
}
