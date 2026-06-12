import { useEffect, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

export const PLAN_FLAME_OPTIONS = [
  { key: "free", label: "Free" },
  { key: "plus", label: "Plus" },
  { key: "pro", label: "Pro" },
  { key: "ultra", label: "Ultra" },
];

const PLAN_FLAME_KEYS = new Set(PLAN_FLAME_OPTIONS.map((option) => option.key));

const PLAN_FLAME_PRESETS = {
  free: {
    height: 178,
    core: [1, 0.88, 0.78],
    mid: [1, 0.29, 0.25],
    outer: [0.52, 0.04, 0.02],
    accent: [1, 0.56, 0.21],
    glow: "rgba(255, 73, 63, 0.42)",
    heat: "#ff493f",
    intensity: 0.76,
    speed: 1.24,
    top: 0.58,
    volatility: 0.96,
    flash: 0.84,
  },
  plus: {
    height: 220,
    core: [1, 0.98, 0.76],
    mid: [1, 0.76, 0.28],
    outer: [0.82, 0.23, 0.06],
    accent: [1, 0.56, 0.12],
    glow: "rgba(255, 194, 71, 0.46)",
    heat: "#ffc247",
    intensity: 0.88,
    speed: 1.08,
    top: 0.64,
    volatility: 1.05,
    flash: 0.98,
  },
  pro: {
    height: 258,
    core: [1, 1, 1],
    mid: [0.89, 0.94, 0.99],
    outer: [0.32, 0.56, 0.84],
    accent: [0.47, 0.77, 1],
    glow: "rgba(198, 220, 246, 0.42)",
    heat: "#f4fbff",
    intensity: 0.94,
    speed: 0.98,
    top: 0.69,
    volatility: 1.11,
    flash: 1.04,
  },
  ultra: {
    height: 310,
    core: [0.9, 0.96, 1],
    mid: [0.33, 0.66, 0.98],
    outer: [0.55, 0.2, 0.94],
    accent: [0.09, 0.78, 1],
    glow: "rgba(126, 88, 250, 0.5)",
    heat: "#8d6bff",
    intensity: 1,
    speed: 0.88,
    top: 0.75,
    volatility: 1.24,
    flash: 1.14,
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

const FRAGMENT_SHADER_SOURCE = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_intensity;
  uniform float u_top;
  uniform float u_volatility;
  uniform float u_flash;
  uniform vec3 u_core;
  uniform vec3 u_mid;
  uniform vec3 u_outer;
  uniform vec3 u_accent;

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

    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = warp * p + 17.71;
      amplitude *= 0.52;
    }

    return value;
  }

  void main() {
    vec2 uv = v_uv;
    float x = uv.x;
    float y = uv.y;
    float t = u_time;

    float wind = sin(t * 0.74 + y * 8.0) * 0.028
      + sin(t * 1.63 + y * 18.0) * 0.012;
    vec2 wideField = vec2(x * 2.18 + wind, y * 2.75 - t * 0.78);
    float wide = fbm(wideField + vec2(fbm(wideField * 1.72 + t * 0.13), -t * 0.24));
    float middle = fbm(vec2(x * 5.4 + wide * 1.26 + t * 0.05, y * 5.85 - t * 1.55));
    float fine = fbm(vec2(x * 15.0 + middle * 2.4 - t * 0.18, y * 13.4 - t * 2.9));

    float crownNoise = fbm(vec2(x * 3.55 + t * 0.11, t * 0.42)) * 0.18
      + fbm(vec2(x * 12.0 - t * 0.2, t * 0.73)) * 0.08;
    float crownTop = u_top + crownNoise * u_volatility;
    float crown = 1.0 - smoothstep(
      crownTop - 0.2,
      crownTop + 0.16,
      y + (0.5 - middle) * 0.18 * u_volatility
    );

    float baseHeat = pow(max(0.0, 1.0 - y), 1.28);
    float turbulence = wide * 0.52 + middle * 0.34 + fine * 0.18;
    float body = baseHeat + turbulence * 0.62 * u_volatility - y * 0.26;
    float fire = smoothstep(0.42, 1.02, body) * crown;

    float bottomFlashWave = sin(t * 4.8 + x * 13.0 + wide * 5.5) * 0.5 + 0.5;
    float bottomFlash = (1.0 - smoothstep(0.0, 0.18, y))
      * (0.45 + 0.55 * bottomFlashWave)
      * u_flash;
    float glow = (1.0 - smoothstep(0.02, crownTop + 0.3, y))
      * smoothstep(0.0, 0.25, fire + baseHeat * 0.7);

    float core = smoothstep(0.63, 1.16, fire + (0.17 - y) * 1.9 + fine * 0.14);
    float whiteCore = smoothstep(0.82, 1.22, fire + (0.09 - y) * 2.2);
    float accentField = smoothstep(0.34, 0.78, wide)
      * (1.0 - smoothstep(0.48, 0.9, y))
      * 0.25;

    vec3 color = mix(u_outer, u_mid, clamp(fire * 1.25 + bottomFlash * 0.18, 0.0, 1.0));
    color = mix(color, u_accent, accentField);
    color = mix(color, u_core, core);
    color = mix(color, vec3(1.0), whiteCore * 0.55);

    float topFade = 1.0 - smoothstep(0.58, 0.96, y);
    float alpha = clamp((fire * 0.92 + glow * 0.36 + bottomFlash * 0.42) * u_intensity, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha * topFade);
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

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
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

export function normalizePlanFlameKey(plan, fallback = "") {
  const key = String(plan || "").trim().toLowerCase();
  return PLAN_FLAME_KEYS.has(key) ? key : fallback;
}

function FlameShaderCanvas({ preset, planKey, onReady }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") {
      return undefined;
    }

    onReady(false);

    let frame = 0;
    let resizeObserver = null;
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
      const program = createProgram(gl);
      const positionLocation = gl.getAttribLocation(program, "a_position");
      const uniforms = {
        accent: gl.getUniformLocation(program, "u_accent"),
        core: gl.getUniformLocation(program, "u_core"),
        flash: gl.getUniformLocation(program, "u_flash"),
        intensity: gl.getUniformLocation(program, "u_intensity"),
        mid: gl.getUniformLocation(program, "u_mid"),
        outer: gl.getUniformLocation(program, "u_outer"),
        resolution: gl.getUniformLocation(program, "u_resolution"),
        time: gl.getUniformLocation(program, "u_time"),
        top: gl.getUniformLocation(program, "u_top"),
        volatility: gl.getUniformLocation(program, "u_volatility"),
      };
      const buffer = gl.createBuffer();
      const startTime = performance.now();
      let reportedReady = false;
      const colors = {
        accent: normalizedColor(preset.accent),
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

      function resize() {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(rect.width * ratio));
        const height = Math.max(1, Math.floor(rect.height * ratio));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      }

      function render(now) {
        resize();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(uniforms.time, ((now - startTime) / 1000) * preset.speed);
        gl.uniform1f(uniforms.intensity, preset.intensity);
        gl.uniform1f(uniforms.top, preset.top);
        gl.uniform1f(uniforms.volatility, preset.volatility);
        gl.uniform1f(uniforms.flash, preset.flash);
        gl.uniform3fv(uniforms.core, colors.core);
        gl.uniform3fv(uniforms.mid, colors.mid);
        gl.uniform3fv(uniforms.outer, colors.outer);
        gl.uniform3fv(uniforms.accent, colors.accent);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!reportedReady) {
          reportedReady = true;
          onReady(true);
        }

        if (!reduceMotion) {
          frame = window.requestAnimationFrame(render);
        }
      }

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
      } else {
        window.addEventListener("resize", resize);
      }

      render(startTime);

      return () => {
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener("resize", resize);
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
  }, [onReady, planKey, preset]);

  return <FlameCanvas ref={canvasRef} />;
}

export function PlanFlame({ plan, showControls = false }) {
  const planKey = normalizePlanFlameKey(plan);
  const [previewPlan, setPreviewPlan] = useState(planKey);
  const [shaderReady, setShaderReady] = useState(false);

  useEffect(() => {
    setPreviewPlan(planKey);
  }, [planKey]);

  const activePlan = normalizePlanFlameKey(previewPlan, planKey);
  const preset = PLAN_FLAME_PRESETS[activePlan];

  if (!preset) return null;

  return (
    <FlameStage
      aria-hidden={showControls ? undefined : true}
      data-plan={activePlan}
      data-ready={shaderReady ? "true" : "false"}
      style={{
        "--flame-glow": preset.glow,
        "--flame-h": `${preset.height}px`,
        "--flame-heat": preset.heat,
      }}
    >
      <FlameBackdrop />
      <FlameShaderCanvas
        key={activePlan}
        onReady={setShaderReady}
        planKey={activePlan}
        preset={preset}
      />
      <FlameFallback data-ready={shaderReady ? "true" : "false"} />
      {showControls && (
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
    </FlameStage>
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
  height: min(38vh, var(--flame-h));
  min-height: min(26vh, var(--flame-h));
  pointer-events: none;
  isolation: isolate;

  &::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 54%;
    background:
      linear-gradient(0deg, var(--flame-glow), transparent 82%),
      linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    filter: blur(16px);
    opacity: 0.78;
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
  height: 42%;
  background:
    radial-gradient(ellipse at 50% 100%, var(--flame-glow), transparent 68%),
    linear-gradient(0deg, rgba(255, 255, 255, 0.1), transparent 72%);
  opacity: 0.72;
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
    opacity: 0.16;
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
    left: 12px;
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
