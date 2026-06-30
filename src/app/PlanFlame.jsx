import { useEffect, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

export const PLAN_FLAME_OPTIONS = [
  { key: "free", label: "Free" },
  { key: "plus", label: "Plus" },
  { key: "pro", label: "Pro" },
  { key: "ultra", label: "Ultra" },
];

const PLAN_FLAME_KEYS = new Set(PLAN_FLAME_OPTIONS.map((option) => option.key));
const PLAN_FLAME_REVEAL_DELAY_MS = 180;
const PLAN_FLAME_ANIMATION_STORAGE_KEY = "diffforge.planFlame.animationEnabled";

// quality.ratio caps the render pixel ratio, quality.octaves the noise depth,
// and quality.detail gates the ridged-lick pass and second ember layer, so
// lower tiers stay cheap on weak GPUs while pro/ultra keep full fidelity.
const PLAN_FLAME_PRESETS = {
  free: {
    height: 150,
    core: [1, 0.93, 0.72],
    mid: [1, 0.42, 0.12],
    outer: [0.45, 0.03, 0.01],
    accent: [1, 0.64, 0.16],
    accent2: [0.92, 0.1, 0.04],
    glow: "rgba(255, 73, 63, 0.42)",
    heat: "#ff493f",
    intensity: 0.76,
    speed: 1.32,
    top: 0.5,
    volatility: 1,
    flash: 0.88,
    sparks: 0.6,
    accentMix: 0.32,
    quality: { ratio: 1, octaves: 3, detail: false },
  },
  plus: {
    height: 215,
    core: [1, 0.99, 0.84],
    mid: [1, 0.74, 0.22],
    outer: [0.58, 0.16, 0.02],
    accent: [1, 0.47, 0.1],
    accent2: [0.96, 0.2, 0.06],
    glow: "rgba(255, 194, 71, 0.46)",
    heat: "#ffc247",
    intensity: 0.88,
    speed: 1.22,
    top: 0.62,
    volatility: 1.12,
    flash: 1,
    sparks: 0.9,
    accentMix: 0.6,
    quality: { ratio: 1.25, octaves: 3, detail: false },
  },
  pro: {
    height: 295,
    core: [1, 1, 1],
    mid: [0.74, 0.87, 1],
    outer: [0.1, 0.3, 0.74],
    accent: [0.42, 0.86, 1],
    accent2: [0.3, 0.5, 1],
    glow: "rgba(198, 220, 246, 0.42)",
    heat: "#f4fbff",
    intensity: 0.96,
    speed: 1.12,
    top: 0.74,
    volatility: 1.22,
    flash: 1.08,
    sparks: 1.15,
    accentMix: 0.85,
    quality: { ratio: 1.5, octaves: 4, detail: true },
  },
  ultra: {
    height: 385,
    core: [0.95, 0.97, 1],
    mid: [0.5, 0.45, 1],
    outer: [0.26, 0.06, 0.56],
    accent: [0.1, 0.85, 1],
    accent2: [0.95, 0.28, 1],
    glow: "rgba(126, 88, 250, 0.5)",
    heat: "#8d6bff",
    intensity: 1,
    speed: 1.02,
    top: 0.85,
    volatility: 1.34,
    flash: 1.18,
    sparks: 1.4,
    accentMix: 1,
    quality: { ratio: 1.5, octaves: 4, detail: true },
  },
};

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const buildFlameFragmentSource = (quality) => `
  precision highp float;

  #define OCTAVES ${quality.octaves}
  ${quality.detail ? "#define DETAIL" : ""}

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_intensity;
  uniform float u_top;
  uniform float u_volatility;
  uniform float u_flash;
  uniform float u_sparks;
  uniform float u_accentMix;
  uniform vec3 u_core;
  uniform vec3 u_mid;
  uniform vec3 u_outer;
  uniform vec3 u_accent;
  uniform vec3 u_accent2;

  varying vec2 v_uv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 warp = mat2(1.62, 1.18, -1.18, 1.62);

    for (int i = 0; i < OCTAVES; i++) {
      value += amplitude * noise(p);
      p = warp * p + 17.71;
      amplitude *= 0.52;
    }

    return value;
  }

  #ifdef DETAIL
  float ridge(vec2 p) {
    float value = 0.0;
    float amplitude = 0.55;
    mat2 warp = mat2(1.7, 1.1, -1.1, 1.7);

    for (int i = 0; i < 4; i++) {
      value += amplitude * abs(noise(p) * 2.0 - 1.0);
      p = warp * p + 11.3;
      amplitude *= 0.52;
    }

    return value;
  }
  #endif

  float emberLayer(vec2 p, float t, float seed, float speed, float scale) {
    vec2 g = vec2(p.x * scale + seed, (p.y - t * speed) * scale);
    g.x += sin(t * (1.1 + seed * 0.13) + p.y * 9.0 + seed) * 0.9;

    vec2 cell = floor(g);
    vec2 f = fract(g);
    float rnd = hash(cell + seed);
    if (rnd < 0.84) {
      return 0.0;
    }

    vec2 center = vec2(0.2) + 0.6 * vec2(hash(cell + 4.7 + seed), hash(cell + 9.3 + seed));
    float d = length(f - center);
    float blink = 0.55 + 0.45 * sin(t * (3.0 + rnd * 5.0) + rnd * 39.0);
    return smoothstep(0.22 + rnd * 0.12, 0.0, d) * blink;
  }

  float flareEmber(vec2 uv, float t, float seed) {
    float cycle = t * (0.42 + hash(vec2(seed, 2.7)) * 0.14) + seed;
    float id = floor(cycle);
    float life = fract(cycle);
    float angle = hash(vec2(id, seed + 3.0)) * 6.2831853;
    float x = mix(0.12, 0.88, hash(vec2(id + seed, 7.1)));
    float y = mix(0.06, 0.74, life);
    x += sin(life * 5.4 + angle) * 0.045;

    vec2 delta = vec2((uv.x - x) * 1.7, uv.y - y);
    float d = length(delta);
    float core = 1.0 - smoothstep(0.0, 0.034, d);
    float halo = (1.0 - smoothstep(0.0, 0.08, d)) * 0.28;
    float fade = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.78, 1.0, life));
    return (core + halo) * fade;
  }

  void main() {
    vec2 uv = v_uv;
    float t = u_time;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 p = vec2(uv.x * aspect, uv.y);

    float gust = (fbm(vec2(t * 0.32, 4.7)) - 0.5) * 2.0;
    p.x += gust * uv.y * 0.55 * u_volatility
      + sin(t * 1.4 + uv.y * 5.0) * 0.05 * uv.y;

    vec2 q = vec2(
      fbm(p * 1.8 + vec2(0.0, -t * 1.15)),
      fbm(p * 1.8 + vec2(5.2, -t * 1.45))
    );
    float turb = fbm(p * 2.6 + (q - 0.5) * 2.3 + vec2(0.0, -t * 1.9));
    #ifdef DETAIL
    float licks = ridge(p * vec2(3.4, 2.2) + (q - 0.5) * 1.7 + vec2(0.0, -t * 2.6));
    #else
    float licks = 0.0;
    #endif

    float tongueField = fbm(vec2(p.x * 1.45 + t * 0.16, t * 0.75));
    float tongues = pow(tongueField, 1.6) * 1.9;

    float flareField = fbm(vec2(p.x * 0.55 - t * 0.09, t * 0.5));
    float flare = pow(smoothstep(0.52, 0.8, flareField), 2.0) * u_flash;

    float ceilingRaw = u_top * (0.34 + tongues * u_volatility) + flare * 0.85 * u_top;
    // Soft-knee compression: tall tongues and flares squash toward 0.88
    // instead of clipping, so flame tips always taper inside the canvas.
    float knee = max(ceilingRaw - 0.6, 0.0);
    float ceiling = min(ceilingRaw, 0.6) + 0.28 * (1.0 - exp(-knee / 0.28));
    ceiling = max(ceiling, 0.07);

    float h = uv.y / ceiling;
    float shape = 1.0 - h;
    shape += (turb - 0.5) * mix(0.3, 1.6, clamp(uv.y * 1.6, 0.0, 1.0)) * u_volatility;
    shape -= licks * 0.22 * h;

    float fire = smoothstep(0.04, 0.42, shape);

    float pulse = 0.86 + (fbm(vec2(t * 2.4, 17.0)) - 0.5) * 0.55 * u_flash;

    float heat = fire * (0.5 + turb * 0.8 + flare * 0.5);
    heat += smoothstep(0.32, 0.0, uv.y) * (0.5 + 0.2 * turb);
    heat *= pulse;

    float streakA = smoothstep(0.56, 0.92, fbm(p * 3.2 + (q - 0.5) * 2.6 + vec2(2.3, -t * 1.6)));
    float streakB = smoothstep(0.6, 0.95, fbm(p * 4.1 - (q - 0.5) * 2.1 + vec2(7.7, -t * 2.2)));

    vec3 color = u_outer;
    color = mix(color, u_mid, smoothstep(0.12, 0.58, heat));
    color = mix(color, u_accent, streakA * u_accentMix * fire);
    color = mix(color, u_accent2, streakB * u_accentMix * fire * 0.85);
    color = mix(color, u_core, smoothstep(0.55, 0.92, heat));
    color = mix(color, vec3(1.0), smoothstep(0.9, 1.25, heat + (0.1 - uv.y) * 1.6) * 0.8);

    float ember = emberLayer(p, t, 0.0, 0.5, 15.0);
    #ifdef DETAIL
    ember += emberLayer(p, t, 13.0, 0.85, 23.0) * 0.8;
    #endif
    float flareSpark = flareEmber(uv, t, 4.0);
    float emberMask = smoothstep(0.03, 0.15, uv.y) * (1.0 - smoothstep(0.7, 1.0, uv.y));
    ember *= emberMask * u_sparks * (0.35 + 0.4 * pulse);
    flareSpark *= emberMask * u_sparks * (0.55 + 0.45 * flare + 0.25 * pulse);
    color += (mix(u_accent, u_core, 0.5) + 0.35) * ember;
    color += (mix(u_accent, u_core, 0.72) + 0.45) * flareSpark;

    float glow = (1.0 - smoothstep(0.0, ceiling + 0.4, uv.y))
      * smoothstep(0.05, 0.4, heat) * 0.3;

    float alpha = fire * (0.8 + 0.35 * turb) + glow + ember + flareSpark;
    alpha *= u_intensity * pulse;
    // The ceiling compressor keeps fire below 0.88, so this fade only grazes
    // embers and glow instead of flattening flame tips.
    alpha *= 1.0 - smoothstep(0.9, 1.0, uv.y);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) || "Shader compile failed.";
    gl.deleteShader(shader);
    throw new Error(error);
  }

  return shader;
}

function createProgram(gl, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Unable to create WebGL program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) || "Shader link failed.";
    gl.deleteProgram(program);
    throw new Error(error);
  }

  return program;
}

function normalizedColor(color) {
  return new Float32Array(color);
}

function readPlanFlameAnimationEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(PLAN_FLAME_ANIMATION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function rememberPlanFlameAnimationEnabled(enabled) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PLAN_FLAME_ANIMATION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Best-effort UI preference; animation state still updates for this session.
  }
}

export function normalizePlanFlameKey(plan, fallback = "") {
  const key = String(plan || "").trim().toLowerCase();
  return PLAN_FLAME_KEYS.has(key) ? key : fallback;
}

function FlameShaderCanvas({ active, preset, planKey, onReady }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas || typeof window === "undefined") {
      return undefined;
    }

    onReady(false);

    // Cap the flame to ~30fps. The fragment shader is expensive, and on
    // ProMotion/120Hz displays an uncapped rAF loop renders 2-4x more frames
    // than a soft organic flame needs, which dominates GPU energy. Motion
    // stays correct because the time uniform uses real elapsed time, not
    // frame count.
    const TARGET_FPS = 30;
    const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
    let frame = 0;
    let frameTimer = 0;
    let isIntersecting = true;
    let resizeObserver = null;
    let intersectionObserver = null;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });

    if (!gl) {
      return undefined;
    }

    try {
      const program = createProgram(gl, buildFlameFragmentSource(preset.quality));
      const positionLocation = gl.getAttribLocation(program, "a_position");
      const uniforms = {
        accent: gl.getUniformLocation(program, "u_accent"),
        accent2: gl.getUniformLocation(program, "u_accent2"),
        accentMix: gl.getUniformLocation(program, "u_accentMix"),
        core: gl.getUniformLocation(program, "u_core"),
        flash: gl.getUniformLocation(program, "u_flash"),
        intensity: gl.getUniformLocation(program, "u_intensity"),
        mid: gl.getUniformLocation(program, "u_mid"),
        outer: gl.getUniformLocation(program, "u_outer"),
        resolution: gl.getUniformLocation(program, "u_resolution"),
        sparks: gl.getUniformLocation(program, "u_sparks"),
        time: gl.getUniformLocation(program, "u_time"),
        top: gl.getUniformLocation(program, "u_top"),
        volatility: gl.getUniformLocation(program, "u_volatility"),
      };
      const buffer = gl.createBuffer();
      const startTime = performance.now();
      let reportedReady = false;
      const colors = {
        accent: normalizedColor(preset.accent),
        accent2: normalizedColor(preset.accent2),
        core: normalizedColor(preset.core),
        mid: normalizedColor(preset.mid),
        outer: normalizedColor(preset.outer),
      };

      if (!buffer) {
        throw new Error("Unable to create WebGL buffer.");
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      let pendingWidth = 0;
      let pendingHeight = 0;
      let needsResize = false;

      // Layout reads happen only on actual size changes; the render loop
      // consumes the cached size so it never forces synchronous layout.
      function measure() {
        const rect = canvas.getBoundingClientRect();
        pendingWidth = rect.width;
        pendingHeight = rect.height;
        needsResize = true;
      }

      function applyResize() {
        if (!needsResize) {
          return;
        }
        needsResize = false;

        const ratio = Math.min(window.devicePixelRatio || 1, preset.quality.ratio);
        const width = Math.max(1, Math.floor(pendingWidth * ratio));
        const height = Math.max(1, Math.floor(pendingHeight * ratio));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      }

      function render(now) {
        frame = 0;
        applyResize();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(uniforms.time, ((now - startTime) / 1000) * preset.speed);
        gl.uniform1f(uniforms.intensity, preset.intensity);
        gl.uniform1f(uniforms.top, preset.top);
        gl.uniform1f(uniforms.volatility, preset.volatility);
        gl.uniform1f(uniforms.flash, preset.flash);
        gl.uniform1f(uniforms.sparks, preset.sparks);
        gl.uniform1f(uniforms.accentMix, preset.accentMix);
        gl.uniform3fv(uniforms.core, colors.core);
        gl.uniform3fv(uniforms.mid, colors.mid);
        gl.uniform3fv(uniforms.outer, colors.outer);
        gl.uniform3fv(uniforms.accent, colors.accent);
        gl.uniform3fv(uniforms.accent2, colors.accent2);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!reportedReady) {
          reportedReady = true;
          onReady(true);
        }

        scheduleNext();
      }

      // Only paint when the flame can actually be seen: reduced-motion off,
      // page visible, and the canvas intersecting the viewport. Terminal focus
      // can move through native/input surfaces without hiding the page, so it
      // should not pause the flame.
      function shouldRender() {
        return (
          !reduceMotion
          && document.visibilityState !== "hidden"
          && isIntersecting
        );
      }

      // Throttle the loop to TARGET_FPS via setTimeout -> rAF so the CPU
      // actually sleeps between frames instead of waking on every vsync.
      function scheduleNext() {
        if (frame || frameTimer || !shouldRender()) {
          return;
        }
        frameTimer = window.setTimeout(() => {
          frameTimer = 0;
          frame = window.requestAnimationFrame(render);
        }, FRAME_INTERVAL_MS);
      }

      function startRendering() {
        if (frame || frameTimer || !shouldRender()) {
          return;
        }
        frame = window.requestAnimationFrame(render);
      }

      function stopRendering() {
        if (frame) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
        if (frameTimer) {
          window.clearTimeout(frameTimer);
          frameTimer = 0;
        }
      }

      function handleVisibilityChange() {
        if (document.visibilityState === "hidden") {
          stopRendering();
        } else if (reportedReady) {
          startRendering();
        } else {
          render(performance.now());
        }
      }

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1]?.contentRect;
          if (rect) {
            pendingWidth = rect.width;
            pendingHeight = rect.height;
            needsResize = true;
          }
        });
        resizeObserver.observe(canvas);
      } else {
        window.addEventListener("resize", measure);
      }
      if (typeof IntersectionObserver !== "undefined") {
        intersectionObserver = new IntersectionObserver((entries) => {
          const entry = entries[entries.length - 1];
          const nextVisible = entry ? entry.isIntersecting : true;
          if (nextVisible === isIntersecting) {
            return;
          }
          isIntersecting = nextVisible;
          if (!isIntersecting) {
            stopRendering();
          } else if (reportedReady) {
            startRendering();
          }
        });
        intersectionObserver.observe(canvas);
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
      measure();

      if (document.visibilityState !== "hidden") {
        render(startTime);
      }

      return () => {
        stopRendering();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        if (intersectionObserver) {
          intersectionObserver.disconnect();
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener("resize", measure);
        }
        if (buffer) {
          gl.deleteBuffer(buffer);
        }
        gl.deleteProgram(program);
      };
    } catch {
      onReady(false);
      return undefined;
    }
  }, [active, onReady, planKey, preset]);

  return <FlameCanvas ref={canvasRef} />;
}

export function PlanFlame({ active = true, plan, showControls = false }) {
  const planKey = normalizePlanFlameKey(plan);
  const [previewPlan, setPreviewPlan] = useState(planKey);
  const [shaderReady, setShaderReady] = useState(false);
  const [flameMounted, setFlameMounted] = useState(false);
  const [flameVisible, setFlameVisible] = useState(false);
  const [animationEnabled, setAnimationEnabled] = useState(readPlanFlameAnimationEnabled);
  const [pageVisible, setPageVisible] = useState(() => (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  ));

  useEffect(() => {
    setPreviewPlan(planKey);
  }, [planKey]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const activePlan = normalizePlanFlameKey(previewPlan, planKey);
  const preset = PLAN_FLAME_PRESETS[activePlan];
  const flameActive = Boolean(active && pageVisible && preset);
  const fireVisible = Boolean(flameVisible && animationEnabled);
  const animationToggleLabel = animationEnabled
    ? "Hide fire animation"
    : "Show fire animation";
  const flameVars = preset ? {
    "--flame-glow": preset.glow,
    "--flame-h": `${preset.height}px`,
    "--flame-heat": preset.heat,
  } : {};

  function toggleAnimationEnabled() {
    setAnimationEnabled((current) => {
      const next = !current;
      rememberPlanFlameAnimationEnabled(next);
      return next;
    });
  }

  useEffect(() => {
    if (!animationEnabled) {
      setShaderReady(false);
    }
  }, [animationEnabled]);

  useEffect(() => {
    let revealTimer = 0;
    let frame = 0;

    if (!flameActive) {
      setFlameVisible(false);
      setFlameMounted(false);
      setShaderReady(false);
      return undefined;
    }

    setFlameVisible(false);
    setFlameMounted(false);
    setShaderReady(false);
    revealTimer = window.setTimeout(() => {
      setFlameMounted(true);
      frame = window.requestAnimationFrame(() => {
        setFlameVisible(true);
      });
    }, PLAN_FLAME_REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(revealTimer);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [activePlan, flameActive]);

  if (!preset) return null;
  if (!flameMounted) return null;

  return (
    <>
      <FlameStage
        aria-hidden="true"
        data-plan={activePlan}
        data-ready={shaderReady ? "true" : "false"}
        data-visible={fireVisible ? "true" : "false"}
        style={flameVars}
      >
        <FlameBackdrop />
        {animationEnabled && (
          <FlameShaderCanvas
            active={fireVisible}
            key={activePlan}
            onReady={setShaderReady}
            planKey={activePlan}
            preset={preset}
          />
        )}
        <FlameFallback
          data-animated={animationEnabled ? "true" : "false"}
          data-ready={shaderReady ? "true" : "false"}
        />
      </FlameStage>
      {showControls && (
        <FlameControls data-visible={flameVisible ? "true" : "false"} style={flameVars}>
          <FlameAnimationToggle
            aria-checked={animationEnabled}
            aria-label={animationToggleLabel}
            onClick={toggleAnimationEnabled}
            role="switch"
            title={animationToggleLabel}
            type="button"
          />
          {animationEnabled && (
            <FlameSwitch aria-label="Switch fire plan preview">
              {PLAN_FLAME_OPTIONS.map((option) => (
                <FlameSwitchButton
                  aria-label={`Preview ${option.label} fire`}
                  data-active={activePlan === option.key}
                  key={option.key}
                  onClick={() => setPreviewPlan(option.key)}
                  title={`${option.label} fire`}
                  type="button"
                >
                  {option.label}
                </FlameSwitchButton>
              ))}
            </FlameSwitch>
          )}
        </FlameControls>
      )}
    </>
  );
}

const fallbackFlicker = keyframes`
  0%, 100% {
    opacity: 0.84;
    transform: translate3d(0, 2px, 0) scaleY(0.98);
  }

  50% {
    opacity: 1;
    transform: translate3d(0, -3px, 0) scaleY(1.04);
  }
`;

const FlameStage = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: 0;
  pointer-events: none;
  isolation: isolate;
  overflow: hidden;
  opacity: 0;
  transform: translate3d(0, 24px, 0);
  transition:
    height 1.35s ease,
    opacity 1.35s ease,
    transform 1.35s ease;
  will-change: height, opacity, transform;

  &[data-visible="true"] {
    height: min(48vh, var(--flame-h));
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }

  &::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 42%;
    background:
      linear-gradient(0deg, var(--flame-glow), transparent 82%),
      linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
    filter: blur(16px);
    opacity: 0.5;
    mix-blend-mode: screen;
  }

  @media (prefers-reduced-motion: reduce) {
    &,
    * {
      animation: none !important;
    }
  }
`;

const FlameBackdrop = styled.div`
  position: absolute;
  inset: auto 0 0;
  height: 36%;
  background:
    radial-gradient(ellipse at 50% 100%, var(--flame-glow), transparent 68%),
    linear-gradient(0deg, rgba(255, 255, 255, 0.06), transparent 72%);
  opacity: 0.42;
  mix-blend-mode: screen;
`;

const FlameCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0.98;
  mix-blend-mode: screen;

  html[data-forge-theme="light"] & {
    mix-blend-mode: normal;
  }
`;

const FlameFallback = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse at 50% 100%, rgba(255, 255, 255, 0.86) 0%, transparent 20%),
    linear-gradient(0deg, var(--flame-heat) 0%, var(--flame-glow) 44%, transparent 86%);
  filter: blur(12px);
  opacity: 0.62;
  transform-origin: 50% 100%;
  animation: ${fallbackFlicker} 1.4s ease-in-out infinite;
  mix-blend-mode: screen;

  &[data-ready="true"] {
    opacity: 0.08;
    /* The WebGL flame is up; stop compositing the fallback flicker forever. */
    animation: none;
  }

  &[data-animated="false"] {
    animation: none;
  }
`;

const FlameControls = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  height: 82px;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition:
    opacity 0.2s ease,
    visibility 0.2s step-end;

  &[data-visible="true"] {
    opacity: 1;
    visibility: visible;
    transition:
      opacity 0.2s ease,
      visibility 0ms step-start;
  }
`;

const FlameAnimationToggle = styled.button`
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 1;
  display: inline-flex;
  width: 48px;
  height: 26px;
  align-items: center;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--flame-heat) 58%, rgba(255, 255, 255, 0.16));
  border-radius: 999px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--flame-heat) 34%, transparent), transparent 76%),
    rgba(8, 5, 2, 0.58);
  box-shadow:
    0 0 18px color-mix(in srgb, var(--flame-heat) 34%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.16);
  cursor: pointer;
  opacity: 0.74;
  pointer-events: auto;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease;

  &::before {
    content: "";
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--flame-heat) 76%, #ffffff);
    box-shadow:
      0 0 16px color-mix(in srgb, var(--flame-heat) 72%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.44);
    transform: translateX(20px);
    transition:
      background 0.16s ease,
      box-shadow 0.16s ease,
      transform 0.16s ease;
  }

  &[aria-checked="false"] {
    border-color: color-mix(in srgb, var(--flame-heat) 48%, rgba(0, 0, 0, 0.34));
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--flame-heat) 24%, transparent), transparent 82%),
      rgba(8, 5, 2, 0.68);
    opacity: 0.68;
  }

  &[aria-checked="false"]::before {
    background: color-mix(in srgb, var(--flame-heat) 46%, rgba(10, 7, 3, 0.9));
    box-shadow:
      0 0 10px color-mix(in srgb, var(--flame-heat) 38%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.16);
    transform: translateX(0);
  }

  &:hover,
  &:focus-visible {
    border-color: color-mix(in srgb, var(--flame-heat) 78%, rgba(255, 255, 255, 0.2));
    box-shadow:
      0 0 24px color-mix(in srgb, var(--flame-heat) 48%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);
    opacity: 0.96;
  }

  &:focus-visible {
    outline: 2px solid var(--flame-heat);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--flame-heat) 28%, transparent), transparent 76%),
      rgba(255, 255, 255, 0.72);
  }

  @media (max-width: 620px) {
    left: 12px;
    bottom: 12px;
  }
`;

const FlameSwitch = styled.div`
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 3;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(46px, 1fr);
  gap: 3px;
  max-width: calc(100% - 36px);
  padding: 4px;
  border: 1px solid rgba(232, 238, 248, 0.16);
  border-radius: 8px;
  background: rgba(2, 4, 8, 0.72);
  box-shadow:
    0 12px 36px rgba(0, 0, 0, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: auto;
  backdrop-filter: blur(14px);

  html[data-forge-theme="light"] & {
    border-color: var(--forge-border);
    background: rgba(255, 255, 255, 0.78);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  }

  @media (max-width: 620px) {
    right: 12px;
    bottom: 12px;
    left: 74px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-flow: row;
  }
`;

const FlameSwitchButton = styled.button`
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  color: rgba(232, 238, 248, 0.72);
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;

  &[data-active="true"] {
    color: #ffffff;
    background: color-mix(in srgb, var(--flame-heat) 28%, rgba(255, 255, 255, 0.1));
    box-shadow:
      0 0 22px color-mix(in srgb, var(--flame-heat) 46%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  &:focus-visible {
    outline: 2px solid var(--flame-heat);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:hover {
    color: var(--forge-text);
  }
`;
