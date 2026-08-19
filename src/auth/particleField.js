// Particle-logo engine for the auth/boot flow. Extracted verbatim (same
// tuning, same math) from the approved next-diffforge /authmockup page.
//
// The logo materializes from particles whose colors are sampled live from
// /logo.webp, so the blue/orange split is the real brand split. Per-pixel
// `glow` decides which particles are allowed to bloom (flame/glyphs/seam)
// while the charcoal anvil body stays dark like the source. Compositing is
// source-over everywhere except the tail of the success windup and the
// launch detonation, which go additive ("lighter").
//
// Usage:
//   const engine = createParticleField({ canvas, anchor, onBootDone });
//   engine.setPhase("entry");
//   engine.destroy();
//
// The engine never advances phases on its own — the host owns the phase.
// `onBootDone` fires exactly once per boot run when the formation completes
// (BOOT_TOTAL_MS, or REDUCED_BOOT_TOTAL_MS under prefers-reduced-motion);
// while the host holds phase "boot" past that point the figure simply holds
// formed (the flight math parks every particle at its home pixel).

export const PHASES = {
  BOOT: "boot",
  ENTRY: "entry",
  WAITING: "waiting",
  SUCCESS: "success",
  LAUNCH: "launch",
};

/* ---- tuning knobs (kept identical to the approved mockup) ---------- */

export const PARTICLE_CAP = 3200;
export const SAMPLE_RES = 300; // offscreen sample resolution for logo.webp
export const SAMPLE_STRIDE = 2;

export const BOOT_STAGGER_MS = 700; // per-particle launch window
export const BOOT_FLIGHT_MS = 1050; // per-particle flight time (+ up to 500 jitter)
export const BOOT_TOTAL_MS = 2450; // when boot formation counts as complete
export const REDUCED_BOOT_TOTAL_MS = 350; // reduced-motion boot completion

export const SUCCESS_CONVERGE_MS = 620; // tight converge before the flash
export const SUCCESS_HOLD_MS = 950; // welcome beat before launch (host-driven)
export const LAUNCH_STREAK_RATIO = 0.65; // share of particles that leave streaks

/* ---- sprites -------------------------------------------------------- */

function spriteFor(cache, r, g, b, glowBucket) {
  const key = (((r >> 4) << 10) | ((g >> 4) << 5) | (b >> 4)) * 4 + glowBucket;
  let sprite = cache.get(key);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = 32;
  sprite.height = 32;
  const sctx = sprite.getContext("2d");
  const glow = glowBucket / 3;
  // Color-faithful core: dark anvil pixels stay charcoal; only genuinely
  // bright/saturated pixels (flame, glyphs, seam) earn a whitened core
  // and a wider falloff.
  const cr = Math.round(r + (255 - r) * glow * 0.4);
  const cg = Math.round(g + (255 - g) * glow * 0.4);
  const cb = Math.round(b + (255 - b) * glow * 0.4);
  // Hard core with a short falloff — long gradient tails read as blur at
  // 2-4px draw sizes. Body dots are near-solid; glow pixels keep a tail.
  const grad = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
  grad.addColorStop(0.52 - glow * 0.14, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.78 - glow * 0.08, `rgba(${r},${g},${b},${0.12 + glow * 0.22})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 32, 32);
  cache.set(key, sprite);
  return sprite;
}

/* ---- sampling ------------------------------------------------------- */

function sampleLogo(img) {
  const off = document.createElement("canvas");
  off.width = SAMPLE_RES;
  off.height = SAMPLE_RES;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(img, 0, 0, SAMPLE_RES, SAMPLE_RES);
  const { data } = octx.getImageData(0, 0, SAMPLE_RES, SAMPLE_RES);
  const pts = [];
  for (let y = 0; y < SAMPLE_RES; y += SAMPLE_STRIDE) {
    for (let x = 0; x < SAMPLE_RES; x += SAMPLE_STRIDE) {
      const i = (y * SAMPLE_RES + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (a < 140 || lum < 26) continue;
      const max = Math.max(r, g, b);
      const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
      // Raw colors — fidelity to logo.webp is the whole point. glow picks
      // which pixels are allowed to bloom (flame/glyphs/seam), keeping the
      // charcoal anvil body dark like the source.
      const bright = lum / 255;
      const glow = Math.min(
        1,
        Math.max(0, bright * 1.15 - 0.25) + sat * 0.35 * bright
      );
      pts.push({ nx: x / SAMPLE_RES, ny: y / SAMPLE_RES, r, g, b, lum, glow });
    }
  }
  // Random thin-out to the cap — visual density is what matters here.
  while (pts.length > PARTICLE_CAP) {
    pts.splice(Math.floor(Math.random() * pts.length), 1);
  }
  return pts;
}

function fallbackPoints() {
  // Logo failed to load: a split ring so the boot still reads as brand.
  const pts = [];
  for (let i = 0; i < 1400; i += 1) {
    const ang = (i / 1400) * Math.PI * 2;
    const rad = 0.34 + Math.random() * 0.05;
    const nx = 0.5 + Math.cos(ang) * rad;
    const ny = 0.5 + Math.sin(ang) * rad;
    const blueSide = nx < 0.5;
    pts.push({
      nx,
      ny,
      r: blueSide ? 62 : 255,
      g: blueSide ? 140 : 138,
      b: blueSide ? 255 : 40,
      lum: 140,
      glow: 0.55,
    });
  }
  return pts;
}

/* ---- engine --------------------------------------------------------- */

export function createParticleField({
  canvas,
  anchor,
  logoSrc = "/logo.webp",
  initialPhase = PHASES.BOOT,
  onBootDone,
  onSuccessPeak,
} = {}) {
  if (!canvas || !anchor) {
    throw new Error("createParticleField requires { canvas, anchor }");
  }
  const ctx = canvas.getContext("2d");
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let phase = initialPhase;
  let phaseStart = performance.now();
  let raf = 0;
  let dead = false;
  let particles = [];
  let center = { x: 0, y: 0 };
  let maxDist = 1;
  let lastTs = 0;
  let launchInit = false;
  let successFired = false;
  let bootFired = false;
  const sprites = new Map();

  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const layout = () => {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const rect = anchor.getBoundingClientRect();
    center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    maxDist = 1;
    for (const p of particles) {
      p.hx = rect.left + p.nx * rect.width;
      p.hy = rect.top + p.ny * rect.height;
      p.dist = Math.hypot(p.hx - center.x, p.hy - center.y);
      if (p.dist > maxDist) maxDist = p.dist;
    }
  };

  const build = (pts) => {
    const spawnR = Math.hypot(window.innerWidth, window.innerHeight) * 0.56;
    particles = pts.map((pt) => {
      const ang = Math.random() * Math.PI * 2;
      return {
        ...pt,
        x: 0,
        y: 0,
        hx: 0,
        hy: 0,
        dist: 0,
        sx: window.innerWidth / 2 + Math.cos(ang) * spawnR,
        sy: window.innerHeight / 2 + Math.sin(ang) * spawnR,
        delay: Math.random() * BOOT_STAGGER_MS,
        flight: BOOT_FLIGHT_MS + Math.random() * 500,
        seed: Math.random() * 1000,
        size: 1.6 + Math.random() * 1.1,
        fade: 0.9 + Math.random() * 0.8,
        streak: Math.random() < LAUNCH_STREAK_RATIO,
        gb: Math.round(pt.glow * 3),
        vx: 0,
        vy: 0,
        alpha: 0,
      };
    });
    // Dark body first, glow on top — with source-over compositing the
    // draw order decides whether the rim light survives.
    particles.sort((a, b) => a.lum - b.lum);
    layout();
    // Reduced motion (or an engine started past boot) skips the flight:
    // particles begin formed at their home pixels.
    const atHome = reduced || phase !== PHASES.BOOT;
    for (const p of particles) {
      p.x = atHome ? p.hx : p.sx;
      p.y = atHome ? p.hy : p.sy;
      if (atHome) p.alpha = 1;
    }
  };

  const scatterForBoot = () => {
    // Re-entering boot (a replay) re-scatters the field without resampling.
    for (const p of particles) {
      p.x = reduced ? p.hx : p.sx;
      p.y = reduced ? p.hy : p.sy;
      p.alpha = reduced ? 1 : 0;
      p.vx = 0;
      p.vy = 0;
    }
  };

  const draw = (now) => {
    if (dead) return;
    raf = requestAnimationFrame(draw);
    const dt = Math.min(0.04, lastTs ? (now - lastTs) / 1000 : 0.016);
    lastTs = now;
    const ph = phase;
    const pt = now - phaseStart;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    // Additive blending only for the tail of the windup and the
    // detonation itself; switching at success start blooms the whole
    // logo white in one frame, which is harsh on the eyes.
    ctx.globalCompositeOperation =
      ph === PHASES.LAUNCH ||
      (ph === PHASES.SUCCESS && pt > SUCCESS_CONVERGE_MS * 0.62)
        ? "lighter"
        : "source-over";

    if (ph === PHASES.BOOT && !bootFired) {
      const doneAt = reduced ? REDUCED_BOOT_TOTAL_MS : BOOT_TOTAL_MS;
      if (pt > doneAt) {
        bootFired = true;
        onBootDone?.();
      }
    }
    if (ph !== PHASES.LAUNCH) launchInit = false;
    if (ph !== PHASES.SUCCESS) successFired = false;

    if (ph === PHASES.LAUNCH && !launchInit) {
      launchInit = true;
      for (const p of particles) {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const speed = (220 + Math.random() * 520) * (0.6 + (p.dist / maxDist) * 0.8);
        p.vx = (dx / d) * speed;
        p.vy = (dy / d) * speed;
      }
    }

    for (const p of particles) {
      let px = p.x;
      let py = p.y;
      let alpha = p.alpha;
      let scale = 1;

      if (ph === PHASES.BOOT && !reduced) {
        const t = pt - p.delay;
        const prog = Math.max(0, Math.min(1, t / p.flight));
        const ease = 1 - (1 - prog) ** 3;
        const wob = Math.sin(prog * Math.PI) * 26 * Math.sin(p.seed * 7 + prog * 9);
        const dx = p.hx - p.sx;
        const dy = p.hy - p.sy;
        const len = Math.max(1, Math.hypot(dx, dy));
        px = p.sx + dx * ease + (-dy / len) * wob;
        py = p.sy + dy * ease + (dx / len) * wob;
        alpha = Math.min(1, prog * 2.2);
      } else if (ph === PHASES.ENTRY || (ph === PHASES.BOOT && reduced)) {
        px = p.hx + Math.sin(now * 0.0008 + p.seed) * 0.55;
        py = p.hy + Math.cos(now * 0.0007 + p.seed * 1.7) * 0.55;
        // Body holds steady; only glow pixels sparkle.
        alpha =
          0.92 - p.glow * 0.06 +
          (0.04 + p.glow * 0.26) * Math.sin(now * 0.002 + p.seed * 13);
      } else if (ph === PHASES.WAITING) {
        const rd = Math.max(1, p.dist);
        const dirx = (p.hx - center.x) / rd;
        const diry = (p.hy - center.y) / rd;
        const breathe = Math.sin(now * 0.0035 - p.dist * 0.045) * 2.4;
        px = p.hx + dirx * breathe + Math.sin(now * 0.0008 + p.seed) * 0.55;
        py = p.hy + diry * breathe + Math.cos(now * 0.0007 + p.seed) * 0.55;
        const ring = (now * 0.11) % (maxDist + 90);
        const nearRing = Math.abs(p.dist - ring) < 16;
        alpha = (nearRing ? 1 : 0.82) + 0.08 * Math.sin(now * 0.002 + p.seed * 13);
      } else if (ph === PHASES.SUCCESS) {
        const pull = 1 - Math.exp(-dt * 11);
        px = p.x + (p.hx - p.x) * pull;
        py = p.y + (p.hy - p.y) * pull;
        const heat = Math.min(1, pt / SUCCESS_CONVERGE_MS);
        // Windup is motion, not brightness: the whole figure inhales
        // toward the seam right before the burst.
        if (heat > 0.55) {
          const inh = ((heat - 0.55) / 0.45) ** 2 * 12;
          const rd = Math.max(1, Math.hypot(px - center.x, py - center.y));
          px -= ((px - center.x) / rd) * inh;
          py -= ((py - center.y) / rd) * inh;
        }
        alpha = 0.85 + heat * 0.25;
        scale = 1 + heat * 0.22;
        if (!successFired && pt > SUCCESS_CONVERGE_MS) {
          successFired = true;
          onSuccessPeak?.();
        }
      } else if (ph === PHASES.LAUNCH) {
        p.vx *= 1 + dt * 1.9;
        p.vy *= 1 + dt * 1.9;
        px = p.x + p.vx * dt;
        py = p.y + p.vy * dt;
        alpha = Math.max(0, p.alpha - dt * p.fade);
      }

      p.x = px;
      p.y = py;
      p.alpha = alpha;
      if (alpha <= 0.01) continue;

      if (ph === PHASES.LAUNCH && p.streak && !reduced) {
        ctx.globalAlpha = Math.min(0.85, alpha);
        ctx.strokeStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.lineWidth = p.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(px - p.vx * 0.045, py - p.vy * 0.045);
        ctx.lineTo(px, py);
        ctx.stroke();
      } else {
        const s = p.size * (1.05 + p.glow * 1.55) * scale;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(
          spriteFor(sprites, p.r, p.g, p.b, p.gb),
          px - s,
          py - s,
          s * 2,
          s * 2
        );
      }
    }
    ctx.globalAlpha = 1;
  };

  const img = new Image();
  img.src = logoSrc;
  const start = (pts) => {
    if (dead) return;
    build(pts);
    lastTs = 0;
    // Boot's clock starts when the field exists — decode latency never
    // eats into the formation.
    if (phase === PHASES.BOOT) phaseStart = performance.now();
    raf = requestAnimationFrame(draw);
  };
  img
    .decode()
    .then(() => start(sampleLogo(img)))
    .catch(() => start(fallbackPoints()));

  const onResize = () => layout();
  window.addEventListener("resize", onResize);

  return {
    setPhase(next) {
      if (dead || next === phase) return;
      phase = next;
      phaseStart = performance.now();
      if (next === PHASES.BOOT) {
        bootFired = false;
        scatterForBoot();
      }
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}
