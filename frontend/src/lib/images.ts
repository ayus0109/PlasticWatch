/**
 * Real dataset images bundled with the frontend to guarantee
 * instant, reliable visuals even when backend images are missing or 404.
 */
export const DATASET_SAMPLES = [
  "/samples/bottles.jpg",
  "/samples/bags.jpg",
  "/samples/packets_and_cups.jpg",
  "/samples/market_lane.jpg",
  "/samples/after_cleanup_wide.jpg",
  "/samples/after_cleanup_close.jpg",
  "/samples/clean_street.jpg",
];

export function getDatasetSampleForReport(key?: string | number | null): string {
  if (!key) return DATASET_SAMPLES[0];
  if (typeof key === "number") {
    return DATASET_SAMPLES[Math.abs(key) % DATASET_SAMPLES.length];
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return DATASET_SAMPLES[Math.abs(hash) % DATASET_SAMPLES.length];
}
