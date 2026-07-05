import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes, css } from "styled-components";
import { getRenderabilitySnapshot, subscribeToRenderability } from "./renderability.js";
import { PlanFlame } from "./PlanFlame.jsx";

/*
 * PlusUpsellOverlay — the "battle pass" tier-up shown right after sign-in,
 * BEFORE the app shell is revealed (opaque backdrop, above the startup
 * overlay). Layout rides the golden ratio: a 1.618fr cinematic showcase
 * (emblem, god rays, perk track) beside a 1fr purchase card whose glowing
 * CTA is the single hottest pixel on screen. The overlay sells all three
 * paid tiers — Plus, Pro, Ultra — with a tier switcher; every scene color
 * rides per-tier CSS variables and the pricing-page PlanFlame burns along
 * the bottom in the active tier's palette. One canvas drives all particles;
 * every DOM animation is transform/opacity; SFX are synthesized with
 * WebAudio at runtime. The quiet "keep using Free" escape lives on the left
 * edge and the overlay re-arms on every sign-in.
 */

const PERK_TRACK_STEPS = 5;

const PLAN_TIERS = [
  {
    key: "plus",
    label: "Plus",
    word: "PLUS",
    heat: "Gold flame pass",
    passName: "Gold Flame",
    badge: "Best value",
    art: "/pricing/forge-plus-gold.webp",
    price: "$60",
    credits: 10000,
    pitch: (
      <>
        Three agents. One codebase. <em>Zero chaos.</em>
      </>
    ),
    track: [
      { glyph: "▣", title: "Native app", sub: "Mac · Win · Linux" },
      { glyph: "◆", title: "10k credits", sub: "every month" },
      { glyph: "⌁", title: "4 devices", sub: "personal sync" },
      { glyph: "▤", title: "10 GB storage", sub: "SQLite + assets" },
      { glyph: "★", title: "Priority", sub: "support lane" },
    ],
    stamps: [
      "Native desktop license",
      "Up to 4 synced devices",
      "10 GB workspace storage",
      "Priority support lane",
    ],
    cta: "Upgrade to Plus",
    theme: {
      cream: "255, 236, 189",
      light: "255, 214, 138",
      mid: "255, 190, 92",
      hot: "255, 176, 66",
      core: "232, 144, 28",
      deep: "185, 120, 24",
      accent: "#ffd166",
      ink: "#2a1602",
      price: "#fff6df",
      floor: "120, 58, 8",
      corner: "96, 62, 12",
      baseBottom: "#0a0602",
      ember: [[255, 236, 189], [255, 186, 84], [255, 122, 24]],
    },
  },
  {
    key: "pro",
    label: "Pro",
    word: "PRO",
    heat: "Platinum flame pass",
    passName: "Platinum Flame",
    badge: "Most popular",
    art: "/pricing/forge-pro-platinum.webp",
    price: "$400",
    credits: 30000,
    pitch: (
      <>
        Fifteen devices. One forge. <em>Platinum heat.</em>
      </>
    ),
    track: [
      { glyph: "▣", title: "Native app", sub: "Mac · Win · Linux" },
      { glyph: "◆", title: "30k credits", sub: "every month" },
      { glyph: "⌁", title: "15 devices", sub: "workstation mix" },
      { glyph: "▤", title: "50 GB storage", sub: "SQLite + assets" },
      { glyph: "✦", title: "1 team", sub: "dedicated · soon" },
    ],
    stamps: [
      "Native desktop license",
      "Up to 15 synced devices",
      "50 GB workspace storage",
      "1 dedicated team · coming soon",
    ],
    cta: "Upgrade to Pro",
    theme: {
      cream: "240, 247, 255",
      light: "205, 227, 250",
      mid: "148, 197, 244",
      hot: "108, 168, 238",
      core: "66, 128, 216",
      deep: "42, 94, 170",
      accent: "#cfe6ff",
      ink: "#08182e",
      price: "#f3faff",
      floor: "10, 44, 96",
      corner: "16, 50, 96",
      baseBottom: "#020610",
      ember: [[236, 246, 255], [148, 203, 255], [36, 108, 255]],
    },
  },
  {
    key: "ultra",
    label: "Ultra",
    word: "ULTRA",
    heat: "Ultra flame pass",
    passName: "Ultra Flame",
    badge: "Max heat",
    art: "/pricing/forge-ultra-violet.webp",
    price: "$2,000",
    credits: 100000,
    pitch: (
      <>
        One hundred thousand credits. <em>Zero limits.</em>
      </>
    ),
    track: [
      { glyph: "▣", title: "Native app", sub: "Mac · Win · Linux" },
      { glyph: "◆", title: "100k credits", sub: "every month" },
      { glyph: "⌁", title: "50 devices", sub: "lab scale" },
      { glyph: "▤", title: "250 GB storage", sub: "SQLite + assets" },
      { glyph: "✦", title: "3 teams", sub: "dedicated · soon" },
    ],
    stamps: [
      "Native desktop license",
      "Up to 50 synced devices",
      "250 GB workspace storage",
      "3 dedicated teams · coming soon",
    ],
    cta: "Upgrade to Ultra",
    theme: {
      cream: "233, 224, 255",
      light: "199, 178, 255",
      mid: "158, 118, 255",
      hot: "132, 88, 250",
      core: "104, 58, 232",
      deep: "74, 40, 164",
      accent: "#c4b5fd",
      ink: "#1c0836",
      price: "#f5f0ff",
      floor: "56, 18, 110",
      corner: "60, 24, 116",
      baseBottom: "#070312",
      ember: [[240, 232, 255], [178, 130, 255], [122, 42, 255]],
    },
  },
];

/* ------------------------------------------------------------- audio */

function createSfx() {
  let ctx = null;
  const ensure = () => {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };

  const noiseBuffer = (audio, seconds) => {
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const play = (build) => {
    const audio = ensure();
    if (!audio) return;
    try {
      build(audio, audio.currentTime);
    } catch {
      // never let sfx break the overlay
    }
  };

  return {
    /* tension riser into the slam */
    riser() {
      play((audio, t0) => {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(audio, 0.62);
        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(160, t0);
        filter.frequency.exponentialRampToValueAtTime(2600, t0 + 0.52);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.48);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t0);
        src.stop(t0 + 0.64);
      });
    },
    /* airy sweep (open + purchase card slide) */
    whoosh(bright = false) {
      play((audio, t0) => {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(audio, 0.9);
        const filter = audio.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(bright ? 480 : 220, t0);
        filter.frequency.exponentialRampToValueAtTime(bright ? 3600 : 2400, t0 + 0.42);
        filter.frequency.exponentialRampToValueAtTime(bright ? 700 : 320, t0 + 0.8);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(bright ? 0.1 : 0.16, t0 + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t0);
        src.stop(t0 + 0.9);
      });
    },
    /* emblem slam: sub thump + metallic triad + spark sizzle */
    slam() {
      play((audio, t0) => {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(160, t0);
        osc.frequency.exponentialRampToValueAtTime(34, t0 + 0.28);
        const oscGain = audio.createGain();
        oscGain.gain.setValueAtTime(0.62, t0);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
        osc.connect(oscGain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + 0.4);

        [523.25, 783.99, 1046.5].forEach((freq, index) => {
          const ring = audio.createOscillator();
          ring.type = "triangle";
          ring.frequency.value = freq * 1.003;
          const ringGain = audio.createGain();
          ringGain.gain.setValueAtTime(0.0001, t0);
          ringGain.gain.exponentialRampToValueAtTime(0.075 / (index + 1), t0 + 0.012);
          ringGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75 + index * 0.13);
          ring.connect(ringGain).connect(audio.destination);
          ring.start(t0);
          ring.stop(t0 + 1);
        });

        const sizzle = audio.createBufferSource();
        sizzle.buffer = noiseBuffer(audio, 0.55);
        const sizzleFilter = audio.createBiquadFilter();
        sizzleFilter.type = "highpass";
        sizzleFilter.frequency.value = 3600;
        const sizzleGain = audio.createGain();
        sizzleGain.gain.setValueAtTime(0.14, t0 + 0.01);
        sizzleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        sizzle.connect(sizzleFilter).connect(sizzleGain).connect(audio.destination);
        sizzle.start(t0 + 0.01);
        sizzle.stop(t0 + 0.6);
      });
    },
    tick(step = 0) {
      play((audio, t0) => {
        const osc = audio.createOscillator();
        osc.type = "square";
        osc.frequency.value = 1180 + step * 90;
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + 0.1);
      });
    },
    /* soft flame lick for tier switches: warm noise swell + ember crackle +
       low glow. level 0..1 scales the body (light/low/strong per tier) —
       gentle by design so switching never feels like a punishment. */
    flameShift(level = 0.6) {
      play((audio, t0) => {
        // warm body: lowpass noise swelling up then settling back down
        const body = audio.createBufferSource();
        body.buffer = noiseBuffer(audio, 0.55);
        const bodyFilter = audio.createBiquadFilter();
        bodyFilter.type = "lowpass";
        bodyFilter.Q.value = 0.7;
        bodyFilter.frequency.setValueAtTime(240, t0);
        bodyFilter.frequency.exponentialRampToValueAtTime(900 + level * 900, t0 + 0.16);
        bodyFilter.frequency.exponentialRampToValueAtTime(260, t0 + 0.5);
        const bodyGain = audio.createGain();
        bodyGain.gain.setValueAtTime(0.0001, t0);
        bodyGain.gain.exponentialRampToValueAtTime(0.05 + level * 0.05, t0 + 0.09);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52);
        body.connect(bodyFilter).connect(bodyGain).connect(audio.destination);
        body.start(t0);
        body.stop(t0 + 0.55);

        // ember crackle: a few tiny bandpass pops scattered across the lick
        const crackles = 3 + Math.round(level * 3);
        for (let i = 0; i < crackles; i += 1) {
          const at = t0 + 0.05 + Math.random() * 0.3;
          const pop = audio.createBufferSource();
          pop.buffer = noiseBuffer(audio, 0.05);
          const popFilter = audio.createBiquadFilter();
          popFilter.type = "bandpass";
          popFilter.Q.value = 3.2;
          popFilter.frequency.value = 1600 + Math.random() * 2600;
          const popGain = audio.createGain();
          popGain.gain.setValueAtTime(0.0001, at);
          popGain.gain.exponentialRampToValueAtTime(0.02 + level * 0.025, at + 0.006);
          popGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
          pop.connect(popFilter).connect(popGain).connect(audio.destination);
          pop.start(at);
          pop.stop(at + 0.06);
        }

        // low warm glow underneath, a touch stronger for hotter tiers
        const glow = audio.createOscillator();
        glow.type = "sine";
        glow.frequency.setValueAtTime(120, t0);
        glow.frequency.exponentialRampToValueAtTime(58, t0 + 0.4);
        const glowGain = audio.createGain();
        glowGain.gain.setValueAtTime(0.0001, t0);
        glowGain.gain.exponentialRampToValueAtTime(0.02 + level * 0.05, t0 + 0.08);
        glowGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
        glow.connect(glowGain).connect(audio.destination);
        glow.start(t0);
        glow.stop(t0 + 0.5);
      });
    },
    flare() {
      play((audio, t0) => {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(audio, 0.35);
        const filter = audio.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 1.4;
        filter.frequency.setValueAtTime(900, t0);
        filter.frequency.exponentialRampToValueAtTime(3600, t0 + 0.22);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t0);
        src.stop(t0 + 0.36);
      });
    },
    stinger() {
      play((audio, t0) => {
        [392, 587.33, 783.99].forEach((freq, index) => {
          const osc = audio.createOscillator();
          osc.type = "triangle";
          osc.frequency.value = freq;
          const gain = audio.createGain();
          const at = t0 + index * 0.07;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
          osc.connect(gain).connect(audio.destination);
          osc.start(at);
          osc.stop(at + 0.65);
        });
      });
    },
    dismiss() {
      play((audio, t0) => {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(audio, 0.3);
        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1400, t0);
        filter.frequency.exponentialRampToValueAtTime(220, t0 + 0.26);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.08, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t0);
        src.stop(t0 + 0.32);
      });
    },
    /* pre-warm/resume the context on a user gesture (autoplay policies) */
    unlock() {
      ensure();
    },
    close() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}

/* ---------------------------------------------------------- particles */

function createEmberEngine(canvas, prefersReducedMotion) {
  const context = canvas.getContext("2d");
  if (!context || prefersReducedMotion) {
    return {
      burst: () => {},
      ringBurst: () => {},
      setCtaRect: () => {},
      setPalette: () => {},
      destroy: () => {},
    };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sprite = document.createElement("canvas");
  sprite.width = 32;
  sprite.height = 32;
  const spriteCtx = sprite.getContext("2d");
  const paintSprite = (palette) => {
    spriteCtx.clearRect(0, 0, 32, 32);
    const spriteGradient = spriteCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    spriteGradient.addColorStop(0, `rgba(${palette[0].join(", ")}, 1)`);
    spriteGradient.addColorStop(0.35, `rgba(${palette[1].join(", ")}, 0.85)`);
    spriteGradient.addColorStop(1, `rgba(${palette[2].join(", ")}, 0)`);
    spriteCtx.fillStyle = spriteGradient;
    spriteCtx.fillRect(0, 0, 32, 32);
  };
  paintSprite(PLAN_TIERS[0].theme.ember);

  const MAX_PARTICLES = 170;
  const particles = [];
  let ctaRect = null;
  let ctaRate = 0;
  let width = 0;
  let height = 0;
  let raf = 0;
  let last = performance.now();
  let destroyed = false;
  let renderable = getRenderabilitySnapshot().renderable;

  const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  const spawn = (particle) => {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(particle);
  };

  const spawnAmbient = () => {
    spawn({
      x: Math.random() * width,
      y: height + 12,
      vx: (Math.random() - 0.5) * 14,
      vy: -(26 + Math.random() * 44),
      life: 0,
      ttl: 5 + Math.random() * 4,
      size: 2.5 + Math.random() * 5,
      wobble: Math.random() * Math.PI * 2,
      kind: "ember",
    });
  };

  const spawnCta = () => {
    if (!ctaRect) return;
    spawn({
      x: ctaRect.x + Math.random() * ctaRect.width,
      y: ctaRect.y + ctaRect.height * 0.35,
      vx: (Math.random() - 0.5) * 26,
      vy: -(40 + Math.random() * 70),
      life: 0,
      ttl: 0.9 + Math.random() * 0.9,
      size: 1.8 + Math.random() * 3.4,
      wobble: Math.random() * Math.PI * 2,
      kind: "cta",
    });
  };

  let ambientAccumulator = 0;
  let ctaAccumulator = 0;
  // Full cinematic ember density for the intro, then wind down the ambient
  // field so an overlay left open doesn't keep burning a full-screen canvas
  // at showtime rates. CTA embers (hover-driven) are unaffected.
  const createdAt = performance.now();
  const AMBIENT_WIND_DOWN_MS = 45_000;
  const ambientRate = (now) => (now - createdAt < AMBIENT_WIND_DOWN_MS ? 8 : 2);

  const stopFrame = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const requestFrame = () => {
    if (!destroyed && renderable && !raf) {
      raf = requestAnimationFrame(step);
    }
  };

  const step = (now) => {
    if (destroyed) return;
    raf = 0;
    if (!renderable) {
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    ambientAccumulator += dt * ambientRate(now);
    while (ambientAccumulator >= 1) {
      ambientAccumulator -= 1;
      spawnAmbient();
    }
    ctaAccumulator += dt * ctaRate;
    while (ctaAccumulator >= 1) {
      ctaAccumulator -= 1;
      spawnCta();
    }

    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.ttl) {
        particles.splice(i, 1);
        continue;
      }
      p.wobble += dt * 2.2;
      p.x += (p.vx + Math.sin(p.wobble) * 9) * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") {
        p.vy += 150 * dt;
        p.vx *= 1 - 0.9 * dt;
      }
      const t = p.life / p.ttl;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      const size = p.size * (p.kind === "spark" ? 1 - t * 0.5 : 1);
      context.globalAlpha = Math.max(0, fade) * (p.kind === "cta" ? 0.9 : 0.7);
      context.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    requestFrame();
  };
  const unsubscribeRenderability = subscribeToRenderability((nextSnapshot) => {
    renderable = nextSnapshot.renderable;
    if (renderable) {
      last = performance.now();
      requestFrame();
    } else {
      stopFrame();
    }
  });
  requestFrame();

  return {
    burst(x, y, count = 42) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 240;
        spawn({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60,
          life: 0,
          ttl: 0.5 + Math.random() * 0.8,
          size: 1.6 + Math.random() * 3,
          wobble: Math.random() * Math.PI * 2,
          kind: "spark",
        });
      }
    },
    /* sparks that ride the shockwave ring outward */
    ringBurst(x, y, count = 26, radius = 96) {
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.2;
        const speed = 150 + Math.random() * 110;
        spawn({
          x: x + Math.cos(angle) * radius * 0.4,
          y: y + Math.sin(angle) * radius * 0.4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.72,
          life: 0,
          ttl: 0.6 + Math.random() * 0.5,
          size: 1.4 + Math.random() * 2.4,
          wobble: Math.random() * Math.PI * 2,
          kind: "spark",
        });
      }
    },
    setCtaRect(rect, rate = 10) {
      ctaRect = rect;
      ctaRate = rate;
    },
    /* retint the shared ember sprite to the active tier's palette */
    setPalette(palette) {
      if (Array.isArray(palette) && palette.length === 3) paintSprite(palette);
    },
    destroy() {
      destroyed = true;
      stopFrame();
      unsubscribeRenderability();
      window.removeEventListener("resize", onResize);
    },
  };
}

/* ---------------------------------------------------------- component */

// memo: App re-renders constantly on connection/activity events; with stable
// handler props from AppShell this keeps the overlay subtree (1,200+ fibers of
// styled-components) out of every App commit.
export const PlusUpsellOverlay = memo(function PlusUpsellOverlay({
  onDismiss,
  onUpgrade,
  onTitleBarMouseDown,
  windowPlatform,
  isWindowFrameExpanded,
}) {
  // 0 open · 1 emblem slam · 2 perk track · 3 purchase card armed
  const [phase, setPhase] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // sound is ON by default every time the overlay shows; mute is session-only
  const [muted, setMuted] = useState(false);
  const [creditCount, setCreditCount] = useState(0);
  const [tilesLanded, setTilesLanded] = useState(0);
  const [runId, setRunId] = useState(0);
  const [planIndex, setPlanIndex] = useState(0);
  const [switchDir, setSwitchDir] = useState("");

  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const emblemRef = useRef(null);
  const ctaRef = useRef(null);
  const scrollerRef = useRef(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const planIndexRef = useRef(planIndex);
  planIndexRef.current = planIndex;

  const activeTier = PLAN_TIERS[planIndex];
  const theme = activeTier.theme;

  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const sfx = useMemo(() => createSfx(), []);
  const sound = useCallback((name, ...args) => {
    if (!mutedRef.current) sfx[name](...args);
  }, [sfx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = createEmberEngine(canvas, prefersReducedMotion);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      sfx.close();
    };
  }, [prefersReducedMotion, sfx]);

  // WebAudio contexts can start suspended until a user gesture — unlock on
  // the first interaction so the timeline sounds are never silently eaten.
  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [sfx]);

  const emblemCanvasPoint = useCallback(() => {
    const emblem = emblemRef.current;
    const canvas = canvasRef.current;
    if (!emblem || !canvas) return null;
    const emblemRect = emblem.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: emblemRect.left + emblemRect.width / 2 - canvasRect.left,
      y: emblemRect.top + emblemRect.height / 2 - canvasRect.top,
    };
  }, []);

  const syncCtaEmitter = useCallback((rate) => {
    const cta = ctaRef.current;
    const canvas = canvasRef.current;
    if (!cta || !canvas || !engineRef.current) return;
    const ctaRect = cta.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    engineRef.current.setCtaRect({
      x: ctaRect.left - canvasRect.left,
      y: ctaRect.top - canvasRect.top,
      width: ctaRect.width,
      height: ctaRect.height,
    }, rate);
  }, []);

  // opening timeline
  useEffect(() => {
    const timers = [];
    const at = (ms, fn) => timers.push(window.setTimeout(fn, ms));

    at(40, () => sound("riser"));
    at(90, () => sound("whoosh"));
    at(560, () => {
      setPhase(1);
      sound("slam");
      const point = emblemCanvasPoint();
      if (point && engineRef.current) {
        engineRef.current.burst(point.x, point.y, 60);
        engineRef.current.ringBurst(point.x, point.y, 30, 110);
      }
    });
    at(1040, () => setPhase(2));
    for (let index = 0; index < PERK_TRACK_STEPS; index += 1) {
      at(1100 + index * 95, () => {
        sound("tick", index);
        setTilesLanded(index + 1);
      });
    }
    at(1560, () => {
      setPhase(3);
      sound("whoosh", true);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [emblemCanvasPoint, sound, runId]);

  // credits odometer once the purchase card is in (re-runs per tier switch)
  useEffect(() => {
    if (phase < 3) return undefined;
    const target = activeTier.credits;
    const started = performance.now();
    let raf = 0;
    const tickUp = (now) => {
      const t = Math.min(1, (now - started) / 950);
      setCreditCount(Math.round((1 - (1 - t) ** 3) * target));
      if (t < 1) raf = requestAnimationFrame(tickUp);
    };
    raf = requestAnimationFrame(tickUp);
    return () => cancelAnimationFrame(raf);
  }, [phase >= 3, activeTier.credits]); // eslint-disable-line react-hooks/exhaustive-deps

  // pin the ember emitter to the CTA once armed (and re-pin per tier switch —
  // the purchase card remounts, so the CTA node is new)
  useEffect(() => {
    if (phase < 3) return undefined;
    const sync = () => syncCtaEmitter(12);
    const settle = window.setTimeout(sync, 460); // after the card slide settles
    const scroller = scrollerRef.current;
    window.addEventListener("resize", sync);
    scroller?.addEventListener("scroll", sync, { passive: true });
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", sync);
      scroller?.removeEventListener("scroll", sync);
    };
  }, [phase >= 3, planIndex, syncCtaEmitter]); // eslint-disable-line react-hooks/exhaustive-deps

  // retint the ember sprite whenever the tier changes
  useEffect(() => {
    engineRef.current?.setPalette(theme.ember);
  }, [theme]);

  const switchTier = useCallback((nextIndex) => {
    const clamped = Math.max(0, Math.min(PLAN_TIERS.length - 1, nextIndex));
    if (clamped === planIndexRef.current || leaving) return;
    setSwitchDir(clamped > planIndexRef.current ? "up" : "down");
    setCreditCount(0);
    setPlanIndex(clamped);
    // gentle flame lick, not the intro slam — light for Plus, low for Pro,
    // strong for Ultra
    sound("flameShift", [0.35, 0.65, 1][clamped] ?? 0.6);
    // burst once the remounted emblem has landed
    window.setTimeout(() => {
      const point = emblemCanvasPoint();
      if (point && engineRef.current) {
        engineRef.current.burst(point.x, point.y, 46);
        engineRef.current.ringBurst(point.x, point.y, 24, 96);
      }
    }, 220);
  }, [emblemCanvasPoint, leaving, sound]);

  const handleUpgrade = useCallback(() => {
    sound("stinger");
    const cta = ctaRef.current;
    const canvas = canvasRef.current;
    if (cta && canvas && engineRef.current) {
      const ctaRect = cta.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      engineRef.current.burst(
        ctaRect.left + ctaRect.width / 2 - canvasRect.left,
        ctaRect.top + ctaRect.height / 2 - canvasRect.top,
        80,
      );
    }
    onUpgrade(activeTier.key);
  }, [activeTier.key, onUpgrade, sound]);

  const handleDismiss = useCallback(() => {
    if (leaving) return;
    sound("dismiss");
    setLeaving(true);
    window.setTimeout(onDismiss, 280);
  }, [leaving, onDismiss, sound]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  const handleReplay = useCallback(() => {
    if (leaving) return;
    sfx.unlock();
    setPhase(0);
    setTilesLanded(0);
    setCreditCount(0);
    setSwitchDir("");
    engineRef.current?.setCtaRect(null, 0);
    scrollerRef.current?.scrollTo({ top: 0 });
    setRunId((current) => current + 1);
  }, [leaving, sfx]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") handleDismiss();
      if (event.key === "ArrowRight") switchTier(planIndexRef.current + 1);
      if (event.key === "ArrowLeft") switchTier(planIndexRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDismiss, switchTier]);

  const themeVars = {
    "--up-cream": theme.cream,
    "--up-light": theme.light,
    "--up-mid": theme.mid,
    "--up-hot": theme.hot,
    "--up-core": theme.core,
    "--up-deep": theme.deep,
    "--up-accent": theme.accent,
    "--up-ink": theme.ink,
    "--up-price": theme.price,
    "--up-floor": theme.floor,
    "--up-corner": theme.corner,
    "--up-base-bottom": theme.baseBottom,
  };

  return (
    <Backdrop
      aria-label="Upgrade your Diff Forge plan"
      data-leaving={leaving}
      data-window-expanded={isWindowFrameExpanded ? "true" : "false"}
      data-window-platform={windowPlatform}
      role="dialog"
      style={themeVars}
    >
      <GodRays aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
      <Streak aria-hidden="true" data-lane="high" key={`streak-high-${runId}`} />
      <Streak aria-hidden="true" data-lane="low" key={`streak-low-${runId}`} />
      <ImpactFlash
        aria-hidden="true"
        data-landed={phase >= 1 ? "true" : undefined}
        key={`flash-${runId}-${activeTier.key}`}
      />
      <Vignette aria-hidden="true" />
      <EmberCanvas aria-hidden="true" ref={canvasRef} />

      {/* pricing-page shader flame burning in the active tier's palette;
          PlanFlame crossfades between tier presets on its own */}
      <PlanFlame active={!leaving} plan={activeTier.key} showControls={false} />

      {/* frameless window: keep a draggable strip along the top edge */}
      <DragStrip
        aria-hidden="true"
        data-tauri-drag-region
        onMouseDown={onTitleBarMouseDown}
      />

      <StageScroller ref={scrollerRef}>
        <Stage data-shake={phase === 1 ? "true" : undefined} key={`stage-${runId}`}>
        {/* ------------------------------------------------ showcase (φ) */}
        <Showcase>
          <TierKicker>
            <i />
            Diff Forge AI · Tier up
            <i />
          </TierKicker>

          {/* tier switcher: arrows + one pill per paid plan */}
          <TierNav aria-label="Choose your plan" data-visible={phase >= 2 ? "true" : undefined}>
            <TierArrow
              aria-label="Previous plan"
              disabled={planIndex === 0}
              onClick={() => switchTier(planIndex - 1)}
              type="button"
            >
              <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </TierArrow>
            <TierPills>
              {PLAN_TIERS.map((tier, index) => (
                <TierPill
                  aria-pressed={index === planIndex}
                  data-active={index === planIndex ? "true" : undefined}
                  data-tier={tier.key}
                  key={tier.key}
                  onClick={() => switchTier(index)}
                  type="button"
                >
                  <i aria-hidden="true" />
                  {tier.label}
                </TierPill>
              ))}
            </TierPills>
            <TierArrow
              aria-label="Next plan"
              data-more={planIndex < PLAN_TIERS.length - 1 ? "true" : undefined}
              disabled={planIndex === PLAN_TIERS.length - 1}
              onClick={() => switchTier(planIndex + 1)}
              type="button"
            >
              <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </TierArrow>
          </TierNav>

          {/* keyed swap: remounting replays the slam/rings for the new tier */}
          <TierSwap data-dir={switchDir || undefined} key={`swap-${activeTier.key}`}>
            <EmblemBlock>
              <Emblem data-landed={phase >= 1 ? "true" : undefined} ref={emblemRef}>
                <EmblemRing aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
                <EmblemRing aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} data-late="true" />
                <EmblemArt alt="" draggable={false} src={activeTier.art} />
                <EmblemWord>{activeTier.word}</EmblemWord>
                <EmblemHeat>{activeTier.heat}</EmblemHeat>
              </Emblem>
              <FloorGlow aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
              <HorizonLine aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
            </EmblemBlock>

            <Pitch data-visible={phase >= 2 ? "true" : undefined}>
              {activeTier.pitch}
            </Pitch>

            {/* battle-pass reward track */}
            <PerkTrack aria-label={`${activeTier.label} plan benefits`} data-visible={phase >= 2 ? "true" : undefined}>
              <PerkRail aria-hidden="true">
                <i style={{ transform: `scaleX(${tilesLanded / PERK_TRACK_STEPS})` }} />
              </PerkRail>
              {activeTier.track.map((perk, index) => (
                <PerkTile
                  data-landed={tilesLanded > index ? "true" : undefined}
                  key={perk.title}
                  style={{ "--tile-index": index }}
                >
                  <PerkGlyph aria-hidden="true">
                    <b>{perk.glyph}</b>
                  </PerkGlyph>
                  <strong>{perk.title}</strong>
                  <span>{perk.sub}</span>
                </PerkTile>
              ))}
            </PerkTrack>
          </TierSwap>
        </Showcase>

        {/* ------------------------------------------- purchase card (1) */}
        <PurchaseCard data-armed={phase >= 3 ? "true" : undefined} key={`card-${activeTier.key}`}>
          <ValueBadge aria-hidden="true">{activeTier.badge}</ValueBadge>
          <PurchaseHeader>
            <span>AI Access Pass</span>
            <strong>{activeTier.passName}</strong>
          </PurchaseHeader>

          <PriceRow data-compact={activeTier.price.length > 4 ? "true" : undefined}>
            <b>{activeTier.price}</b>
            <span>
              per month
              <br />
              cancel anytime
            </span>
          </PriceRow>

          <CreditsMeter>
            <div>
              <strong>{creditCount.toLocaleString()}</strong>
              <span>credits / month</span>
            </div>
            <MeterTrack aria-hidden="true">
              <i style={{ transform: `scaleX(${creditCount / activeTier.credits})` }} />
            </MeterTrack>
          </CreditsMeter>

          <StampList>
            {activeTier.stamps.map((stamp) => (
              <li key={stamp}>
                <i />
                {stamp}
              </li>
            ))}
          </StampList>

          <CtaWrap>
            <CtaHalo aria-hidden="true" />
            <CtaButton
              onClick={handleUpgrade}
              onMouseEnter={() => {
                sound("flare");
                syncCtaEmitter(32);
              }}
              onMouseLeave={() => syncCtaEmitter(12)}
              ref={ctaRef}
              type="button"
            >
              {activeTier.cta}
            </CtaButton>
          </CtaWrap>
          <CtaHint>Instant activation · billed monthly</CtaHint>
        </PurchaseCard>
        </Stage>
      </StageScroller>

      {/* quiet rail on the left edge */}
      <SideRail>
        <SideRailButton
          aria-label="Replay intro"
          onClick={handleReplay}
          title="Replay intro"
          type="button"
        >
          <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </SideRailButton>
        <SideRailButton
          aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
          aria-pressed={muted}
          onClick={toggleMuted}
          title={muted ? "Unmute sound effects" : "Mute sound effects"}
          type="button"
        >
          {muted ? (
            <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <line x1="23" x2="17" y1="9" y2="15" />
              <line x1="17" x2="23" y1="9" y2="15" />
            </svg>
          ) : (
            <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </SideRailButton>
        <SideRailDivider aria-hidden="true" />
        <KeepFreeButton onClick={handleDismiss} type="button">
          Keep using <b>Free</b>
        </KeepFreeButton>
      </SideRail>
    </Backdrop>
  );
});

/* ----------------------------------------------- low-credits top-up */

/*
 * LowCreditsOverlay — the startup "credit reserve low" moment. Shown once
 * per sign-in, before the shell, when the account has burned >90% of its
 * term credits. Same battle-pass stagecraft as the tier-up overlay (shared
 * canvas embers, WebAudio SFX, golden-ratio stage), but the story is a
 * warning + refuel: a red depleted-balance strip makes "you're low" loud
 * and unmistakable, and the purchase card sells one-time credit packs that
 * check out through Stripe in the system browser.
 */

const CREDIT_PACKS = [
  {
    key: "refill",
    label: "Refill",
    word: "REFILL",
    heat: "10,000 credit pack",
    passName: "Ember Refill",
    badge: "Quick fix",
    art: "/pricing/forge-plus-gold.webp",
    price: "$40",
    packs: 1,
    credits: 10000,
    pitch: (
      <>
        Running on embers. <em>Refuel the forge.</em>
      </>
    ),
    track: [
      { glyph: "◆", title: "+10k credits", sub: "one payment" },
      { glyph: "⚡", title: "Instant", sub: "applied on payment" },
      { glyph: "▣", title: "This term", sub: "boosts your balance" },
      { glyph: "⌁", title: "All devices", sub: "synced everywhere" },
      { glyph: "★", title: "Same rate", sub: "$40 per 10k" },
    ],
    theme: PLAN_TIERS[0].theme,
  },
  {
    key: "reserve",
    label: "Reserve",
    word: "RESERVE",
    heat: "30,000 credit pack",
    passName: "Forge Reserve",
    badge: "Best value",
    art: "/pricing/forge-pro-platinum.webp",
    price: "$120",
    packs: 3,
    credits: 30000,
    pitch: (
      <>
        Three packs deep. <em>Weeks of headroom.</em>
      </>
    ),
    track: [
      { glyph: "◆", title: "+30k credits", sub: "one payment" },
      { glyph: "⚡", title: "Instant", sub: "applied on payment" },
      { glyph: "▣", title: "This term", sub: "boosts your balance" },
      { glyph: "⌁", title: "All devices", sub: "synced everywhere" },
      { glyph: "★", title: "Same rate", sub: "$40 per 10k" },
    ],
    theme: PLAN_TIERS[1].theme,
  },
  {
    key: "stockpile",
    label: "Stockpile",
    word: "STOCKPILE",
    heat: "100,000 credit pack",
    passName: "Full Stockpile",
    badge: "Max heat",
    art: "/pricing/forge-ultra-violet.webp",
    price: "$400",
    packs: 10,
    credits: 100000,
    pitch: (
      <>
        One hundred thousand credits. <em>Never think about it.</em>
      </>
    ),
    track: [
      { glyph: "◆", title: "+100k credits", sub: "one payment" },
      { glyph: "⚡", title: "Instant", sub: "applied on payment" },
      { glyph: "▣", title: "This term", sub: "boosts your balance" },
      { glyph: "⌁", title: "All devices", sub: "synced everywhere" },
      { glyph: "★", title: "Same rate", sub: "$40 per 10k" },
    ],
    theme: PLAN_TIERS[2].theme,
  },
];

const CREDIT_PACK_STAMPS = [
  "One-time payment — no plan change",
  "Applied to your current term instantly",
  "Shared across every synced device",
  "Secure Stripe checkout",
];

function formatOverlayCredits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "0";
  return Math.round(numeric).toLocaleString();
}

export const LowCreditsOverlay = memo(function LowCreditsOverlay({
  onDismiss,
  onTopup,
  onTitleBarMouseDown,
  windowPlatform,
  isWindowFrameExpanded,
  remainingCredits,
  totalCredits,
  percentRemaining,
  resetLabel,
  checkoutState,
  checkoutError,
  creditsAdded,
}) {
  // 0 open · 1 emblem slam · 2 balance alert + perk track · 3 card armed
  const [phase, setPhase] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [muted, setMuted] = useState(false);
  const [creditCount, setCreditCount] = useState(0);
  const [tilesLanded, setTilesLanded] = useState(0);
  const [runId, setRunId] = useState(0);
  const [packIndex, setPackIndex] = useState(0);
  const [switchDir, setSwitchDir] = useState("");

  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const emblemRef = useRef(null);
  const ctaRef = useRef(null);
  const scrollerRef = useRef(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const packIndexRef = useRef(packIndex);
  packIndexRef.current = packIndex;
  const successHandledRef = useRef(false);

  const activePack = CREDIT_PACKS[packIndex];
  const theme = activePack.theme;
  const topupSucceeded = Number(creditsAdded) > 0;

  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const sfx = useMemo(() => createSfx(), []);
  const sound = useCallback((name, ...args) => {
    if (!mutedRef.current) sfx[name](...args);
  }, [sfx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = createEmberEngine(canvas, prefersReducedMotion);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      sfx.close();
    };
  }, [prefersReducedMotion, sfx]);

  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [sfx]);

  const emblemCanvasPoint = useCallback(() => {
    const emblem = emblemRef.current;
    const canvas = canvasRef.current;
    if (!emblem || !canvas) return null;
    const emblemRect = emblem.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: emblemRect.left + emblemRect.width / 2 - canvasRect.left,
      y: emblemRect.top + emblemRect.height / 2 - canvasRect.top,
    };
  }, []);

  const syncCtaEmitter = useCallback((rate) => {
    const cta = ctaRef.current;
    const canvas = canvasRef.current;
    if (!cta || !canvas || !engineRef.current) return;
    const ctaRect = cta.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    engineRef.current.setCtaRect({
      x: ctaRect.left - canvasRect.left,
      y: ctaRect.top - canvasRect.top,
      width: ctaRect.width,
      height: ctaRect.height,
    }, rate);
  }, []);

  // opening timeline — same beats as the tier-up, so the moment feels kin
  useEffect(() => {
    const timers = [];
    const at = (ms, fn) => timers.push(window.setTimeout(fn, ms));

    at(40, () => sound("riser"));
    at(90, () => sound("whoosh"));
    at(560, () => {
      setPhase(1);
      sound("slam");
      const point = emblemCanvasPoint();
      if (point && engineRef.current) {
        engineRef.current.burst(point.x, point.y, 60);
        engineRef.current.ringBurst(point.x, point.y, 30, 110);
      }
    });
    at(1040, () => setPhase(2));
    for (let index = 0; index < PERK_TRACK_STEPS; index += 1) {
      at(1100 + index * 95, () => {
        sound("tick", index);
        setTilesLanded(index + 1);
      });
    }
    at(1560, () => {
      setPhase(3);
      sound("whoosh", true);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [emblemCanvasPoint, sound, runId]);

  // credits odometer once the purchase card is in (re-runs per pack switch)
  useEffect(() => {
    if (phase < 3) return undefined;
    const target = activePack.credits;
    const started = performance.now();
    let raf = 0;
    const tickUp = (now) => {
      const t = Math.min(1, (now - started) / 950);
      setCreditCount(Math.round((1 - (1 - t) ** 3) * target));
      if (t < 1) raf = requestAnimationFrame(tickUp);
    };
    raf = requestAnimationFrame(tickUp);
    return () => cancelAnimationFrame(raf);
  }, [phase >= 3, activePack.credits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase < 3 || topupSucceeded) return undefined;
    const sync = () => syncCtaEmitter(12);
    const settle = window.setTimeout(sync, 460);
    const scroller = scrollerRef.current;
    window.addEventListener("resize", sync);
    scroller?.addEventListener("scroll", sync, { passive: true });
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", sync);
      scroller?.removeEventListener("scroll", sync);
    };
  }, [phase >= 3, packIndex, syncCtaEmitter, topupSucceeded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.setPalette(theme.ember);
  }, [theme]);

  const handleDismiss = useCallback(() => {
    if (leaving) return;
    sound("dismiss");
    setLeaving(true);
    window.setTimeout(onDismiss, 280);
  }, [leaving, onDismiss, sound]);

  // payment landed: unlock stinger + full-screen burst, then bow out
  useEffect(() => {
    if (!topupSucceeded || successHandledRef.current) return undefined;
    successHandledRef.current = true;
    sound("unlock");
    sound("stinger");
    engineRef.current?.setCtaRect(null, 0);
    const canvas = canvasRef.current;
    if (canvas && engineRef.current) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      engineRef.current.burst(width / 2, height * 0.42, 90);
      engineRef.current.ringBurst(width / 2, height * 0.42, 34, 150);
    }
    const timer = window.setTimeout(() => {
      handleDismiss();
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [topupSucceeded, handleDismiss, sound]);

  const switchPack = useCallback((nextIndex) => {
    const clamped = Math.max(0, Math.min(CREDIT_PACKS.length - 1, nextIndex));
    if (clamped === packIndexRef.current || leaving) return;
    setSwitchDir(clamped > packIndexRef.current ? "up" : "down");
    setCreditCount(0);
    setPackIndex(clamped);
    sound("flameShift", [0.35, 0.65, 1][clamped] ?? 0.6);
    window.setTimeout(() => {
      const point = emblemCanvasPoint();
      if (point && engineRef.current) {
        engineRef.current.burst(point.x, point.y, 46);
        engineRef.current.ringBurst(point.x, point.y, 24, 96);
      }
    }, 220);
  }, [emblemCanvasPoint, leaving, sound]);

  const handleTopup = useCallback(() => {
    if (checkoutState === "opening" || topupSucceeded) return;
    sound("stinger");
    const cta = ctaRef.current;
    const canvas = canvasRef.current;
    if (cta && canvas && engineRef.current) {
      const ctaRect = cta.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      engineRef.current.burst(
        ctaRect.left + ctaRect.width / 2 - canvasRect.left,
        ctaRect.top + ctaRect.height / 2 - canvasRect.top,
        80,
      );
    }
    onTopup(activePack.packs, activePack.key);
  }, [activePack.key, activePack.packs, checkoutState, onTopup, sound, topupSucceeded]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  const handleReplay = useCallback(() => {
    if (leaving) return;
    sfx.unlock();
    setPhase(0);
    setTilesLanded(0);
    setCreditCount(0);
    setSwitchDir("");
    engineRef.current?.setCtaRect(null, 0);
    scrollerRef.current?.scrollTo({ top: 0 });
    setRunId((current) => current + 1);
  }, [leaving, sfx]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") handleDismiss();
      if (event.key === "ArrowRight") switchPack(packIndexRef.current + 1);
      if (event.key === "ArrowLeft") switchPack(packIndexRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDismiss, switchPack]);

  const themeVars = {
    "--up-cream": theme.cream,
    "--up-light": theme.light,
    "--up-mid": theme.mid,
    "--up-hot": theme.hot,
    "--up-core": theme.core,
    "--up-deep": theme.deep,
    "--up-accent": theme.accent,
    "--up-ink": theme.ink,
    "--up-price": theme.price,
    "--up-floor": theme.floor,
    "--up-corner": theme.corner,
    "--up-base-bottom": theme.baseBottom,
  };

  const safeTotal = Math.max(0, Number(totalCredits) || 0);
  const safeRemaining = Math.max(0, Number(remainingCredits) || 0);
  const clampedPercent = Math.max(
    0,
    Math.min(100, Number.isFinite(Number(percentRemaining)) ? Number(percentRemaining) : 0),
  );
  const ctaLabel = checkoutState === "opening"
    ? "Opening checkout…"
    : `Top up ${activePack.credits.toLocaleString()} credits`;

  return (
    <Backdrop
      aria-label="Your Diff Forge credits are running low"
      data-leaving={leaving}
      data-window-expanded={isWindowFrameExpanded ? "true" : "false"}
      data-window-platform={windowPlatform}
      role="dialog"
      style={themeVars}
    >
      <GodRays aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
      <Streak aria-hidden="true" data-lane="high" key={`streak-high-${runId}`} />
      <Streak aria-hidden="true" data-lane="low" key={`streak-low-${runId}`} />
      <ImpactFlash
        aria-hidden="true"
        data-landed={phase >= 1 ? "true" : undefined}
        key={`flash-${runId}-${activePack.key}`}
      />
      <Vignette aria-hidden="true" />
      <EmberCanvas aria-hidden="true" ref={canvasRef} />

      <PlanFlame active={!leaving} plan={PLAN_TIERS[packIndex].key} showControls={false} />

      <DragStrip
        aria-hidden="true"
        data-tauri-drag-region
        onMouseDown={onTitleBarMouseDown}
      />

      <StageScroller ref={scrollerRef}>
        <Stage data-shake={phase === 1 ? "true" : undefined} key={`stage-${runId}`}>
        {/* ------------------------------------------------ showcase (φ) */}
        <Showcase>
          <TierKicker>
            <i />
            Diff Forge AI · Credit reserve low
            <i />
          </TierKicker>

          {/* the warning strip is the headline of this overlay: it lands with
              the emblem slam and stays on screen for every pack */}
          <AlertStrip data-visible={phase >= 1 ? "true" : undefined} role="status">
            <AlertHead>
              <AlertBeacon aria-hidden="true">
                <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
              </AlertBeacon>
              <strong>Credits running low</strong>
              <b>{clampedPercent}% left</b>
            </AlertHead>
            <AlertMeter aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.max(0.02, clampedPercent / 100)})` }} />
            </AlertMeter>
            <AlertDetail>
              {formatOverlayCredits(safeRemaining)}
              {safeTotal > 0 ? ` of ${formatOverlayCredits(safeTotal)}` : ""} credits left this term
              {resetLabel ? ` · ${resetLabel}` : ""}
            </AlertDetail>
          </AlertStrip>

          {/* pack switcher: arrows + one pill per credit pack */}
          <TierNav aria-label="Choose a credit pack" data-visible={phase >= 2 ? "true" : undefined}>
            <TierArrow
              aria-label="Previous pack"
              disabled={packIndex === 0}
              onClick={() => switchPack(packIndex - 1)}
              type="button"
            >
              <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </TierArrow>
            <TierPills>
              {CREDIT_PACKS.map((pack, index) => (
                <TierPill
                  aria-pressed={index === packIndex}
                  data-active={index === packIndex ? "true" : undefined}
                  data-tier={PLAN_TIERS[index].key}
                  key={pack.key}
                  onClick={() => switchPack(index)}
                  type="button"
                >
                  <i aria-hidden="true" />
                  {pack.label}
                </TierPill>
              ))}
            </TierPills>
            <TierArrow
              aria-label="Next pack"
              data-more={packIndex < CREDIT_PACKS.length - 1 ? "true" : undefined}
              disabled={packIndex === CREDIT_PACKS.length - 1}
              onClick={() => switchPack(packIndex + 1)}
              type="button"
            >
              <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </TierArrow>
          </TierNav>

          <TierSwap data-dir={switchDir || undefined} key={`swap-${activePack.key}`}>
            <EmblemBlock>
              <Emblem data-landed={phase >= 1 ? "true" : undefined} ref={emblemRef}>
                <EmblemRing aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
                <EmblemRing aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} data-late="true" />
                <EmblemArt alt="" draggable={false} src={activePack.art} />
                <EmblemWord>{activePack.word}</EmblemWord>
                <EmblemHeat>{activePack.heat}</EmblemHeat>
              </Emblem>
              <FloorGlow aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
              <HorizonLine aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
            </EmblemBlock>

            <Pitch data-visible={phase >= 2 ? "true" : undefined}>
              {activePack.pitch}
            </Pitch>

            <PerkTrack aria-label={`${activePack.label} pack details`} data-visible={phase >= 2 ? "true" : undefined}>
              <PerkRail aria-hidden="true">
                <i style={{ transform: `scaleX(${tilesLanded / PERK_TRACK_STEPS})` }} />
              </PerkRail>
              {activePack.track.map((perk, index) => (
                <PerkTile
                  data-landed={tilesLanded > index ? "true" : undefined}
                  key={perk.title}
                  style={{ "--tile-index": index }}
                >
                  <PerkGlyph aria-hidden="true">
                    <b>{perk.glyph}</b>
                  </PerkGlyph>
                  <strong>{perk.title}</strong>
                  <span>{perk.sub}</span>
                </PerkTile>
              ))}
            </PerkTrack>
          </TierSwap>
        </Showcase>

        {/* ------------------------------------------- purchase card (1) */}
        <PurchaseCard data-armed={phase >= 3 ? "true" : undefined} key={`card-${activePack.key}`}>
          {topupSucceeded ? (
            <SuccessPanel>
              <SuccessGlyph aria-hidden="true">
                <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </SuccessGlyph>
              <strong>Credits added</strong>
              <b>+{formatOverlayCredits(creditsAdded)}</b>
              <span>Your balance is refuelled on every device. Back to the forge.</span>
            </SuccessPanel>
          ) : (
            <>
              <ValueBadge aria-hidden="true">{activePack.badge}</ValueBadge>
              <PurchaseHeader>
                <span>Credit top-up</span>
                <strong>{activePack.passName}</strong>
              </PurchaseHeader>

              <PriceRow data-compact={activePack.price.length > 4 ? "true" : undefined}>
                <b>{activePack.price}</b>
                <span>
                  one-time
                  <br />
                  instant delivery
                </span>
              </PriceRow>

              <CreditsMeter>
                <div>
                  <strong>{creditCount.toLocaleString()}</strong>
                  <span>credits added</span>
                </div>
                <MeterTrack aria-hidden="true">
                  <i style={{ transform: `scaleX(${creditCount / activePack.credits})` }} />
                </MeterTrack>
              </CreditsMeter>

              <StampList>
                {CREDIT_PACK_STAMPS.map((stamp) => (
                  <li key={stamp}>
                    <i />
                    {stamp}
                  </li>
                ))}
              </StampList>

              <CtaWrap>
                <CtaHalo aria-hidden="true" />
                <CtaButton
                  disabled={checkoutState === "opening"}
                  onClick={handleTopup}
                  onMouseEnter={() => {
                    sound("flare");
                    syncCtaEmitter(32);
                  }}
                  onMouseLeave={() => syncCtaEmitter(12)}
                  ref={ctaRef}
                  type="button"
                >
                  {ctaLabel}
                </CtaButton>
              </CtaWrap>
              {checkoutError ? (
                <CtaError role="alert">{checkoutError}</CtaError>
              ) : checkoutState === "waiting" ? (
                <CtaHint data-live="true">
                  Finish in your browser — credits land here automatically
                </CtaHint>
              ) : (
                <CtaHint>Secure Stripe checkout · Applied instantly</CtaHint>
              )}
            </>
          )}
        </PurchaseCard>
        </Stage>
      </StageScroller>

      <SideRail>
        <SideRailButton
          aria-label="Replay intro"
          onClick={handleReplay}
          title="Replay intro"
          type="button"
        >
          <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </SideRailButton>
        <SideRailButton
          aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
          aria-pressed={muted}
          onClick={toggleMuted}
          title={muted ? "Unmute sound effects" : "Mute sound effects"}
          type="button"
        >
          {muted ? (
            <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <line x1="23" x2="17" y1="9" y2="15" />
              <line x1="17" x2="23" y1="9" y2="15" />
            </svg>
          ) : (
            <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </SideRailButton>
        <SideRailDivider aria-hidden="true" />
        <KeepFreeButton onClick={handleDismiss} type="button">
          Top up <b>later</b>
        </KeepFreeButton>
      </SideRail>
    </Backdrop>
  );
});

/* ------------------------------------------------------------- styles */

const backdropIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const cameraPush = keyframes`
  from { transform: scale(1.055); }
  to { transform: scale(1); }
`;

const raysSpin = keyframes`
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
`;

const raysIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const streakSweep = keyframes`
  0% { transform: translateX(-120%) scaleX(0.6); opacity: 0; }
  16% { opacity: 1; }
  100% { transform: translateX(120vw) scaleX(1.4); opacity: 0; }
`;

const flashPop = keyframes`
  0% { opacity: 0; }
  14% { opacity: 0.5; }
  100% { opacity: 0; }
`;

const kickerIn = keyframes`
  from { opacity: 0; transform: translateY(-14px); letter-spacing: 0.65em; }
  to { opacity: 1; transform: translateY(0); letter-spacing: 0.34em; }
`;

const emblemSlam = keyframes`
  0% { opacity: 0; transform: scale(2.6) translateY(-30px); filter: blur(8px); }
  60% { opacity: 1; transform: scale(0.93) translateY(3px); filter: blur(0); }
  80% { transform: scale(1.05) translateY(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
`;

const ringBlast = keyframes`
  0% { opacity: 0.95; transform: scale(0.36); }
  100% { opacity: 0; transform: scale(2.3); }
`;

const stageShake = keyframes`
  0%, 100% { transform: translate(0, 0); }
  18% { transform: translate(-5px, 4px); }
  36% { transform: translate(5px, -3px); }
  54% { transform: translate(-4px, -3px); }
  72% { transform: translate(3px, 3px); }
  88% { transform: translate(-2px, 1px); }
`;

const horizonIn = keyframes`
  from { transform: scaleX(0); opacity: 0.9; }
  to { transform: scaleX(1); opacity: 1; }
`;

const floorIn = keyframes`
  from { opacity: 0; transform: scaleX(0.4); }
  to { opacity: 1; transform: scaleX(1); }
`;

const tilePop = keyframes`
  0% { opacity: 0; transform: translateY(22px) scale(0.62); }
  62% { opacity: 1; transform: translateY(-3px) scale(1.06); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
`;

const cardIn = keyframes`
  from { opacity: 0; transform: translateX(72px); }
  to { opacity: 1; transform: translateX(0); }
`;

const sheenSweep = keyframes`
  0%, 56% { transform: translateX(-130%) skewX(-24deg); }
  100% { transform: translateX(260%) skewX(-24deg); }
`;

const haloPulse = keyframes`
  0% { opacity: 0.7; transform: scale(0.97); }
  70% { opacity: 0; transform: scale(1.22); }
  100% { opacity: 0; transform: scale(1.22); }
`;

const emblemFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`;

const wordGlow = keyframes`
  0%, 100% { opacity: 0.42; transform: scale(0.96); }
  50% { opacity: 0.82; transform: scale(1.08); }
`;

const swapInFromRight = keyframes`
  from { opacity: 0; transform: translateX(52px) scale(0.98); }
  to { opacity: 1; transform: translateX(0) scale(1); }
`;

const swapInFromLeft = keyframes`
  from { opacity: 0; transform: translateX(-52px) scale(0.98); }
  to { opacity: 1; transform: translateX(0) scale(1); }
`;

const arrowBeckon = keyframes`
  0%, 100% { transform: translateX(0); opacity: 0.8; }
  50% { transform: translateX(3px); opacity: 1; }
`;

const reducedMotion = css`
  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transition: none !important;
  }
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 400;
  display: grid;
  place-items: center;
  overflow: hidden;
  /* fully opaque — the app shell stays hidden until this resolves */
  background:
    radial-gradient(ellipse at 50% 120%, rgba(var(--up-floor), 0.5), transparent 56%),
    radial-gradient(ellipse at 84% -14%, rgba(var(--up-corner), 0.34), transparent 46%),
    radial-gradient(ellipse at 10% 6%, rgba(16, 38, 82, 0.4), transparent 44%),
    linear-gradient(180deg, #05060a 0%, #030405 58%, var(--up-base-bottom) 100%);
  animation: ${backdropIn} 320ms ease both;
  transition: opacity 260ms ease;
  ${reducedMotion};

  /* frameless macOS window — clip to the same radius as AppFrame so the
     opaque backdrop doesn't paint square corners over the transparent shell */
  &[data-window-platform="macos"][data-window-expanded="false"] {
    border-radius: 12px;
  }

  &[data-leaving="true"] {
    opacity: 0;
    pointer-events: none;
  }
`;

/* draggable strip along the top edge — the overlay hides the titlebar */
const DragStrip = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 5;
  height: 34px;
`;

const Vignette = styled.div`
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(0, 0, 0, 0.44) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.3), transparent 12%, transparent 88%, rgba(0, 0, 0, 0.32));
  pointer-events: none;
`;

const GodRays = styled.div`
  position: absolute;
  top: 38.2%; /* golden section — rays center on the emblem */
  left: 30%;
  width: 150vmin;
  height: 150vmin;
  background: conic-gradient(
    from 0deg,
    transparent 0deg 22deg,
    rgba(var(--up-mid), 0.05) 26deg 34deg,
    transparent 38deg 82deg,
    rgba(var(--up-mid), 0.04) 88deg 96deg,
    transparent 100deg 150deg,
    rgba(var(--up-light), 0.06) 156deg 165deg,
    transparent 170deg 222deg,
    rgba(var(--up-mid), 0.045) 228deg 238deg,
    transparent 242deg 294deg,
    rgba(var(--up-light), 0.05) 300deg 310deg,
    transparent 314deg 360deg
  );
  mask-image: radial-gradient(circle at 50% 50%, #000 0%, transparent 62%);
  -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 0%, transparent 62%);
  opacity: 0;
  pointer-events: none;
  will-change: transform;
  transform: translate(-50%, -50%);

  &[data-landed="true"] {
    animation:
      ${raysIn} 900ms ease 100ms both,
      ${raysSpin} 52s linear infinite;
  }
  ${reducedMotion};
`;

const Streak = styled.div`
  position: absolute;
  left: -30%;
  width: 46%;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(var(--up-cream), 0.5), transparent);
  pointer-events: none;
  will-change: transform;
  animation: ${streakSweep} 1.05s cubic-bezier(0.3, 0, 0.2, 1) both;
  ${reducedMotion};

  &[data-lane="high"] {
    top: 24%;
    animation-delay: 120ms;
  }

  &[data-lane="low"] {
    top: 71%;
    height: 1px;
    opacity: 0.7;
    animation-delay: 300ms;
    animation-duration: 1.3s;
  }
`;

const ImpactFlash = styled.div`
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 38% 42%, rgba(var(--up-cream), 0.9), rgba(var(--up-mid), 0.3) 40%, transparent 70%);
  opacity: 0;
  pointer-events: none;

  &[data-landed="true"] {
    animation: ${flashPop} 460ms ease-out both;
  }
  ${reducedMotion};
`;

const EmberCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

/* scroll shell — if the stage is ever taller than the window (small or
   stacked layouts) the content scrolls instead of getting clipped */
const StageScroller = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: clamp(40px, 6vh, 60px) clamp(20px, 2.6vw, 48px) clamp(22px, 4.5vh, 48px) 72px;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--up-mid), 0.25) transparent;
`;

/* golden-ratio stage: showcase φ · purchase card 1 */
const Stage = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.618fr) minmax(330px, 1fr);
  align-items: center;
  gap: clamp(26px, 3.4vw, 62px);
  width: min(1220px, 100%);
  margin: auto;
  animation: ${cameraPush} 1.3s cubic-bezier(0.2, 0.7, 0.2, 1) both;

  &[data-shake="true"] {
    animation:
      ${stageShake} 340ms linear 1,
      ${cameraPush} 1.3s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  ${reducedMotion};

  @media (max-width: 979px) {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    gap: 26px;
    width: min(640px, 100%);
  }
`;

const Showcase = styled.div`
  display: grid;
  justify-items: center;
  gap: clamp(10px, 2.4vh, 20px);
  text-align: center;
`;

/* keyed wrapper so a tier switch remounts (and re-slams) the showcase */
const TierSwap = styled.div`
  display: grid;
  justify-items: center;
  gap: clamp(10px, 2.4vh, 20px);
  width: 100%;
  text-align: center;

  &[data-dir="up"] {
    animation: ${swapInFromRight} 340ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  &[data-dir="down"] {
    animation: ${swapInFromLeft} 340ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  ${reducedMotion};
`;

const TierKicker = styled.p`
  display: inline-flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  color: rgba(var(--up-light), 0.88);
  font-size: 12.5px;
  font-weight: 900;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  animation: ${kickerIn} 700ms cubic-bezier(0.2, 0.8, 0.2, 1) 200ms both;
  ${reducedMotion};

  i {
    width: 52px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(var(--up-light), 0.55));
  }

  i:last-child {
    transform: scaleX(-1);
  }
`;

/* --------------------------------------------------- tier switcher */

const TierNav = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  ${reducedMotion};
`;

const TierPills = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(var(--up-mid), 0.26);
  border-radius: 999px;
  background: rgba(6, 6, 8, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 10px 30px rgba(0, 0, 0, 0.4);
`;

const TierPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.62);
  background: transparent;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;

  i {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    opacity: 0.55;
    transition: opacity 160ms ease, box-shadow 160ms ease;
  }

  /* each pill keeps its own tier flame color so bigger plans read at a glance */
  &[data-tier="plus"] i {
    background: #ffc247;
  }

  &[data-tier="pro"] i {
    background: #dcedff;
  }

  &[data-tier="ultra"] i {
    background: #8d6bff;
  }

  &[data-active="true"] {
    color: #ffffff;
    border-color: rgba(var(--up-mid), 0.55);
    background: rgba(var(--up-mid), 0.16);
    box-shadow:
      0 0 22px rgba(var(--up-hot), 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }

  &[data-active="true"][data-tier="plus"] i {
    opacity: 1;
    box-shadow: 0 0 10px rgba(255, 194, 71, 0.9);
  }

  &[data-active="true"][data-tier="pro"] i {
    opacity: 1;
    box-shadow: 0 0 10px rgba(220, 237, 255, 0.9);
  }

  &[data-active="true"][data-tier="ultra"] i {
    opacity: 1;
    box-shadow: 0 0 10px rgba(141, 107, 255, 0.9);
  }

  &:hover {
    color: #ffffff;
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--up-mid), 0.8);
    outline-offset: 2px;
  }
`;

const TierArrow = styled.button`
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid rgba(var(--up-mid), 0.3);
  border-radius: 999px;
  color: rgba(var(--up-cream), 0.85);
  background: rgba(6, 6, 8, 0.72);
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  /* beckon toward the bigger plan so people know there's more above */
  &[data-more="true"] svg {
    animation: ${arrowBeckon} 1.6s ease-in-out infinite;
  }
  ${reducedMotion};

  &:disabled {
    cursor: default;
    opacity: 0.28;
  }

  &:not(:disabled):hover,
  &:not(:disabled):focus-visible {
    outline: none;
    color: #ffffff;
    border-color: rgba(var(--up-mid), 0.7);
    box-shadow: 0 0 18px rgba(var(--up-hot), 0.35);
  }
`;

const EmblemBlock = styled.div`
  position: relative;
  display: grid;
  justify-items: center;
  padding-bottom: 18px;
`;

const Emblem = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 2px;
  opacity: 0;
  will-change: transform, opacity;

  &[data-landed="true"] {
    opacity: 1;
    animation:
      ${emblemSlam} 500ms cubic-bezier(0.16, 1.1, 0.3, 1) both,
      ${emblemFloat} 5.5s ease-in-out 1.5s infinite;
  }
  ${reducedMotion};

  @media (prefers-reduced-motion: reduce) {
    opacity: 1;
  }
`;

const EmblemRing = styled.i`
  position: absolute;
  top: calc(50% - 110px);
  left: calc(50% - 110px);
  width: 220px;
  height: 220px;
  border: 2px solid rgba(var(--up-light), 0.8);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;

  &[data-landed="true"] {
    animation: ${ringBlast} 720ms cubic-bezier(0.2, 0.7, 0.3, 1) 40ms both;
  }

  &[data-late="true"] {
    border-width: 1px;
    border-color: rgba(var(--up-cream), 0.6);
  }

  &[data-landed="true"][data-late="true"] {
    animation-delay: 190ms;
    animation-duration: 860ms;
  }
  ${reducedMotion};
`;

const EmblemArt = styled.img`
  width: clamp(150px, 24vh, 214px);
  height: clamp(150px, 24vh, 214px);
  object-fit: contain;
  /* the plan art ships on a black plate — feather it into the backdrop */
  mask-image: radial-gradient(circle at 50% 47%, #000 52%, transparent 72%);
  -webkit-mask-image: radial-gradient(circle at 50% 47%, #000 52%, transparent 72%);
  filter:
    drop-shadow(0 16px 38px rgba(0, 0, 0, 0.62))
    drop-shadow(0 0 34px rgba(var(--up-hot), 0.36));
  user-select: none;
  -webkit-user-drag: none;
`;

const EmblemWord = styled.strong`
  position: relative;
  margin-top: -10px;
  background: linear-gradient(180deg, rgb(var(--up-cream)) 8%, rgb(var(--up-light)) 38%, rgb(var(--up-deep)) 62%, rgb(var(--up-light)) 88%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  font-size: clamp(52px, 9.6vh, 80px);
  font-weight: 950;
  letter-spacing: 0.17em;
  line-height: 1;
  isolation: isolate;
  ${reducedMotion};

  &::after {
    content: "";
    position: absolute;
    inset: -18% -12%;
    z-index: -1;
    border-radius: 999px;
    background:
      radial-gradient(ellipse at 50% 50%, rgba(var(--up-mid), 0.78), rgba(var(--up-mid), 0.18) 42%, transparent 72%);
    filter: blur(14px);
    opacity: 0.42;
    transform: scale(0.96);
    animation: ${wordGlow} 3.4s ease-in-out infinite;
    pointer-events: none;
    will-change: opacity, transform;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none !important;
    }
  }
`;

const EmblemHeat = styled.span`
  color: rgba(var(--up-light), 0.62);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.44em;
  text-transform: uppercase;
`;

const FloorGlow = styled.i`
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 74%;
  height: 34px;
  margin-left: -37%;
  background: radial-gradient(ellipse at 50% 100%, rgba(var(--up-hot), 0.3), transparent 68%);
  opacity: 0;
  pointer-events: none;
  transform-origin: 50% 100%;

  &[data-landed="true"] {
    animation: ${floorIn} 600ms ease-out 120ms both;
  }
  ${reducedMotion};
`;

const HorizonLine = styled.i`
  position: absolute;
  bottom: 0;
  left: 6%;
  width: 88%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--up-light), 0.65) 30%, rgba(var(--up-cream), 0.9) 50%, rgba(var(--up-light), 0.65) 70%, transparent);
  opacity: 0;
  pointer-events: none;

  &[data-landed="true"] {
    animation: ${horizonIn} 560ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms both;
  }
  ${reducedMotion};
`;

const Pitch = styled.p`
  margin: 0;
  color: rgba(226, 232, 240, 0.9);
  font-size: clamp(15px, 2.4vh, 19px);
  font-weight: 760;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);

  em {
    color: var(--up-accent);
    font-style: normal;
    font-weight: 900;
  }

  &[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  ${reducedMotion};
`;

/* -------------------------------------------------- battle-pass track */

const PerkTrack = styled.ul`
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  margin: 6px 0 0;
  padding: 14px 0 0;
  list-style: none;

  li {
    visibility: hidden;
  }

  &[data-visible="true"] li[data-landed="true"] {
    visibility: visible;
    animation: ${tilePop} 380ms cubic-bezier(0.2, 1, 0.3, 1) both;
    animation-delay: calc(var(--tile-index, 0) * 45ms);
  }
  ${reducedMotion};

  @media (prefers-reduced-motion: reduce) {
    li {
      visibility: visible;
    }
  }
`;

const PerkRail = styled.div`
  position: absolute;
  top: 0;
  right: 4%;
  left: 4%;
  height: 2px;
  background: rgba(var(--up-mid), 0.14);

  i {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, rgba(var(--up-mid), 0.9), rgba(var(--up-cream), 0.9));
    box-shadow: 0 0 12px rgba(var(--up-mid), 0.55);
    transform-origin: 0 50%;
    transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
`;

const PerkTile = styled.li`
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 13px 6px 11px;
  border: 1px solid rgba(var(--up-mid), 0.2);
  border-radius: 8px;
  transition: border-color 220ms ease, box-shadow 220ms ease;

  &[data-landed="true"] {
    border-color: rgba(var(--up-mid), 0.42);
    box-shadow:
      inset 0 1px 0 rgba(var(--up-cream), 0.16),
      0 0 22px rgba(var(--up-hot), 0.14);
  }
  background:
    linear-gradient(180deg, rgba(var(--up-hot), 0.1), rgba(var(--up-hot), 0.015) 62%),
    rgba(8, 7, 5, 0.82);
  box-shadow: inset 0 1px 0 rgba(var(--up-cream), 0.1);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  text-align: center;

  strong {
    color: rgb(var(--up-cream));
    font-size: 12.5px;
    font-weight: 880;
    line-height: 1.2;
  }

  span {
    color: rgba(203, 213, 225, 0.55);
    font-size: 10px;
    font-weight: 720;
    letter-spacing: 0.03em;
    line-height: 1.3;
    text-transform: uppercase;
  }

  @media (max-width: 1240px) {
    padding: 12px 5px 10px;

    strong {
      font-size: 11.5px;
    }
  }
`;

const PerkGlyph = styled.i`
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  margin-bottom: 4px;
  background: linear-gradient(135deg, rgb(var(--up-cream)), rgb(var(--up-hot)));
  box-shadow: 0 0 14px rgba(var(--up-hot), 0.5);
  transform: rotate(45deg);
  border-radius: 6px;

  b {
    color: var(--up-ink);
    font-size: 14px;
    font-style: normal;
    transform: rotate(-45deg);
  }
`;

/* ---------------------------------------------------- purchase card */

const PurchaseCard = styled.aside`
  position: relative;
  display: grid;
  gap: clamp(12px, 2.2vh, 18px);
  padding: clamp(20px, 3.4vh, 30px) clamp(20px, 2.2vw, 30px);
  border: 1px solid rgba(var(--up-mid), 0.34);
  border-radius: 12px;
  background:
    linear-gradient(160deg, rgba(var(--up-mid), 0.1), rgba(var(--up-mid), 0.02) 34%),
    linear-gradient(180deg, rgba(16, 13, 8, 0.96), rgba(8, 7, 5, 0.96));
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.6),
    0 0 60px rgba(var(--up-hot), 0.12),
    inset 0 1px 0 rgba(var(--up-cream), 0.14);
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  opacity: 0;
  visibility: hidden;

  /* forged top edge */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    left: 18px;
    height: 2px;
    background: linear-gradient(90deg, rgba(var(--up-cream), 0.85), rgba(var(--up-mid), 0.25) 70%, transparent);
    pointer-events: none;
  }

  &[data-armed="true"] {
    visibility: visible;
    animation: ${cardIn} 480ms cubic-bezier(0.18, 0.9, 0.24, 1) both;
    opacity: 1;
  }
  ${reducedMotion};

  @media (prefers-reduced-motion: reduce) {
    opacity: 1;
    visibility: visible;
  }

  @media (max-width: 979px) {
    width: min(440px, 100%);
  }
`;

/* battle-pass corner ribbon — clipped by the card's clip-path on purpose */
const ValueBadge = styled.span`
  position: absolute;
  top: 24px;
  right: -36px;
  z-index: 1;
  width: 152px;
  padding: 5px 0;
  background: linear-gradient(180deg, rgb(var(--up-cream)), rgb(var(--up-hot)));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  color: var(--up-ink);
  font-size: 9.5px;
  font-weight: 950;
  letter-spacing: 0.26em;
  text-align: center;
  text-transform: uppercase;
  transform: rotate(45deg);
  pointer-events: none;
`;

const PurchaseHeader = styled.header`
  display: grid;
  gap: 2px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--up-mid), 0.16);

  span {
    color: rgba(var(--up-light), 0.6);
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }

  strong {
    background: linear-gradient(180deg, rgb(var(--up-cream)) 10%, rgb(var(--up-light)) 55%, rgb(var(--up-core)) 90%);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    font-size: 25px;
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
`;

const PriceRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 13px;

  b {
    color: var(--up-price);
    font-size: clamp(44px, 7vh, 56px);
    font-weight: 950;
    letter-spacing: -0.02em;
    line-height: 0.9;
    text-shadow: 0 0 30px rgba(var(--up-mid), 0.28);
  }

  /* longer figures ($2,000) get a notch smaller so the row never wraps */
  &[data-compact="true"] b {
    font-size: clamp(38px, 5.8vh, 48px);
  }

  span {
    color: rgba(203, 213, 225, 0.6);
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    line-height: 1.5;
    text-transform: uppercase;
  }
`;

const CreditsMeter = styled.div`
  display: grid;
  gap: 7px;

  div {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }

  strong {
    color: var(--up-accent);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 21px;
    font-weight: 900;
    letter-spacing: 0.02em;
  }

  span {
    color: rgba(203, 213, 225, 0.55);
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

const MeterTrack = styled.div`
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);

  i {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, rgb(var(--up-deep)), rgb(var(--up-light)) 60%, rgb(var(--up-cream)));
    box-shadow: 0 0 14px rgba(var(--up-mid), 0.6);
    transform-origin: 0 50%;
    transition: transform 120ms linear;
  }
`;

const StampList = styled.ul`
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgba(226, 232, 240, 0.82);
    font-size: 12.5px;
    font-weight: 780;
  }

  i {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    background: linear-gradient(135deg, rgb(var(--up-cream)), rgb(var(--up-hot)));
    box-shadow: 0 0 9px rgba(var(--up-hot), 0.6);
    transform: rotate(45deg);
  }
`;

const CtaWrap = styled.div`
  position: relative;
  margin-top: 2px;
`;

const CtaHalo = styled.i`
  position: absolute;
  inset: -7px;
  border: 2px solid rgba(var(--up-light), 0.7);
  border-radius: 10px;
  animation: ${haloPulse} 2.1s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
  pointer-events: none;
  ${reducedMotion};
`;

const CtaButton = styled.button`
  position: relative;
  display: grid;
  width: 100%;
  place-items: center;
  padding: 17px 20px;
  overflow: hidden;
  border: 1px solid rgba(var(--up-cream), 0.7);
  border-radius: 7px;
  color: var(--up-ink);
  background: linear-gradient(180deg, rgb(var(--up-cream)) 0%, rgb(var(--up-hot)) 46%, rgb(var(--up-core)) 58%, rgb(var(--up-light)) 100%);
  box-shadow:
    0 12px 38px rgba(var(--up-core), 0.42),
    0 0 64px rgba(var(--up-hot), 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  cursor: pointer;
  font-size: 16.5px;
  font-weight: 950;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  transition: transform 140ms ease, box-shadow 140ms ease;
  will-change: transform;

  &::after {
    content: "";
    position: absolute;
    top: -30%;
    bottom: -30%;
    left: 0;
    width: 34%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
    animation: ${sheenSweep} 2.4s cubic-bezier(0.3, 0, 0.3, 1) infinite;
    pointer-events: none;
  }
  ${reducedMotion};

  &:hover,
  &:focus-visible {
    outline: none;
    transform: translateY(-2px) scale(1.02);
    box-shadow:
      0 18px 50px rgba(var(--up-core), 0.56),
      0 0 84px rgba(var(--up-hot), 0.44),
      inset 0 1px 0 rgba(255, 255, 255, 0.72);
  }

  &:active {
    transform: translateY(0) scale(0.99);
  }

  &:disabled {
    cursor: wait;
    transform: none;
    filter: saturate(0.72) brightness(0.92);
  }
`;

const CtaHint = styled.span`
  color: rgba(203, 213, 225, 0.45);
  font-size: 10.5px;
  font-weight: 780;
  letter-spacing: 0.09em;
  text-align: center;
  text-transform: uppercase;

  /* checkout handed off to the browser — keep the guidance line readable */
  &[data-live="true"] {
    color: rgba(var(--up-light), 0.85);
  }
`;

/* ------------------------------------------------------- side rail */

const SideRail = styled.div`
  position: absolute;
  top: 50%;
  left: 14px;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: 12px;
  transform: translateY(-50%);
`;

const SideRailButton = styled.button`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.6);
  background: rgba(10, 12, 16, 0.78);
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    color: rgb(var(--up-cream));
    border-color: rgba(var(--up-mid), 0.4);
  }
`;

const SideRailDivider = styled.i`
  width: 1px;
  height: 34px;
  background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.16), transparent);
`;

const KeepFreeButton = styled.button`
  padding: 8px 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.52);
  background: rgba(10, 12, 16, 0.72);
  cursor: pointer;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transition: color 140ms ease, border-color 140ms ease;

  b {
    font-weight: 900;
  }

  &:hover,
  &:focus-visible {
    outline: none;
    color: rgba(226, 232, 240, 0.9);
    border-color: rgba(255, 255, 255, 0.3);
  }
`;

/* ----------------------------------------- low-credits alert + success */

const alertBeaconPulse = keyframes`
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.12); }
`;

const alertMeterThrob = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

/* fixed ember-red palette on purpose: the warning must read as a warning no
   matter which pack theme is active behind it */
const AlertStrip = styled.div`
  display: grid;
  gap: 8px;
  width: min(520px, 100%);
  padding: 12px 16px 13px;
  border: 1px solid rgba(255, 110, 64, 0.5);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(84, 22, 8, 0.62), rgba(38, 10, 5, 0.86));
  box-shadow:
    0 0 36px rgba(255, 84, 40, 0.18),
    inset 0 1px 0 rgba(255, 176, 130, 0.2);
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  ${reducedMotion};
`;

const AlertHead = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;

  strong {
    flex: 1;
    color: #ffd9c4;
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.24em;
    text-align: left;
    text-transform: uppercase;
  }

  b {
    color: #ff9d73;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.04em;
  }
`;

const AlertBeacon = styled.i`
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255, 130, 80, 0.55);
  border-radius: 8px;
  color: #ffb38a;
  background: rgba(255, 96, 42, 0.14);
  animation: ${alertBeaconPulse} 1.7s ease-in-out infinite;
  ${reducedMotion};

  svg {
    width: 14px;
    height: 14px;
  }
`;

const AlertMeter = styled.div`
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);

  i {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, #ff3b1f, #ff7a3c 70%, #ffb057);
    box-shadow: 0 0 14px rgba(255, 96, 42, 0.7);
    transform-origin: 0 50%;
    transition: transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
    animation: ${alertMeterThrob} 2.2s ease-in-out infinite;
  }
  ${reducedMotion};
`;

const AlertDetail = styled.span`
  color: rgba(255, 214, 190, 0.78);
  font-size: 11.5px;
  font-weight: 780;
  letter-spacing: 0.05em;
  text-align: left;
`;

const successPop = keyframes`
  0% { opacity: 0; transform: scale(0.6); }
  60% { opacity: 1; transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
`;

const SuccessPanel = styled.div`
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: clamp(22px, 5vh, 44px) 8px;
  text-align: center;

  strong {
    color: rgba(var(--up-light), 0.85);
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }

  b {
    background: linear-gradient(180deg, rgb(var(--up-cream)) 10%, rgb(var(--up-light)) 55%, rgb(var(--up-core)) 90%);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: clamp(36px, 6vh, 48px);
    font-weight: 950;
    letter-spacing: 0.01em;
    line-height: 1;
    animation: ${successPop} 460ms cubic-bezier(0.16, 1.1, 0.3, 1) both;
  }

  span {
    max-width: 300px;
    color: rgba(226, 232, 240, 0.72);
    font-size: 12.5px;
    font-weight: 740;
    line-height: 1.5;
  }
  ${reducedMotion};
`;

const SuccessGlyph = styled.i`
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  margin-bottom: 4px;
  border-radius: 50%;
  color: var(--up-ink);
  background: linear-gradient(135deg, rgb(var(--up-cream)), rgb(var(--up-hot)));
  box-shadow: 0 0 34px rgba(var(--up-hot), 0.55);
  animation: ${successPop} 420ms cubic-bezier(0.16, 1.1, 0.3, 1) both;
  ${reducedMotion};

  svg {
    width: 26px;
    height: 26px;
  }
`;

const CtaError = styled.span`
  color: #ff9d8a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-align: center;
`;
