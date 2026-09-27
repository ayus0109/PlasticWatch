import { useState, useEffect } from "react";
import { mediaUrl } from "../api/client";
import { getDatasetSampleForReport } from "../lib/images";

export function ReportImage({
  path,
  reportId,
  alt = "Reported waste",
  className = "h-full w-full object-cover",
  loading = "lazy",
}: {
  path?: string | null;
  reportId?: string | number | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const fallback = getDatasetSampleForReport(reportId);
  const initial = mediaUrl(path) || fallback;
  const [src, setSrc] = useState<string>(initial);

  useEffect(() => {
    setSrc(mediaUrl(path) || fallback);
  }, [path, fallback]);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        if (src !== fallback) {
          setSrc(fallback);
        }
      }}
    />
  );
}
