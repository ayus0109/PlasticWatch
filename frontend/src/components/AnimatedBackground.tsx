import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseAlpha: number;
  pulseSpeed: number;
  pulse: number;
  colorIdx: number;
}

interface Beacon {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

/**
 * AnimatedBackground — Interactive Oceanic GIS & Particle Mesh
 *
 * Implements a living, tactical ambient background:
 * - Fluid river/ocean current flow simulation
 * - Interactive cursor repulsion & ripple physics
 * - Click-to-pulse environmental hotspot sonar rings
 * - Tactical GIS coordinate grid & sweeping environmental radar scan
 * - Instant live response to Light & Dark theme toggle
 * - Zero-lag, 60fps canvas with tab-visibility auto-pausing
 */
export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Check if dark mode is active
    let isDark = document.documentElement.classList.contains("dark");

    const getThemeColors = () => {
      if (isDark) {
        return {
          grid: "rgba(45, 212, 191, 0.04)",
          gridCross: "rgba(45, 212, 191, 0.16)",
          dots: ["#2dd4bf", "#38bdf8", "#5eead4", "#0d9488"],
          lines: "rgba(45, 212, 191, ",
          beacon: "rgba(45, 212, 191, ",
          radar: "rgba(45, 212, 191, 0.035)",
          glow1: "rgba(13, 148, 136, 0.13)",
          glow2: "rgba(2, 132, 199, 0.11)",
        };
      }
      return {
        grid: "rgba(15, 118, 110, 0.035)",
        gridCross: "rgba(13, 148, 136, 0.15)",
        dots: ["#0d9488", "#0284c7", "#0f766e", "#14b8a6"],
        lines: "rgba(13, 148, 136, ",
        beacon: "rgba(13, 148, 136, ",
        radar: "rgba(13, 148, 136, 0.025)",
        glow1: "rgba(45, 212, 191, 0.15)",
        glow2: "rgba(56, 189, 248, 0.12)",
      };
    };

    let colors = getThemeColors();

    const updateTheme = () => {
      isDark = document.documentElement.classList.contains("dark");
      colors = getThemeColors();
    };

    // Listen to theme switches from ThemeToggle and DOM mutations
    window.addEventListener("pw-theme", updateTheme);
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    // Mouse interaction tracking
    const mouse = { x: -1000, y: -1000, active: false };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };
    const onPointerLeave = () => {
      mouse.active = false;
    };

    // Click to trigger tactical hotspot sonar pulse
    const onPointerDown = (e: PointerEvent) => {
      beacons.push({
        x: e.clientX,
        y: e.clientY,
        radius: 4,
        maxRadius: Math.random() * 50 + 60,
        alpha: 0.75,
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerdown", onPointerDown);

    // Particles setup
    const isMobile = width < 768;
    const particleCount = isMobile ? 24 : Math.min(50, Math.max(30, Math.floor((width * height) / 26000)));
    const particles: Particle[] = [];
    const beacons: Beacon[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2.0 + 1.2,
        baseAlpha: Math.random() * 0.4 + 0.35,
        pulseSpeed: Math.random() * 0.02 + 0.01,
        pulse: Math.random() * Math.PI * 2,
        colorIdx: Math.floor(Math.random() * 4),
      });
    }

    const spawnAmbientBeacon = () => {
      if (beacons.length < 3 && Math.random() < 0.012) {
        beacons.push({
          x: Math.random() * width * 0.85 + width * 0.075,
          y: Math.random() * height * 0.85 + height * 0.075,
          radius: 4,
          maxRadius: Math.random() * 55 + 50,
          alpha: 0.55,
        });
      }
    };

    let radarAngle = 0;
    let time = 0;
    let isVisible = !document.hidden;

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        animId = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const render = () => {
      if (!isVisible) return;
      time += 0.01;
      ctx.clearRect(0, 0, width, height);

      // 1. Ambient Fluid Gradient Blobs
      const orb1X = width * 0.25 + Math.sin(time * 0.45) * 70;
      const orb1Y = height * 0.3 + Math.cos(time * 0.35) * 55;
      const g1 = ctx.createRadialGradient(orb1X, orb1Y, 10, orb1X, orb1Y, Math.max(260, width * 0.3));
      g1.addColorStop(0, colors.glow1);
      g1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const orb2X = width * 0.78 + Math.cos(time * 0.5) * 80;
      const orb2Y = height * 0.68 + Math.sin(time * 0.42) * 65;
      const g2 = ctx.createRadialGradient(orb2X, orb2Y, 10, orb2X, orb2Y, Math.max(280, width * 0.32));
      g2.addColorStop(0, colors.glow2);
      g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      // 2. Tactical GIS Grid Matrix
      const gridSize = 64;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Intersection Crosshairs
      ctx.fillStyle = colors.gridCross;
      for (let x = gridSize; x < width; x += gridSize * 2) {
        for (let y = gridSize; y < height; y += gridSize * 2) {
          ctx.fillRect(x - 2, y, 5, 1);
          ctx.fillRect(x, y - 2, 1, 5);
        }
      }

      // 3. Environmental Satellite Radar Sweep
      radarAngle += 0.0025;
      const scanX = ((Math.sin(radarAngle) + 1) / 2) * (width + 240) - 120;
      const scanGrad = ctx.createLinearGradient(scanX - 140, 0, scanX + 40, 0);
      scanGrad.addColorStop(0, "rgba(0,0,0,0)");
      scanGrad.addColorStop(0.75, colors.radar);
      scanGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 140, 0, 180, height);

      // 4. Hotspot Sonar Beacons
      spawnAmbientBeacon();
      for (let i = beacons.length - 1; i >= 0; i--) {
        const b = beacons[i];
        b.radius += 0.65;
        b.alpha *= 0.985;

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.strokeStyle = colors.beacon + b.alpha + ")";
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = colors.beacon + Math.min(1, b.alpha * 1.6) + ")";
        ctx.fill();

        if (b.radius >= b.maxRadius || b.alpha <= 0.02) {
          beacons.splice(i, 1);
        }
      }

      // 5. River Flow & Microplastic Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.pulse += p.pulseSpeed;
        const waveX = Math.sin(time + p.y * 0.007) * 0.16;
        const waveY = Math.cos(time + p.x * 0.007) * 0.16;
        p.x += p.vx + waveX;
        p.y += p.vy + waveY;

        // Interactive mouse repulsion
        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140 && dist > 0.1) {
            const force = (1 - dist / 140) * 1.6;
            p.x += (dx / dist) * force;
            p.y += (dy / dist) * force;
          }
        }

        // Screen wrap
        if (p.x < -15) p.x = width + 15;
        if (p.x > width + 15) p.x = -15;
        if (p.y < -15) p.y = height + 15;
        if (p.y > height + 15) p.y = -15;

        // Draw particle
        const currentAlpha = p.baseAlpha + Math.sin(p.pulse) * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = colors.dots[p.colorIdx];
        ctx.globalAlpha = Math.max(0.1, Math.min(1, currentAlpha));
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 6. Proximity Constellation Lines
      const maxDist = isMobile ? 85 : 110;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i];
          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const lineAlpha = (1 - dist / maxDist) * 0.22;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = colors.lines + lineAlpha + ")";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("pw-theme", updateTheme);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
    />
  );
}
