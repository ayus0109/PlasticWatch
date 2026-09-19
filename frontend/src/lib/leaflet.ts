/**
 * Leaflet, shared by every map in the app.
 *
 * leaflet.heat is a classic script that attaches itself to a GLOBAL `L`. Vite imports
 * Leaflet as an ES module, whose namespace object is frozen — so we expose a mutable
 * copy as window.L *before* the plugin loads, and everything (including the plugin's
 * L.heatLayer) lives on that one object. Import Leaflet from here, never directly.
 */
import * as LeafletNS from "leaflet";

const L = { ...LeafletNS } as typeof LeafletNS;
(window as unknown as { L: typeof LeafletNS }).L = L;

export default L;

export const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
