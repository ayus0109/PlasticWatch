export function EarthBackground({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none bg-[#030712] ${className}`}
    >
      {/* 1. Deep cosmic starfield overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/10 via-[#030712]/80 to-[#020408]" />
      
      {/* 2. Atmospheric cyan/blue ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] md:h-[900px] md:w-[900px] rounded-full bg-cyan-500/10 blur-[140px] dark:bg-cyan-500/15" />
      <div className="absolute bottom-10 right-10 h-[400px] w-[400px] rounded-full bg-blue-600/10 blur-[120px]" />

      {/* 3. Central Cinematic Photorealistic Earth Globe (from user uploaded image) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        {/* Outer Rayleigh atmospheric haze ring */}
        <div className="relative h-[340px] w-[340px] sm:h-[480px] sm:w-[480px] md:h-[620px] md:w-[620px] lg:h-[720px] lg:w-[720px] rounded-full shadow-[0_0_90px_20px_rgba(56,189,248,0.22),_0_0_180px_60px_rgba(14,165,233,0.12)]">
          
          {/* Inner spherical clip container */}
          <div className="relative h-full w-full rounded-full overflow-hidden">
            {/* The rotating Earth image */}
            <img
              src="/earth.png"
              alt=""
              className="h-full w-full object-cover animate-earth-spin will-change-transform opacity-75 dark:opacity-85"
            />

            {/* Static 3D Sunlight & Shadow Terminator:
                The sunlight shines from top-left, while shadow sits on the bottom-right.
                Because this gradient is fixed while the Earth texture rotates underneath,
                it creates a realistic 3D planetary lighting illusion! */}
            <div className="absolute inset-0 rounded-full pointer-events-none bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.12)_0%,rgba(56,189,248,0.06)_35%,rgba(2,6,23,0.65)_72%,rgba(2,6,23,0.94)_100%)] shadow-[inset_0_0_50px_rgba(56,189,248,0.32)]" />
          </div>

          {/* Thin cyan atmospheric Fresnel rim */}
          <div className="absolute inset-0 rounded-full pointer-events-none border border-cyan-400/25 shadow-[inset_0_0_30px_rgba(56,189,248,0.25)]" />
        </div>
      </div>
    </div>
  );
}
