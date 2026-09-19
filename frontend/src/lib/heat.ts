/**
 * Loads leaflet.heat onto the shared Leaflet object. Imported for its side effect,
 * after lib/leaflet (module evaluation order guarantees window.L exists first).
 */
import L from "./leaflet";
import "leaflet.heat";

export default L;
