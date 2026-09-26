/**
 * A photo with overlays (detection boxes, the geotag stamp) pinned to the PAINTED image.
 *
 * `object-contain` inside a full-width box letterboxes a portrait photo, and anything
 * positioned in percent of that box then lands on the grey bars instead of the photo —
 * on a phone, a portrait shot (the usual citizen photo) shifted every box by ~50 px.
 * Here the inner box takes the image's own aspect ratio and the largest size that fits
 * both the column width and `maxHeight`, so 0–100% means 0–100% of the photo.
 */
import { useState, type ReactNode } from "react";

export function PhotoFrame({
  src,
  alt,
  width,
  height,
  maxHeight = "46dvh",
  onError,
  children,
}: {
  src: string | undefined;
  alt: string;
  /** Known pixel size (e.g. from /detect). Omit to measure the image once it loads. */
  width?: number;
  height?: number;
  /** Any CSS length. */
  maxHeight?: string;
  onError?: () => void;
  children?: ReactNode;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const w = width ?? measured?.w ?? 4;
  const h = height ?? measured?.h ?? 3;

  return (
    <div className="flex justify-center bg-surface-2">
      <div
        className="relative"
        style={{
          aspectRatio: `${w} / ${h}`,
          width: `min(100%, calc(${maxHeight} * ${w} / ${h}))`,
        }}
      >
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 block h-full w-full object-contain"
          onLoad={(e) => {
            if (width && height) return;
            const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
            if (nw && nh) setMeasured({ w: nw, h: nh });
          }}
          onError={onError}
        />
        {children}
      </div>
    </div>
  );
}
