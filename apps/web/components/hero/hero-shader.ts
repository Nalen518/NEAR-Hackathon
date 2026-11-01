/**
 * Shark & Co. hero background — hand-written WebGL (no library).
 *
 * A halftone fin and sea drawn in ink dots on paper. The fin is the brand path
 * from scripts/mascots.js (verdict emblem), rendered to a small mask texture.
 * The sea is wave rows that follow a moving surface. A slow noise drift sits
 * around the fin, kept away from the headline. The pointer lifts the field and
 * switches to a finer dot grid under it.
 *
 * Desktop / laptop only (no phone layout; design rule D-050).
 * Budget rules (motion spec v1.0): ≤ 30 fps, DPR ≤ 1.5 (lowered automatically on
 * slow devices), paused when off-screen
 * or the tab is hidden, one still frame under prefers-reduced-motion,
 * caller shows a static image when WebGL is missing.
 */

export type HeroShaderStyle = "dots" | "bayer";

export interface HeroShaderOptions {
  /** Halftone dots (brand default) or ordered-dither squares. */
  style?: HeroShaderStyle;
  /** Dot cell size in CSS px. */
  cell?: number;
  /** Pointer lens on/off. */
  lens?: boolean;
  /** 0..1 accent tint in the mid-tones. Brand default 0 (accent is for CTAs). */
  tint?: number;
  /** Frame cap. */
  fps?: number;
  /** Device-pixel-ratio cap. */
  maxDpr?: number;
  /** Force one still frame. Defaults to the OS prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  /** Token colours as hex. */
  colors?: { paper: string; ink: string; accent: string };
  /** Sea surface height as a fraction of the hero height (wide screens). */
  horizon?: number;
  /** Right edge of the text column as a fraction of the width; drift stays right of it. */
  textRight?: number;
}

export interface HeroShaderHandle {
  setOptions(next: Partial<HeroShaderOptions>): void;
  destroy(): void;
  /** Frames drawn in the last second (for a debug readout). */
  readonly fps: number;
}

const DEFAULTS: Required<Omit<HeroShaderOptions, "reducedMotion">> & { reducedMotion?: boolean } = {
  style: "dots",
  cell: 7,
  lens: true,
  tint: 0,
  fps: 30,
  maxDpr: 1.5,
  colors: { paper: "#F5F6F8", ink: "#161A22", accent: "#2B59FF" },
  horizon: 0.17,
  textRight: 0.46,
};

// Brand fin (100-unit box) from scripts/mascots.js verdictShark().
const FIN_PATH = "M30,64 C36,46 46,26 64,18 C60,34 62,50 72,64 Z";
const FIN_BOX = { x: 27, y: 15, w: 48, h: 51 }; // path bounds + 3u padding

const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uLens;
uniform float uCell;
uniform float uStyle;
uniform float uTint;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform sampler2D uFin;
uniform vec4 uFinRect;   // left, base, width, height (px, GL coords)
uniform float uHorizon;  // px from bottom
uniform float uTextFade; // drift fades in right of this x (px)

float hash(vec2 p){ p = fract(p*vec2(234.34, 435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float bayer2(vec2 a){ a = floor(a); return fract(a.x*0.5 + a.y*a.y*0.75); }
float bayer4(vec2 a){ return bayer2(0.5*a)*0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5*a)*0.25 + bayer2(a); }

float surfaceY(float x){
  float a = uRes.y*0.009;
  return uHorizon + a*sin(x*0.010 + uTime*0.55) + a*0.6*sin(x*0.023 - uTime*0.8);
}

// Ink density 0..1 at a pixel (GL coords).
float density(vec2 p){
  float t = uTime;
  float s = surfaceY(p.x);
  float d = 0.0;

  // Slow drift around the fin, never behind the headline.
  vec2 uv = p / uRes.y;
  vec2 q = vec2(fbm(uv*2.4 + vec2(0.0, t*0.035)), fbm(uv*2.4 + vec2(5.2, -t*0.035)));
  float f = fbm(uv*2.4 + 2.2*q + t*0.02);
  vec2 fc = vec2(uFinRect.x + uFinRect.z*0.55, uFinRect.y + uFinRect.w*0.42);
  float halo = smoothstep(uRes.y*0.62, uRes.y*0.04, length(p - fc));
  float textMask = smoothstep(uTextFade, uTextFade + uRes.x*0.14, p.x);
  float patch = clamp((f - 0.42)*1.35, 0.0, 1.0);
  d = max(d, patch * halo * textMask * 0.55);

  // Fin: gentle sway around its base and a small bob, visible above the surface.
  vec2 base = vec2(uFinRect.x + uFinRect.z*0.5, uFinRect.y);
  float ang = 0.03*sin(t*0.45);
  vec2 r = p - base;
  r = vec2(cos(ang)*r.x - sin(ang)*r.y, sin(ang)*r.x + cos(ang)*r.y);
  vec2 fp = r + base - vec2(0.0, uRes.y*0.007*sin(t*0.6));
  vec2 tuv = vec2((fp.x - uFinRect.x)/uFinRect.z, (fp.y - uFinRect.y)/uFinRect.w);
  if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0 && p.y > s) {
    d = max(d, texture2D(uFin, vec2(tuv.x, 1.0 - tuv.y)).r);
  }

  // Sea: wave rows that follow the surface, darker near the top.
  if (p.y <= s) {
    float spacing = uRes.y*0.034;
    float depth = clamp((s - p.y)/max(uHorizon, 1.0), 0.0, 1.0);
    float row = (s - p.y)/spacing;
    float wob = 0.22*sin(p.x*0.017 + floor(row)*1.9 + t*0.7);
    float crest = 1.0 - smoothstep(0.0, 0.32, abs(fract(row + wob) - 0.5));
    float grain = 0.75 + 0.5*vnoise(p/(spacing*1.6) + vec2(t*0.25, 0.0));
    float under = mix(0.55, 1.0, textMask);
    float seaD = mix(0.52, 0.12, depth) * (0.25 + 0.75*crest) * grain * under;
    float surf = smoothstep(spacing*0.7, 0.0, s - p.y) * mix(0.6, 1.0, textMask);
    d = max(seaD, surf*0.85);
  }

  // Pointer lens lifts the field.
  float lens = uLens * smoothstep(uRes.y*0.22, 0.0, length(p - uMouse));
  d += lens*0.16*smoothstep(0.0, 0.08, d + f*0.12);
  return clamp(d, 0.0, 1.0);
}

// Returns (ink coverage, density at the cell centre).
vec2 dotsAt(vec2 frag, float cell){
  vec2 id = floor(frag/cell);
  vec2 c = (id + 0.5)*cell;
  float dd = density(c);
  float radius = 0.5*sqrt(dd)*1.1*cell;
  float cover = clamp(radius - length(frag - c) + 0.5, 0.0, 1.0) * step(0.02, dd);
  return vec2(cover, dd);
}
vec2 bayerAt(vec2 frag, float cell){
  vec2 id = floor(frag/cell);
  float dd = density((id + 0.5)*cell);
  float q = floor(dd*4.0 + bayer8(id))/4.0;
  return vec2(clamp(q, 0.0, 1.0), dd);
}
vec2 markAt(vec2 frag, float cell){ return uStyle < 0.5 ? dotsAt(frag, cell) : bayerAt(frag, cell); }

void main(){
  vec2 frag = gl_FragCoord.xy;
  float lensHere = uLens * smoothstep(uRes.y*0.22, 0.0, length(frag - uMouse));
  float k = smoothstep(0.15, 0.6, lensHere);
  vec2 m = markAt(frag, uCell);
  if (k > 0.001) m = mix(m, markAt(frag, uCell*0.5), k); // finer grid under the pointer
  vec3 inkCol = mix(uInk, uAccent, clamp(uTint*4.0*m.y*(1.0 - m.y), 0.0, 1.0));
  gl_FragColor = vec4(mix(uPaper, inkCol, m.x), 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function finMask(): HTMLCanvasElement {
  const W = 256, H = Math.round((256 * FIN_BOX.h) / FIN_BOX.w);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const s = W / FIN_BOX.w;
  g.setTransform(s, 0, 0, s, -FIN_BOX.x * s, -FIN_BOX.y * s);
  // Leading edge darker, trailing edge lighter: reads as volume in halftone.
  const grad = g.createLinearGradient(30, 0, 72, 0);
  grad.addColorStop(0, "rgb(245,245,245)");
  grad.addColorStop(0.55, "rgb(205,205,205)");
  grad.addColorStop(1, "rgb(150,150,150)");
  g.fillStyle = grad;
  g.fill(new Path2D(FIN_PATH));
  return c;
}

// No status check here: asking for COMPILE_STATUS makes the main thread wait for the GPU (Lighthouse F11: ~650 ms).
// Errors are read once, after the link finishes (see setup()).
function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src); gl.compileShader(sh);
  return sh;
}

/** Fired on the canvas when the shader can't be built, so the wrapper can show the still image. */
export const HERO_SHADER_FAIL = "heroshaderfail";

// Unset props arrive as explicit undefined from the React wrapper; drop them so defaults win.
const defined = <T extends object>(x: T): Partial<T> => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Returns null when WebGL is unavailable; show a static image instead. */
export function createHeroShader(canvas: HTMLCanvasElement, options: HeroShaderOptions = {}): HeroShaderHandle | null {
  const prefersReduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let o = { ...DEFAULTS, ...defined(options), colors: { ...DEFAULTS.colors, ...(options.colors ?? {}) } };
  const reduced = () => o.reducedMotion ?? prefersReduced;

  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "low-power" }) as WebGLRenderingContext | null;
  if (!gl) return null;

  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  let tex: WebGLTexture | null = null;
  const U: Record<string, WebGLUniformLocation | null> = {};

  // KHR_parallel_shader_compile lets us poll instead of blocking on the GPU while the shader compiles.
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  let ready = false;
  let shaders: WebGLShader[] = [];

  /** Starts compiling and linking. Calls setup() now, or once the GPU is done when the extension exists. */
  function init(): boolean {
    ready = false;
    const vs = compile(gl!, gl!.VERTEX_SHADER, VERT), fs = compile(gl!, gl!.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    shaders = [vs, fs];
    prog = gl!.createProgram()!;
    gl!.attachShader(prog, vs); gl!.attachShader(prog, fs); gl!.linkProgram(prog);
    if (!parallel) return setup();
    const poll = () => {
      if (!prog) return;
      if (gl!.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) { if (!setup()) canvas.dispatchEvent(new Event(HERO_SHADER_FAIL)); }
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
    return true;
  }

  function setup(): boolean {
    if (!gl!.getProgramParameter(prog!, gl!.LINK_STATUS)) {
      console.error("[hero-shader]", gl!.getProgramInfoLog(prog!), ...shaders.map((x) => gl!.getShaderInfoLog(x)));
      return false;
    }
    for (const x of shaders) gl!.deleteShader(x);
    shaders = [];
    gl!.useProgram(prog);
    buf = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW); // one big triangle
    const loc = gl!.getAttribLocation(prog!, "aPos");
    gl!.enableVertexAttribArray(loc); gl!.vertexAttribPointer(loc, 2, gl!.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uTime", "uMouse", "uLens", "uCell", "uStyle", "uTint", "uPaper", "uInk", "uAccent", "uFin", "uFinRect", "uHorizon", "uTextFade"]) U[n] = gl!.getUniformLocation(prog!, n);
    tex = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, finMask());
    gl!.uniform1i(U.uFin, 0);
    ready = true;
    applyStatic();
    resize();
    start();
    canvas.style.opacity = "1"; // fade in after the first frame, never a blank flash
    return true;
  }

  let dpr = 1, qualityScale = 1;
  function applyStatic() {
    if (!ready) return;
    gl!.uniform3fv(U.uPaper, hexToRgb(o.colors.paper));
    gl!.uniform3fv(U.uInk, hexToRgb(o.colors.ink));
    gl!.uniform3fv(U.uAccent, hexToRgb(o.colors.accent));
    gl!.uniform1f(U.uStyle, o.style === "bayer" ? 1 : 0);
    gl!.uniform1f(U.uTint, o.tint);
  }
  function resize() {
    if (!ready) return;
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr) * qualityScale;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl!.viewport(0, 0, w, h);
    gl!.uniform2f(U.uRes, w, h);
    gl!.uniform1f(U.uCell, Math.max(3, o.cell * dpr));
    // Layout (desktop / laptop only): fin on the right, text column on the left.
    const horizon = h * o.horizon;
    const finH = h * 0.72;
    const finW = (finH * FIN_BOX.w) / FIN_BOX.h;
    const cx = w * 0.82; // Figma 139:3038: the peak shows right of the job card
    gl!.uniform4f(U.uFinRect, cx - finW / 2, horizon - finH * 0.08, finW, finH);
    gl!.uniform1f(U.uHorizon, horizon);
    gl!.uniform1f(U.uTextFade, w * o.textRight);
    if (!running) draw(lastT);
  }

  // Pointer → GL pixel coords; eased lens strength.
  const mouse = { x: -1e4, y: -1e4, on: 0 };
  let lens = 0;
  function onPointer(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    mouse.on = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? 1 : 0;
    mouse.x = x * dpr; mouse.y = (r.height - y) * dpr;
  }

  const t0 = performance.now() - 8000;
  let raf = 0, running = false, visible = true, lastT = 8, lastFrame = 0;
  let frames = 0, fpsNow = 0, fpsMark = performance.now(), slowSeconds = 0;
  function draw(t: number) {
    if (!ready) return;
    gl!.uniform1f(U.uTime, t);
    gl!.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl!.uniform1f(U.uLens, o.lens ? lens : 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const minDt = 1000 / o.fps;
    if (now - lastFrame < minDt - 1) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    lens += (mouse.on - lens) * Math.min(1, dt * 5);
    lastT = (now - t0) / 1000;
    draw(lastT);
    frames++;
    if (now - fpsMark >= 1000) {
      fpsNow = frames; frames = 0; fpsMark = now;
      // Slow device: lower the pixel ratio once or twice before giving up smoothness.
      slowSeconds = fpsNow < o.fps * 0.6 ? slowSeconds + 1 : 0;
      if (slowSeconds >= 2 && qualityScale > 0.5) { qualityScale *= 0.75; slowSeconds = 0; resize(); }
    }
  }
  function start() {
    if (!ready) return;
    if (running || reduced() || !visible || document.hidden) { if (!running) draw(lastT); return; }
    running = true; lastFrame = 0; raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); fpsNow = 0; }

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }, { threshold: 0 });
  const ro = new ResizeObserver(() => resize());
  const onVis = () => (document.hidden ? stop() : start());
  const onLost = (e: Event) => { e.preventDefault(); stop(); };
  const onRestored = () => void init();

  canvas.style.opacity = "0";
  canvas.style.transition = reduced() ? "none" : "opacity 280ms ease-out";
  if (!init()) return null;
  io.observe(canvas); ro.observe(canvas);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    get fps() { return fpsNow; },
    setOptions(next) {
      o = { ...o, ...defined(next), colors: { ...o.colors, ...(next.colors ?? {}) } };
      applyStatic(); resize();
      if (reduced()) { stop(); draw(lastT); } else start();
    },
    destroy() {
      stop(); io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (prog) gl.deleteProgram(prog);
      if (buf) gl.deleteBuffer(buf);
      if (tex) gl.deleteTexture(tex);
    },
  };
}
