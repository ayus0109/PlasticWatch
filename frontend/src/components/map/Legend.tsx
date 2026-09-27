import { BAND, BAND_ORDER } from "../../lib/status";
import { band } from "../../lib/theme";

function Dot({ variant }: { variant: "weak" | "verified" | "closed" }) {
  const c = "var(--pw-band-high)";
  const style =
    variant === "weak"
      ? { background: `color-mix(in srgb, ${c} 45%, transparent)`, border: `2px dashed ${c}` }
      : variant === "verified"
        ? { background: c, border: "2px solid #fff", boxShadow: `0 0 0 3px color-mix(in srgb, ${c} 30%, transparent), 0 0 8px ${c}` }
        : { background: "var(--pw-surface)", border: `2px solid ${c}` };
  return <span className="inline-block h-4 w-4 shrink-0 rounded-full" style={style} aria-hidden />;
}

export function Legend() {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {BAND_ORDER.map((b) => (
          <span key={b} className="flex items-center gap-2">
            <span
              className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
              style={{ background: `var(--pw-band-${b})` }}
              aria-hidden
            >
              {BAND[b].letter}
            </span>
            <span>
              <span className="font-semibold">{BAND[b].label}</span>{" "}
              <span className="text-faint">{BAND[b].range.replace("Impact ", "")}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="space-y-1.5 border-t border-line pt-3">
        <span className="flex items-center gap-2">
          <Dot variant="weak" /> Dashed = not yet human-verified (faded = weak evidence)
        </span>
        <span className="flex items-center gap-2">
          <Dot variant="verified" /> Solid with glow = verified by an authority
        </span>
        <span className="flex items-center gap-2">
          <Dot variant="closed" /> Hollow = resolved or not actionable
        </span>
      </div>
      <div className="border-t border-line pt-3">
        <div
          className="h-2 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${band.low}, ${band.medium}, ${band.high}, ${band.critical})`,
          }}
          aria-hidden
        />
        <div className="mt-1 flex justify-between text-faint">
          <span>Heat: lower Impact</span>
          <span>higher</span>
        </div>
      </div>
      <p className="border-t border-line pt-3 leading-relaxed text-faint">
        Size and letter also encode priority, so colour is never the only signal. Impact
        ranks; Evidence says how sure we are. Weights are tunable proposals.
      </p>
    </div>
  );
}
