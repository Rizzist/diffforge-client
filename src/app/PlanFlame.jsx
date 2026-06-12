import styled, { keyframes } from "styled-components";

// Forge fire for the no-workspace idle surface: the user's billing plan
// rendered as a wall of flames across the entire bottom of the pane. Higher
// plans burn taller, brighter, and with more layers — Free is a low ember
// line, Ultra is a full blue/violet blaze. Built for low-end machines on
// purpose: every tongue is a blurred gradient teardrop whose blur is static
// (rasterized once) and whose motion is transform-only (compositor path, no
// per-frame JS, no canvas, no animated filters). The volatility comes from
// dozens of overlapping screen-blended tongues, each flickering on its own
// duration, phase, and sway pattern, so the wall never repeats visibly.
const PLAN_FLAME_PRESETS = {
  free: {
    height: 72,
    core: "#ffd2bd",
    mid: "#ff5a3c",
    outer: "#8f1208",
    glow: "rgba(255, 74, 38, 0.30)",
    ember: "#ff8a5c",
    intensity: 0.62,
    speed: 1.4,
    embers: 5,
    bands: { aura: 0, back: 8, front: 0, mid: 6 },
    aura: "",
  },
  plus: {
    height: 118,
    core: "#fff6d0",
    mid: "#ffb224",
    outer: "#d24a12",
    glow: "rgba(255, 170, 40, 0.38)",
    ember: "#ffc14d",
    intensity: 0.85,
    speed: 1.1,
    embers: 8,
    bands: { aura: 0, back: 9, front: 5, mid: 7 },
    aura: "",
  },
  pro: {
    height: 154,
    core: "#ffffff",
    mid: "#dde9f7",
    outer: "#6f96c7",
    glow: "rgba(198, 220, 246, 0.34)",
    ember: "#eaf3fd",
    intensity: 0.92,
    speed: 1,
    embers: 11,
    bands: { aura: 0, back: 10, front: 6, mid: 8 },
    aura: "",
  },
  ultra: {
    height: 198,
    core: "#e4f4ff",
    mid: "#55a8fa",
    outer: "#8b34f0",
    glow: "rgba(126, 88, 250, 0.44)",
    ember: "#c4b5fd",
    intensity: 1,
    speed: 0.85,
    embers: 14,
    bands: { aura: 4, back: 10, front: 7, mid: 8 },
    aura: "#7c3aed",
  },
};

// Deterministic per-tongue jitter (position, size, tempo, phase, sway
// pattern) from index math — no Math.random, so renders are stable and the
// wall still reads as chaotic because no two tongues share a cycle.
function flameTongueSlots(count, salt) {
  return Array.from({ length: count }, (_, index) => ({
    delay: -(((index * 41 + salt * 23) % 170) / 100),
    duration: 1 + (((index * 53 + salt * 17) % 90) / 100),
    left: ((index + 0.5) / count) * 100 + (((index * 37 + salt * 13) % 11) - 5),
    scale: 0.62 + (((index * 29 + salt * 7) % 41) / 100),
    sway: (index + salt) % 3,
  }));
}

const PLAN_FLAME_EMBER_SLOTS = Array.from({ length: 14 }, (_, index) => ({
  delay: ((index * 0.47) % 2.7).toFixed(2),
  drift: ((index % 5) - 2) * 11,
  duration: (2.2 + ((index * 0.83) % 1.9)).toFixed(2),
  left: 2 + ((index * 83) % 96),
  size: 2 + (index % 2),
}));

const FLAME_BAND_SALTS = { aura: 5, back: 1, front: 3, mid: 2 };
const FLAME_BAND_TEMPO = { aura: 2.4, back: 1.7, front: 0.95, mid: 1.25 };

function FlameBand({ band, count }) {
  if (!count) return null;
  return flameTongueSlots(count, FLAME_BAND_SALTS[band]).map((slot) => (
    <FlameShell
      data-band={band}
      data-sway={slot.sway}
      key={`${band}-${slot.left.toFixed(1)}`}
      style={{
        "--sway-delay": `${slot.delay.toFixed(2)}s`,
        "--sway-duration": `${(slot.duration * FLAME_BAND_TEMPO[band]).toFixed(2)}s`,
        "--tongue-scale": slot.scale.toFixed(2),
        left: `${slot.left.toFixed(1)}%`,
      }}
    >
      <FlameTongue data-band={band} />
    </FlameShell>
  ));
}

export function PlanFlame({ plan }) {
  const planKey = String(plan || "").trim().toLowerCase();
  const preset = PLAN_FLAME_PRESETS[planKey];
  if (!preset) return null;

  return (
    <FlameStage
      aria-hidden="true"
      data-plan={planKey}
      style={{
        "--flame-h": `${preset.height}px`,
        "--flame-core": preset.core,
        "--flame-mid": preset.mid,
        "--flame-outer": preset.outer,
        "--flame-glow": preset.glow,
        "--flame-ember": preset.ember,
        "--flame-aura": preset.aura || preset.outer,
        "--flame-intensity": preset.intensity,
        "--flame-speed": preset.speed,
      }}
    >
      <FlameBedGlow />
      <FlameBand band="aura" count={preset.bands.aura} />
      <FlameBand band="back" count={preset.bands.back} />
      <FlameBand band="mid" count={preset.bands.mid} />
      <FlameBand band="front" count={preset.bands.front} />
      <FlameEmberField>
        {PLAN_FLAME_EMBER_SLOTS.slice(0, preset.embers).map((ember) => (
          <i
            key={`${ember.left}-${ember.delay}`}
            style={{
              "--ember-delay": `${ember.delay}s`,
              "--ember-drift": `${ember.drift}px`,
              "--ember-duration": `${ember.duration}s`,
              left: `${ember.left}%`,
              width: `${ember.size}px`,
              height: `${ember.size}px`,
            }}
          />
        ))}
      </FlameEmberField>
    </FlameStage>
  );
}

// Three sway patterns spread across the tongues so neighbours never move
// alike: a breathing flicker, a wind-blown lean, and a spiking lick. All
// transform-only (scale/skew/translate around the flame base).
const flameSwayBreathe = keyframes`
  0%, 100% { transform: translateX(-50%) scale(1, 1) skewX(0.001deg); }
  30% { transform: translateX(-50.6%) scale(0.96, 1.07) skewX(-2deg); }
  55% { transform: translateX(-49.5%) scale(1.04, 0.92) skewX(1.6deg); }
  78% { transform: translateX(-50.3%) scale(0.98, 1.05) skewX(-1.2deg); }
`;

const flameSwayLean = keyframes`
  0%, 100% { transform: translateX(-50%) scale(1, 1) skewX(0.001deg); }
  22% { transform: translateX(-49.2%) scale(1.02, 0.97) skewX(3deg); }
  48% { transform: translateX(-50.9%) scale(0.95, 1.1) skewX(-2.6deg); }
  74% { transform: translateX(-49.6%) scale(1.03, 0.95) skewX(1.8deg); }
`;

const flameSwayLick = keyframes`
  0%, 100% { transform: translateX(-50%) scale(1, 1) skewX(0.001deg); }
  18% { transform: translateX(-50.4%) scale(0.97, 1.04) skewX(-1deg); }
  42% { transform: translateX(-50.2%) scale(0.92, 1.22) skewX(-3deg); }
  60% { transform: translateX(-49.4%) scale(1.05, 0.88) skewX(2.4deg); }
  85% { transform: translateX(-50.6%) scale(0.98, 1.06) skewX(-1.6deg); }
`;

const flameGlowPulse = keyframes`
  0%, 100% { opacity: 0.78; }
  50% { opacity: 1; }
`;

const flameEmberRise = keyframes`
  0% { transform: translate3d(0, 0, 0); opacity: 0; }
  12% { opacity: 0.9; }
  100% { transform: translate3d(var(--ember-drift), calc(var(--flame-h) * -1.35), 0); opacity: 0; }
`;

const FlameStage = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: calc(var(--flame-h) * 1.7);
  pointer-events: none;

  @media (prefers-reduced-motion: reduce) {
    & * {
      animation: none !important;
    }
  }
`;

// Full-width coal bed the wall stands in: a hot line at the very bottom
// inside a taller soft wash.
const FlameBedGlow = styled.span`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--flame-h) * 0.6);
  background:
    linear-gradient(0deg, color-mix(in srgb, var(--flame-mid) 34%, transparent), transparent 24%),
    linear-gradient(0deg, var(--flame-glow), transparent 80%);
  opacity: calc(0.9 * var(--flame-intensity));
  animation: ${flameGlowPulse} calc(var(--flame-speed) * 3.1s) ease-in-out infinite;
`;

// One animated tongue anchored on the bed. Sizes carry the per-tongue jitter
// so the wall's silhouette is ragged instead of a repeated scallop.
const FlameShell = styled.span`
  position: absolute;
  bottom: 0;
  width: calc(var(--flame-h) * 0.52 * var(--tongue-scale));
  height: calc(var(--flame-h) * var(--tongue-scale));
  transform: translateX(-50%);
  transform-origin: 50% 100%;
  animation-duration: calc(var(--sway-duration) * var(--flame-speed));
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-delay: var(--sway-delay);
  will-change: transform;

  &[data-sway="0"] {
    animation-name: ${flameSwayBreathe};
  }

  &[data-sway="1"] {
    animation-name: ${flameSwayLean};
  }

  &[data-sway="2"] {
    animation-name: ${flameSwayLick};
  }

  &[data-band="back"] {
    width: calc(var(--flame-h) * 0.68 * var(--tongue-scale));
  }

  &[data-band="front"] {
    bottom: 2px;
    width: calc(var(--flame-h) * 0.32 * var(--tongue-scale));
    height: calc(var(--flame-h) * 0.58 * var(--tongue-scale));
  }

  &[data-band="aura"] {
    width: calc(var(--flame-h) * 0.95 * var(--tongue-scale));
    height: calc(var(--flame-h) * 1.2 * var(--tongue-scale));
  }
`;

// The teardrop itself: a square with one sharp corner rotated tip-up, then
// stretched vertically — the post-rotation stretch shears it slightly, which
// is what makes each lick read as bent by heat rather than stamped. The
// radial gradient sits on the corner that lands at the base so heat fades
// upward into the tip. Static blur per depth band; screen blending fuses
// overlapping tongues into one continuous fire on the dark surface.
const FlameTongue = styled.i`
  position: absolute;
  inset: 0;
  display: block;
  border-radius: 0 50% 50% 50%;
  transform: scaleY(1.45) rotate(-45deg);
  transform-origin: 50% 100%;
  mix-blend-mode: screen;

  html[data-forge-theme="light"] & {
    mix-blend-mode: normal;
  }

  &[data-band="back"] {
    background: radial-gradient(
      circle at 76% 76%,
      var(--flame-mid) 0%,
      var(--flame-outer) 50%,
      transparent 78%
    );
    opacity: calc(0.62 * var(--flame-intensity));
    filter: blur(12px);
  }

  &[data-band="mid"] {
    background: radial-gradient(
      circle at 76% 76%,
      var(--flame-core) 0%,
      var(--flame-mid) 54%,
      transparent 80%
    );
    opacity: calc(0.82 * var(--flame-intensity));
    filter: blur(7px);
  }

  &[data-band="front"] {
    background: radial-gradient(
      circle at 74% 74%,
      #ffffff 0%,
      var(--flame-core) 42%,
      var(--flame-mid) 68%,
      transparent 82%
    );
    opacity: calc(0.92 * var(--flame-intensity));
    filter: blur(3px);
  }

  &[data-band="aura"] {
    background: radial-gradient(
      circle at 76% 76%,
      var(--flame-aura) 0%,
      transparent 72%
    );
    opacity: calc(0.4 * var(--flame-intensity));
    filter: blur(22px);
  }
`;

const FlameEmberField = styled.span`
  position: absolute;
  right: 0;
  bottom: calc(var(--flame-h) * 0.2);
  left: 0;
  height: 1px;

  i {
    position: absolute;
    bottom: 0;
    border-radius: 999px;
    background: var(--flame-ember);
    box-shadow: 0 0 6px var(--flame-ember);
    opacity: 0;
    animation: ${flameEmberRise} var(--ember-duration) linear infinite;
    animation-delay: var(--ember-delay);
  }
`;
