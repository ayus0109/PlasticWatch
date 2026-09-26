/**
 * Animated emerald waves behind the signed-in pages (replaces the rotating Earth).
 *
 * Shader from React Bits "GradientWaves" (reactbits.dev), ported from `ogl` to plain
 * WebGL2 so it adds no dependency (CLAUDE.md §3). It draws one full-screen triangle;
 * everything else happens in the fragment shader.
 *
 * Readability first: colours and opacity come from theme.ts `waves`, the canvas sits
 * behind everything and never takes a click, and a fade in the page background colour
 * keeps the top of the screen — where page titles are — almost plain.
 * Reduced motion: one still frame, no animation.
 */
import { useEffect, useRef } from "react";
import { currentTheme, waves, type ThemeMode } from "../lib/theme";

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uParallax;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
  float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
  c = cos(yaw); s = sin(yaw);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
  c = cos(pitch); s = sin(pitch);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = clamp(mix(uHorizonColor, body, t) * uBrightness, 0.0, 1.0);
  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * alpha, alpha);
}
`;

/** The look the user picked on React Bits, minus its neon colours (theme.ts owns those). */
const SETTINGS = {
  uSpeed: 0.4,
  uAmplitude: 2.8,
  uWaveScale: 0.6,
  uWaveRatio: 0.9,
  uSwell: 35,
  uTurbulence: 20,
  uTilt: 1.11,
  uZoom: 1,
  uHeight: 5.5,
  uFogDepth: 20,
  uSteps: 70, // "medium" detail
  uBrightness: 1,
  uParallax: 0.5,
} as const;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("WavesBackground shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function WavesBackground() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    // No WebGL2 (old phone, blocked GPU): the plain page background is the fallback.
    if (!gl) return;
    host.appendChild(canvas);

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      canvas.remove();
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // One triangle that covers the whole screen.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const loc = (name: string) => gl.getUniformLocation(program, name);
    for (const [name, value] of Object.entries(SETTINGS)) gl.uniform1f(loc(name), value);

    const applyTheme = (mode: ThemeMode) => {
      const w = waves[mode];
      gl.uniform3fv(loc("uHorizonColor"), rgb(w.horizon));
      gl.uniform3fv(loc("uWaveColor"), rgb(w.wave));
      gl.uniform3fv(loc("uCrestColor"), rgb(w.crest));
      gl.uniform1f(loc("uOpacity"), w.opacity);
    };
    applyTheme(currentTheme());

    const uTime = loc("iTime");
    const uMouse = loc("uMouse");
    const uRes = loc("iResolution");
    const mouse = [0.5, 0.5];
    const target = [0.5, 0.5];

    const draw = (seconds: number) => {
      mouse[0] += 0.05 * (target[0] - mouse[0]);
      mouse[1] += 0.05 * (target[1] - mouse[1]);
      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uMouse, mouse[0], mouse[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // It is soft fog: 1x pixels look the same and cost a quarter of the GPU on phones.
    const resize = () => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width));
      canvas.height = Math.max(1, Math.floor(r.height));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      draw((performance.now() - t0) / 1000);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      draw((now - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!reduced && raf === 0 && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    start();

    // The canvas is behind the page and takes no pointer events, so listen on window.
    const onMove = (e: PointerEvent) => {
      target[0] = e.clientX / window.innerWidth;
      target[1] = 1 - e.clientY / window.innerHeight;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onTheme = (e: Event) => {
      applyTheme((e as CustomEvent<ThemeMode>).detail ?? currentTheme());
      draw((performance.now() - t0) / 1000);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pw-theme", onTheme);

    return () => {
      stop();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pw-theme", onTheme);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 select-none bg-bg">
      <div ref={hostRef} className="absolute inset-0" />
      {/* Readability: the top of every page (titles, KPIs) sits on almost plain background. */}
      <div className="absolute inset-x-0 top-0 h-[55%] bg-gradient-to-b from-bg via-bg/80 to-transparent" />
    </div>
  );
}
