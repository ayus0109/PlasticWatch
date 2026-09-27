/**
 * Hotspot marker styling (CLAUDE.md §9):
 *   colour = priority band, AND a letter (C/H/M/L) + size so colour is never alone;
 *   weak evidence or not yet human-verified = dashed ring, lower fill opacity;
 *   human-verified = solid + subtle glow; closed = hollow;
 *   simulated = a tiny dashed "SIM" tag.
 * The icon box is at least 40 px so it is a comfortable touch target.
 */
import type { DivIcon } from "leaflet";
import type { HotspotProperties } from "../../api/client";
import L from "../../lib/leaflet";
import { BAND, CLOSED, HUMAN_VERIFIED, STATUS } from "../../lib/status";

const DOT = { critical: 34, high: 30, medium: 26, low: 22 } as const;
const BOX = 40;

export function markerClasses(p: HotspotProperties, selected: boolean): string {
  const cls = ["pw-marker"];
  if (CLOSED.has(p.status)) cls.push("pw-marker--closed");
  else if (HUMAN_VERIFIED.has(p.status)) cls.push("pw-marker--verified");
  else cls.push("pw-marker--weak");
  if (!HUMAN_VERIFIED.has(p.status) && p.evidence_band === "low") cls.push("pw-marker--lowev");
  if (selected) cls.push("pw-marker--selected");
  return cls.join(" ");
}

export function hotspotIcon(p: HotspotProperties, selected: boolean): DivIcon {
  const band = p.priority_band ?? "low";
  const size = DOT[band];
  const letter = BAND[band].letter;
  const sim = p.is_simulated ? '<span class="pw-marker__sim">SIM</span>' : "";
  const label = `${BAND[band].label} priority, ${STATUS[p.status].label}`;
  return L.divIcon({
    className: markerClasses(p, selected),
    iconSize: [BOX, BOX],
    iconAnchor: [BOX / 2, BOX / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px;margin:${(BOX - size) / 2}px" role="img" aria-label="${label}">
      <div class="pw-marker__dot" style="--c: var(--pw-band-${band})">${letter}</div>${sim}
    </div>`,
  });
}

export function pinIcon(): DivIcon {
  return L.divIcon({
    className: "pw-pin",
    iconSize: [26, 26],
    iconAnchor: [13, 30],
    html: '<div class="pw-pin__head"></div>',
  });
}
