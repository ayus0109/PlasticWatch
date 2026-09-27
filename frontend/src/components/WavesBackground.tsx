/**
 * Responsive ecological background for PlasticWatch application pages.
 *
 * Displays the tri-color Indian ecological heritage artwork (saffron waves,
 * historic architecture skyline, recycling symbol, and botanical greenery).
 *
 * Rules:
 *  - STRICTLY disabled on the landing page ("/") to keep its design untouched.
 *  - Optimized for portrait mode on mobile phones (anchors skyline & green hills to the bottom).
 *  - Includes a calibrated contrast gradient wash ensuring all text and cards remain 100% legible.
 */
import { useLocation } from "react-router";

export function WavesBackground() {
  const location = useLocation();
  const isLanding = location.pathname === "/";

  // The landing page keeps its dedicated hero background — untouched as requested
  if (isLanding) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 select-none overflow-hidden"
    >
      {/* 1. Base warm foundation tone */}
      <div className="absolute inset-0 bg-[#fbf8f3] dark:bg-[#0c1812] transition-colors duration-500" />

      {/* 2. Indian ecological artwork with portrait & landscape responsive positioning */}
      <div
        className="app-eco-bg absolute inset-0 bg-no-repeat transition-opacity duration-700 opacity-90 dark:opacity-20"
        style={{
          backgroundImage: "url('/eco-india-bg.jpg')",
          backgroundSize: "cover",
        }}
      />

      {/* 3. Soft high-contrast readability wash across both portrait & landscape modes */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-[#fbf8f3]/90 via-[#fbf8f3]/75 to-[#fbf8f3]/45 dark:from-[#0c1812]/92 dark:via-[#0c1812]/80 dark:to-[#0c1812]/60"
      />
    </div>
  );
}
