import { useEffect, useRef } from "react";

interface Hotspot {
  lat: number;
  lon: number;
  name: string;
  risk: "Critical" | "High" | "Moderate";
}

const GLOBAL_HOTSPOTS: Hotspot[] = [
  { lat: 18.92, lon: 72.83, name: "Mumbai & Mithi Basin", risk: "Critical" },
  { lat: 14.59, lon: 120.98, name: "Pasig River Corridor", risk: "Critical" },
  { lat: -6.20, lon: 106.84, name: "Citarum River (Jakarta)", risk: "High" },
  { lat: 31.23, lon: 121.47, name: "Yangtze Coastal Estuary", risk: "High" },
  { lat: 35.0, lon: -140.0, name: "North Pacific Convergence", risk: "Critical" },
  { lat: 25.76, lon: -80.19, name: "Caribbean Inlet", risk: "Moderate" },
  { lat: 51.50, lon: 0.05, name: "Thames Estuary Runoff", risk: "Moderate" },
];

// Simplified continent vector polygons (lat, lon sequences)
const CONTINENTS = [
  // North America
  [[70, -160], [65, -140], [60, -125], [48, -124], [35, -120], [22, -105], [16, -92], [8, -77], [10, -75], [20, -75], [26, -80], [30, -85], [35, -75], [45, -65], [55, -60], [60, -65], [70, -90], [72, -130]],
  // South America
  [[12, -72], [-5, -80], [-18, -72], [-40, -73], [-55, -68], [-50, -65], [-23, -42], [-5, -35], [5, -52], [10, -60], [12, -72]],
  // Eurasia
  [[70, 25], [60, 40], [55, 60], [60, 90], [70, 130], [70, 170], [60, 165], [50, 140], [35, 120], [22, 110], [15, 100], [10, 78], [25, 60], [30, 35], [40, 28], [45, 10], [55, 10], [60, 5], [70, 25]],
  // Africa
  [[36, -5], [30, 32], [12, 43], [4, 50], [-12, 40], [-34, 18], [-34, 26], [-20, 12], [5, 1], [14, -17], [25, -15], [36, -5]],
  // Australia
  [[-15, 130], [-12, 136], [-20, 148], [-35, 150], [-38, 140], [-32, 115], [-22, 114], [-15, 130]],
  // India subcontinent
  [[28, 70], [24, 68], [15, 74], [8, 77], [13, 80], [20, 85], [26, 89], [28, 80]]
];

export interface EarthGlobeProps {
  className?: string;
  size?: number;
  interactive?: boolean;
}

export function EarthGlobe({ className = "", size, interactive = true }: EarthGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;
    let radius = 0;
    let rotX = 0.28;
    let rotY = -0.5;
    let velY = 0.0028;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let time = 0;

    // Stars background
    const stars = Array.from({ length: 65 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.4 + 0.4,
      alpha: Math.random() * 0.7 + 0.3,
      flicker: Math.random() * 0.015 + 0.005,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
      radius = (size ?? Math.min(width, height)) * 0.44;
    };

    resize();
    window.addEventListener("resize", resize);

    // Pointer events for drag rotation
    const onPointerDown = (e: PointerEvent) => {
      if (!interactive) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velY = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      rotY += dx * 0.006;
      rotX = Math.max(-1.15, Math.min(1.15, rotX + dy * 0.006));
      velY = dx * 0.001;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      isDragging = false;
      velY = 0.0025;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    };

    if (interactive) {
      canvas.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }

    let isVisible = !document.hidden;
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible) animId = requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    function project(lat: number, lon: number, cx: number, cy: number, r: number) {
      const phi = (lat * Math.PI) / 180;
      const theta = (lon * Math.PI) / 180 + rotY;
      const cosPhi = Math.cos(phi);

      const x = r * cosPhi * Math.sin(theta);
      const y = -r * Math.sin(phi);
      const z = r * cosPhi * Math.cos(theta);

      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y * cosX - z * sinX;
      const z2 = y * sinX + z * cosX;

      return { x: cx + x, y: cy + y2, z: z2, visible: z2 > -12 };
    }

    const render = () => {
      if (!isVisible) return;
      time += 0.015;
      if (!isDragging) {
        rotY += velY;
      }

      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;

      // 1. Cosmic Stars (subtle ambient dust)
      stars.forEach((s) => {
        s.alpha += (Math.random() - 0.5) * s.flicker;
        s.alpha = Math.max(0.15, Math.min(0.85, s.alpha));
        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha * 0.75})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2. Earth Outer Rayleigh Atmosphere Glow
      const atmoGrad = ctx.createRadialGradient(cx, cy, radius * 0.85, cx, cy, radius * 1.3);
      atmoGrad.addColorStop(0, "rgba(56, 189, 248, 0.32)");
      atmoGrad.addColorStop(0.35, "rgba(14, 165, 233, 0.16)");
      atmoGrad.addColorStop(0.7, "rgba(2, 132, 199, 0.05)");
      atmoGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = atmoGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // 3. Earth Base Sphere (Oceans)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();

      const oceanGrad = ctx.createRadialGradient(
        cx - radius * 0.38,
        cy - radius * 0.38,
        radius * 0.08,
        cx,
        cy,
        radius
      );
      oceanGrad.addColorStop(0, "#0284c7");   // Sunlit Ocean Azure
      oceanGrad.addColorStop(0.52, "#0369a1"); // Deep Marine
      oceanGrad.addColorStop(0.85, "#082f49"); // Twilight Transition
      oceanGrad.addColorStop(1, "#020617");   // Deep Night Sea
      ctx.fillStyle = oceanGrad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // 4. Continents
      CONTINENTS.forEach((poly) => {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < poly.length; i++) {
          const p = project(poly[i][0], poly[i][1], cx, cy, radius);
          if (p.visible) {
            if (!started) {
              ctx.moveTo(p.x, p.y);
              started = true;
            } else {
              ctx.lineTo(p.x, p.y);
            }
          }
        }
        if (started) {
          ctx.closePath();
          ctx.fillStyle = "rgba(34, 197, 94, 0.85)"; // Biosphere Green
          ctx.fill();
          ctx.strokeStyle = "rgba(16, 185, 129, 0.95)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      // 5. Day / Night Terminator Shadow
      const sunX = cx - radius * 0.42;
      const sunY = cy - radius * 0.42;
      const shadowGrad = ctx.createRadialGradient(
        sunX,
        sunY,
        radius * 0.22,
        sunX + radius * 0.82,
        sunY + radius * 0.82,
        radius * 1.55
      );
      shadowGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      shadowGrad.addColorStop(0.42, "rgba(3, 7, 18, 0.12)");
      shadowGrad.addColorStop(0.7, "rgba(2, 6, 23, 0.76)");
      shadowGrad.addColorStop(0.92, "rgba(1, 4, 14, 0.97)");
      shadowGrad.addColorStop(1, "rgba(0, 0, 0, 0.99)");
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // 6. Night City Lights (Golden Amber Emissive Clusters on Dark Hemisphere)
      ctx.fillStyle = "rgba(251, 191, 36, 0.88)";
      for (let i = 0; i < 52; i++) {
        const lLat = ((i * 29) % 115) - 48;
        const lLon = ((i * 47) % 360) - 180;
        const p = project(lLat, lLon, cx, cy, radius);
        if (p.visible && (p.x > cx - radius * 0.08 || p.y > cy - radius * 0.1)) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, i % 3 === 0 ? 1.6 : 1.0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 7. Atmospheric Fresnel Limb Rim
      const limbGrad = ctx.createRadialGradient(cx, cy, radius * 0.84, cx, cy, radius);
      limbGrad.addColorStop(0, "rgba(56, 189, 248, 0)");
      limbGrad.addColorStop(0.85, "rgba(56, 189, 248, 0.28)");
      limbGrad.addColorStop(1, "rgba(186, 230, 253, 0.72)");
      ctx.fillStyle = limbGrad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      ctx.restore();

      // 8. Global Plastic Hotspot Telemetry Rings
      GLOBAL_HOTSPOTS.forEach((spot, idx) => {
        const p = project(spot.lat, spot.lon, cx, cy, radius + 2);
        if (p.visible && p.z > 5) {
          const pulse = Math.sin(time * 3 + idx) * 0.5 + 0.5;
          const ringR = 4 + pulse * 9;

          // Pulse ring
          ctx.beginPath();
          ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle =
            spot.risk === "Critical"
              ? `rgba(239, 68, 68, ${1 - pulse})`
              : `rgba(52, 211, 153, ${1 - pulse})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Center solid dot
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = spot.risk === "Critical" ? "#ef4444" : "#10b981";
          ctx.fill();

          // Hotspot telemetry tag
          if (idx === 0 || idx === 1 || p.z > radius * 0.45) {
            ctx.fillStyle = "rgba(3, 7, 18, 0.85)";
            const label = spot.name;
            ctx.font = "10px Inter, system-ui, sans-serif";
            const textW = ctx.measureText(label).width;
            ctx.fillRect(p.x + 8, p.y - 11, textW + 12, 17);
            ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x + 8, p.y - 11, textW + 12, 17);

            ctx.fillStyle = "#f8fafc";
            ctx.fillText(label, p.x + 14, p.y + 1);
          }
        }
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      if (interactive) {
        canvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [size, interactive]);

  return (
    <div className={`relative flex items-center justify-center select-none ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-pan-y"
        title="Interactive 3D Earth — Drag to rotate"
      />
    </div>
  );
}
