export function EarthBackground({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none bg-slate-50 transition-colors duration-500 dark:bg-[#030712] ${className}`}
    >
      {/* 1. Starfield / subtle atmospheric sky background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-100/70 via-slate-100/60 to-slate-50/90 dark:from-sky-900/10 dark:via-[#030712]/80 dark:to-[#020408]" />

      {/* 2. Atmospheric cyan/blue ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] sm:h-[700px] sm:w-[700px] md:h-[900px] md:w-[900px] rounded-full bg-cyan-400/10 blur-[130px] dark:bg-cyan-500/15" />
      <div className="absolute bottom-10 right-10 h-[350px] w-[350px] md:h-[450px] md:w-[450px] rounded-full bg-sky-300/10 blur-[110px] dark:bg-blue-600/10" />

      {/* 3. Central Cinematic Photorealistic Earth Globe */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        {/* Outer Rayleigh atmospheric haze ring */}
        <div className="relative h-[310px] w-[310px] sm:h-[460px] sm:w-[460px] md:h-[600px] md:w-[600px] lg:h-[700px] lg:w-[700px] rounded-full shadow-[0_0_80px_15px_rgba(56,189,248,0.16),_0_0_150px_45px_rgba(14,165,233,0.08)] dark:shadow-[0_0_90px_20px_rgba(56,189,248,0.22),_0_0_180px_60px_rgba(14,165,233,0.12)]">
          {/* Inner spherical clip container */}
          <div className="relative h-full w-full rounded-full overflow-hidden">
            {/* The rotating Earth image */}
            <img
              src="/earth.png"
              alt=""
              className="h-full w-full object-cover animate-earth-spin will-change-transform opacity-30 dark:opacity-85"
            />

            {/* Static 3D Sunlight & Shadow Terminator */}
            <div className="absolute inset-0 rounded-full pointer-events-none bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.18)_0%,rgba(56,189,248,0.08)_35%,rgba(15,23,42,0.42)_72%,rgba(2,6,23,0.85)_100%)] dark:bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.12)_0%,rgba(56,189,248,0.06)_35%,rgba(2,6,23,0.65)_72%,rgba(2,6,23,0.94)_100%)] shadow-[inset_0_0_40px_rgba(56,189,248,0.22)] dark:shadow-[inset_0_0_50px_rgba(56,189,248,0.32)]" />
          </div>

          {/* Thin cyan atmospheric Fresnel rim */}
          <div className="absolute inset-0 rounded-full pointer-events-none border border-cyan-500/18 dark:border-cyan-400/25 shadow-[inset_0_0_24px_rgba(56,189,248,0.18)] dark:shadow-[inset_0_0_30px_rgba(56,189,248,0.25)]" />
        </div>
      </div>
    </div>
  );
}
