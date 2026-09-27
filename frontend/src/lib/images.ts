/**
 * Real dataset images bundled with the frontend to guarantee
 * instant, reliable visuals even when backend images are missing or 404.
 */
export const BEFORE_SAMPLES = [
  "/samples/market_lane.jpg",
  "/samples/bottles.jpg",
  "/samples/bags.jpg",
  "/samples/packets_and_cups.jpg",
];

export const AFTER_SAMPLES = [
  "/samples/after_cleanup_wide.jpg",
  "/samples/after_cleanup_close.jpg",
  "/samples/clean_street.jpg",
];

export const DATASET_SAMPLES = [
  ...BEFORE_SAMPLES,
  ...AFTER_SAMPLES,
];

export function getDatasetSampleForReport(key?: string | number | null): string {
  if (!key) return BEFORE_SAMPLES[0];
  if (typeof key === "number") {
    return BEFORE_SAMPLES[Math.abs(key) % BEFORE_SAMPLES.length];
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return BEFORE_SAMPLES[Math.abs(hash) % BEFORE_SAMPLES.length];
}

/**
 * Intelligent pairing for after-cleanup photographs:
 * Matches the scene context (market lane -> wide street; bottles -> close ground; bags/debris -> clean kerb).
 */
export function getAfterCleanupPhoto(
  reportPath?: string | null,
  reportKey?: string | number | null
): string {
  const p = (reportPath || "").toLowerCase();
  if (p.includes("market") || p.includes("demo_03") || p.includes("wide")) {
    return "/samples/after_cleanup_wide.jpg";
  }
  if (p.includes("bottle") || p.includes("demo_01") || p.includes("close") || p.includes("drain")) {
    return "/samples/after_cleanup_close.jpg";
  }
  if (p.includes("bag") || p.includes("demo_02") || p.includes("cup") || p.includes("demo_04") || p.includes("kerb") || p.includes("street")) {
    return "/samples/clean_street.jpg";
  }

  if (typeof reportKey === "number") {
    return AFTER_SAMPLES[Math.abs(reportKey) % AFTER_SAMPLES.length];
  }
  if (typeof reportKey === "string" && reportKey.length > 0) {
    let hash = 0;
    for (let i = 0; i < reportKey.length; i++) {
      hash = (hash << 5) - hash + reportKey.charCodeAt(i);
      hash |= 0;
    }
    return AFTER_SAMPLES[Math.abs(hash) % AFTER_SAMPLES.length];
  }

  return "/samples/after_cleanup_wide.jpg";
}
