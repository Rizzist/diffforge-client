import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes, css } from "styled-components";

/*
 * PlusUpsellOverlay — the "battle pass" moment shown to free accounts after
 * sign-in. One canvas drives every particle (embers, slam sparks, CTA
 * flare-ups) so the DOM only animates transform/opacity; sounds are
 * synthesized on the fly with WebAudio (no audio assets to ship). The quiet
 * escape hatch ("Keep using Free") rides the left edge next to the SFX mute
 * toggle, and the overlay returns on every fresh sign-in by design.
 */

const MUTE_STORAGE_KEY = "diffforge.plusUpsell.sfxMuted";

const PERKS = [
  { title: "Native desktop app", detail: "Mac, Windows, and Linux license" },
  { title: "10,000 credits / month", detail: "Included Diff Forge AI allowance" },
  { title: "Up to 4 devices", detail: "Personal multi-device sync" },
  { title: "10 GB workspace storage", detail: "3 GB SQLite + 7 GB assets" },
  { title: "Priority support", detail: "Faster plan and setup help" },
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
    /* low airy sweep as the overlay lands */
    whoosh() {
      play((audio, t0) => {
        const src = audio.createBufferSource();
        src.buffer = noiseBuffer(audio, 0.9);
        const filter = audio.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(220, t0);
        filter.frequency.exponentialRampToValueAtTime(2400, t0 + 0.5);
        filter.frequency.exponentialRampToValueAtTime(320, t0 + 0.85);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.16);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t0);
        src.stop(t0 + 0.95);
      });
    },
    /* emblem slam: thump + metallic ring + spark sizzle */
    slam() {
      play((audio, t0) => {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, t0);
        osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.24);
        const oscGain = audio.createGain();
        oscGain.gain.setValueAtTime(0.5, t0);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        osc.connect(oscGain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + 0.34);

        [523.25, 783.99, 1046.5].forEach((freq, index) => {
          const ring = audio.createOscillator();
          ring.type = "triangle";
          ring.frequency.value = freq * 1.003;
          const ringGain = audio.createGain();
          ringGain.gain.setValueAtTime(0.0001, t0);
          ringGain.gain.exponentialRampToValueAtTime(0.07 / (index + 1), t0 + 0.012);
          ringGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7 + index * 0.12);
          ring.connect(ringGain).connect(audio.destination);
          ring.start(t0);
          ring.stop(t0 + 0.95);
        });

        const sizzle = audio.createBufferSource();
        sizzle.buffer = noiseBuffer(audio, 0.5);
        const sizzleFilter = audio.createBiquadFilter();
        sizzleFilter.type = "highpass";
        sizzleFilter.frequency.value = 3800;
        const sizzleGain = audio.createGain();
        sizzleGain.gain.setValueAtTime(0.12, t0 + 0.01);
        sizzleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        sizzle.connect(sizzleFilter).connect(sizzleGain).connect(audio.destination);
        sizzle.start(t0 + 0.01);
        sizzle.stop(t0 + 0.55);
      });
    },
    /* perk row tick */
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
    /* CTA hover flare */
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
    /* upgrade click stinger: rising fifth + shimmer */
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
    /* soft dismiss puff */
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
    return { burst: () => {}, setCtaRect: () => {}, destroy: () => {} };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sprite = document.createElement("canvas");
  sprite.width = 32;
  sprite.height = 32;
  const spriteCtx = sprite.getContext("2d");
  const spriteGradient = spriteCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
  spriteGradient.addColorStop(0, "rgba(255, 236, 189, 1)");
  spriteGradient.addColorStop(0.35, "rgba(255, 186, 84, 0.85)");
  spriteGradient.addColorStop(1, "rgba(255, 122, 24, 0)");
  spriteCtx.fillStyle = spriteGradient;
  spriteCtx.fillRect(0, 0, 32, 32);

  const MAX_PARTICLES = 150;
  const particles = [];
  let ctaRect = null;
  let width = 0;
  let height = 0;
  let raf = 0;
  let last = performance.now();
  let destroyed = false;

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
      y: ctaRect.y + ctaRect.height * 0.4,
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
  let ctaRate = 10; // particles / second rising from the CTA

  const step = (now) => {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!document.hidden) {
      ambientAccumulator += dt * 7;
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
          p.vy += 150 * dt; // gravity pulls slam sparks back down
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
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

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
    setCtaRect(rect, rate = 10) {
      ctaRect = rect;
      ctaRate = rate;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}

/* ---------------------------------------------------------- component */

export function PlusUpsellOverlay({ onDismiss, onUpgrade }) {
  const [phase, setPhase] = useState(0); // 0 sweep · 1 emblem slam · 2 perks · 3 armed
  const [leaving, setLeaving] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [creditCount, setCreditCount] = useState(0);

  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const emblemRef = useRef(null);
  const ctaRef = useRef(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const sfx = useMemo(() => createSfx(), []);
  const sound = useCallback((name, ...args) => {
    if (!mutedRef.current) sfx[name](...args);
  }, [sfx]);

  // particle engine lifecycle
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

  // opening timeline
  useEffect(() => {
    const timers = [];
    const at = (ms, fn) => timers.push(window.setTimeout(fn, ms));

    at(60, () => sound("whoosh"));
    at(430, () => {
      setPhase(1);
      sound("slam");
      const emblem = emblemRef.current;
      const canvas = canvasRef.current;
      if (emblem && canvas && engineRef.current) {
        const emblemRect = emblem.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        engineRef.current.burst(
          emblemRect.left + emblemRect.width / 2 - canvasRect.left,
          emblemRect.top + emblemRect.height / 2 - canvasRect.top,
          56,
        );
      }
    });
    at(980, () => setPhase(2));
    PERKS.forEach((_, index) => {
      at(1050 + index * 110, () => sound("tick", index));
    });
    at(1050 + PERKS.length * 110 + 160, () => setPhase(3));

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [sound]);

  // credits count-up once perks land
  useEffect(() => {
    if (phase < 2) return undefined;
    const started = performance.now();
    let raf = 0;
    const tickUp = (now) => {
      const t = Math.min(1, (now - started) / 900);
      setCreditCount(Math.round((1 - (1 - t) ** 3) * 10000));
      if (t < 1) raf = requestAnimationFrame(tickUp);
    };
    raf = requestAnimationFrame(tickUp);
    return () => cancelAnimationFrame(raf);
  }, [phase >= 2]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the CTA ember emitter pinned to the button
  useEffect(() => {
    if (phase < 3) return undefined;
    const sync = () => {
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
      });
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [phase >= 3]); // eslint-disable-line react-hooks/exhaustive-deps

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
        70,
      );
    }
    onUpgrade();
  }, [onUpgrade, sound]);

  const handleDismiss = useCallback(() => {
    if (leaving) return;
    sound("dismiss");
    setLeaving(true);
    window.setTimeout(onDismiss, 260);
  }, [leaving, onDismiss, sound]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — session-only mute
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDismiss]);

  return (
    <Backdrop aria-label="Upgrade to Diff Forge Plus" data-leaving={leaving} role="dialog">
      <LightSweep aria-hidden="true" />
      <EmberCanvas aria-hidden="true" ref={canvasRef} />

      <Stage data-phase={phase} data-shake={phase === 1 ? "true" : undefined}>
        <TierKicker>
          <i />
          Diff Forge AI · Tier up
          <i />
        </TierKicker>

        <Emblem data-landed={phase >= 1 ? "true" : undefined} ref={emblemRef}>
          <EmblemRing aria-hidden="true" data-landed={phase >= 1 ? "true" : undefined} />
          <EmblemArt alt="" draggable={false} src="/pricing/forge-plus-gold.webp" />
          <EmblemWord>PLUS</EmblemWord>
          <EmblemHeat>GOLD FLAME</EmblemHeat>
        </Emblem>

        <Pitch data-visible={phase >= 2 ? "true" : undefined}>
          Three agents. One codebase. <em>Zero chaos.</em>
        </Pitch>

        <PerkList aria-label="Plus plan benefits" data-visible={phase >= 2 ? "true" : undefined}>
          {PERKS.map((perk, index) => (
            <PerkRow key={perk.title} style={{ "--perk-index": index }}>
              <PerkDiamond aria-hidden="true" />
              <strong>
                {perk.title === "10,000 credits / month"
                  ? `${creditCount.toLocaleString()} credits / month`
                  : perk.title}
              </strong>
              <span>{perk.detail}</span>
            </PerkRow>
          ))}
        </PerkList>

        <CtaRow data-armed={phase >= 3 ? "true" : undefined}>
          <CtaButton
            onClick={handleUpgrade}
            onMouseEnter={() => {
              sound("flare");
              const cta = ctaRef.current;
              const canvas = canvasRef.current;
              if (cta && canvas && engineRef.current) {
                const ctaRect = cta.getBoundingClientRect();
                const canvasRect = canvas.getBoundingClientRect();
                engineRef.current.setCtaRect({
                  x: ctaRect.left - canvasRect.left,
                  y: ctaRect.top - canvasRect.top,
                  width: ctaRect.width,
                  height: ctaRect.height,
                }, 30);
              }
            }}
            onMouseLeave={() => {
              const cta = ctaRef.current;
              const canvas = canvasRef.current;
              if (cta && canvas && engineRef.current) {
                const ctaRect = cta.getBoundingClientRect();
                const canvasRect = canvas.getBoundingClientRect();
                engineRef.current.setCtaRect({
                  x: ctaRect.left - canvasRect.left,
                  y: ctaRect.top - canvasRect.top,
                  width: ctaRect.width,
                  height: ctaRect.height,
                }, 10);
              }
            }}
            ref={ctaRef}
            type="button"
          >
            <span>Upgrade to Plus</span>
            <b>$60/mo</b>
          </CtaButton>
          <CtaHint>Cancel anytime · billed monthly</CtaHint>
        </CtaRow>
      </Stage>

      {/* quiet rail on the left edge */}
      <SideRail>
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
}

/* ------------------------------------------------------------- styles */

const backdropIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const sweepAcross = keyframes`
  0% { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
  18% { opacity: 1; }
  100% { transform: translateX(160%) skewX(-18deg); opacity: 0; }
`;

const kickerIn = keyframes`
  from { opacity: 0; transform: translateY(-14px); letter-spacing: 0.65em; }
  to { opacity: 1; transform: translateY(0); letter-spacing: 0.34em; }
`;

const emblemSlam = keyframes`
  0% { opacity: 0; transform: scale(2.5) translateY(-26px); filter: blur(7px); }
  62% { opacity: 1; transform: scale(0.94) translateY(2px); filter: blur(0); }
  80% { transform: scale(1.04) translateY(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
`;

const ringBlast = keyframes`
  0% { opacity: 0.9; transform: scale(0.4); }
  100% { opacity: 0; transform: scale(2.1); }
`;

const stageShake = keyframes`
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-4px, 3px); }
  40% { transform: translate(4px, -2px); }
  60% { transform: translate(-3px, -2px); }
  80% { transform: translate(2px, 2px); }
`;

const perkIn = keyframes`
  from { opacity: 0; transform: translateX(46px); }
  to { opacity: 1; transform: translateX(0); }
`;

const sheenSweep = keyframes`
  0%, 58% { transform: translateX(-130%) skewX(-24deg); }
  100% { transform: translateX(240%) skewX(-24deg); }
`;

const emblemFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
`;

const wordGlow = keyframes`
  0%, 100% { text-shadow: 0 0 24px rgba(255, 190, 92, 0.4), 0 2px 0 rgba(120, 66, 0, 0.8); }
  50% { text-shadow: 0 0 44px rgba(255, 190, 92, 0.75), 0 2px 0 rgba(120, 66, 0, 0.8); }
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
  z-index: 240;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 118%, rgba(255, 122, 24, 0.17), transparent 52%),
    radial-gradient(ellipse at 82% -12%, rgba(255, 190, 92, 0.1), transparent 46%),
    radial-gradient(ellipse at 12% 8%, rgba(47, 128, 255, 0.07), transparent 42%),
    rgba(2, 3, 5, 0.97);
  animation: ${backdropIn} 340ms ease both;
  transition: opacity 240ms ease;
  ${reducedMotion};

  &[data-leaving="true"] {
    opacity: 0;
    pointer-events: none;
  }
`;

const LightSweep = styled.div`
  position: absolute;
  top: -12%;
  bottom: -12%;
  left: 0;
  width: 34%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 214, 138, 0.075) 40%,
    rgba(255, 231, 178, 0.12) 50%,
    rgba(255, 214, 138, 0.075) 60%,
    transparent
  );
  animation: ${sweepAcross} 1.35s cubic-bezier(0.3, 0, 0.24, 1) 120ms both;
  pointer-events: none;
  will-change: transform;
  ${reducedMotion};
`;

const EmberCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const Stage = styled.div`
  position: relative;
  display: grid;
  justify-items: center;
  gap: clamp(12px, 2.6vh, 22px);
  width: min(660px, calc(100% - 130px));
  padding: 10px 0;
  text-align: center;

  &[data-shake="true"] {
    animation: ${stageShake} 320ms linear 1;
  }
  ${reducedMotion};
`;

const TierKicker = styled.p`
  display: inline-flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  color: rgba(255, 214, 138, 0.88);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  animation: ${kickerIn} 700ms cubic-bezier(0.2, 0.8, 0.2, 1) 180ms both;
  ${reducedMotion};

  i {
    width: 46px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 214, 138, 0.55));
  }

  i:last-child {
    transform: scaleX(-1);
  }
`;

const Emblem = styled.div`
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  opacity: 0;
  will-change: transform, opacity;

  &[data-landed="true"] {
    opacity: 1;
    animation:
      ${emblemSlam} 480ms cubic-bezier(0.16, 1.1, 0.3, 1) both,
      ${emblemFloat} 5.5s ease-in-out 1.4s infinite;
  }
  ${reducedMotion};

  @media (prefers-reduced-motion: reduce) {
    opacity: 1;
  }
`;

const EmblemRing = styled.i`
  position: absolute;
  top: calc(50% - 96px);
  left: calc(50% - 96px);
  width: 192px;
  height: 192px;
  border: 2px solid rgba(255, 208, 126, 0.75);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;

  &[data-landed="true"] {
    animation: ${ringBlast} 700ms cubic-bezier(0.2, 0.7, 0.3, 1) 60ms both;
  }
  ${reducedMotion};
`;

const EmblemArt = styled.img`
  width: clamp(132px, 21vh, 188px);
  height: clamp(132px, 21vh, 188px);
  object-fit: contain;
  /* the plan art ships on a black plate — feather it into the backdrop */
  mask-image: radial-gradient(circle at 50% 47%, #000 52%, transparent 72%);
  -webkit-mask-image: radial-gradient(circle at 50% 47%, #000 52%, transparent 72%);
  filter:
    drop-shadow(0 14px 34px rgba(0, 0, 0, 0.6))
    drop-shadow(0 0 30px rgba(255, 170, 60, 0.34));
  user-select: none;
  -webkit-user-drag: none;
`;

const EmblemWord = styled.strong`
  margin-top: -8px;
  background: linear-gradient(180deg, #ffe9bd 8%, #ffc963 38%, #b97818 62%, #ffdf9c 88%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  font-size: clamp(44px, 8vh, 66px);
  font-weight: 950;
  letter-spacing: 0.16em;
  line-height: 1;
  animation: ${wordGlow} 3.4s ease-in-out infinite;
  ${reducedMotion};
`;

const EmblemHeat = styled.span`
  color: rgba(255, 214, 138, 0.62);
  font-size: 10.5px;
  font-weight: 900;
  letter-spacing: 0.42em;
  text-transform: uppercase;
`;

const Pitch = styled.p`
  margin: 0;
  color: rgba(226, 232, 240, 0.88);
  font-size: clamp(15px, 2.3vh, 18px);
  font-weight: 740;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);

  em {
    color: #ffd166;
    font-style: normal;
    font-weight: 900;
  }

  &[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  ${reducedMotion};
`;

const PerkList = styled.ul`
  display: grid;
  gap: 7px;
  width: min(430px, 100%);
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    visibility: hidden;
  }

  &[data-visible="true"] li {
    visibility: visible;
    animation: ${perkIn} 360ms cubic-bezier(0.18, 0.9, 0.26, 1) calc(var(--perk-index) * 110ms) both;
  }
  ${reducedMotion};

  @media (prefers-reduced-motion: reduce) {
    li {
      visibility: visible;
    }
  }
`;

const PerkRow = styled.li`
  display: grid;
  grid-template-columns: 22px minmax(0, auto) minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 209, 102, 0.14);
  border-left: 2px solid rgba(255, 190, 92, 0.55);
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255, 176, 66, 0.08), rgba(255, 176, 66, 0.014) 62%, transparent);
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  text-align: left;

  strong {
    color: #fdf3dc;
    font-size: 13px;
    font-weight: 860;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: rgba(203, 213, 225, 0.6);
    font-size: 11.5px;
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const PerkDiamond = styled.i`
  align-self: center;
  width: 9px;
  height: 9px;
  background: linear-gradient(135deg, #ffe9bd, #f5a623);
  box-shadow: 0 0 10px rgba(255, 176, 66, 0.6);
  transform: rotate(45deg);
`;

const CtaRow = styled.div`
  display: grid;
  justify-items: center;
  gap: 9px;
  margin-top: 4px;
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 420ms ease, transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &[data-armed="true"] {
    opacity: 1;
    transform: translateY(0);
  }
  ${reducedMotion};
`;

const CtaButton = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 15px 34px;
  overflow: hidden;
  border: 1px solid rgba(255, 222, 150, 0.65);
  border-radius: 6px;
  color: #1c1002;
  background: linear-gradient(180deg, #ffe1a0 0%, #ffb43e 46%, #e8901c 58%, #ffcf7a 100%);
  box-shadow:
    0 10px 34px rgba(232, 144, 28, 0.36),
    0 0 54px rgba(255, 170, 60, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  cursor: pointer;
  font-size: 16px;
  font-weight: 950;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: transform 140ms ease, box-shadow 140ms ease;
  will-change: transform;

  b {
    padding-left: 14px;
    border-left: 1px solid rgba(64, 36, 2, 0.35);
    font-size: 13.5px;
    letter-spacing: 0.04em;
  }

  &::after {
    content: "";
    position: absolute;
    top: -30%;
    bottom: -30%;
    left: 0;
    width: 34%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
    animation: ${sheenSweep} 2.6s cubic-bezier(0.3, 0, 0.3, 1) infinite;
    pointer-events: none;
  }
  ${reducedMotion};

  &:hover,
  &:focus-visible {
    outline: none;
    transform: translateY(-2px) scale(1.025);
    box-shadow:
      0 16px 44px rgba(232, 144, 28, 0.5),
      0 0 74px rgba(255, 170, 60, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }

  &:active {
    transform: translateY(0) scale(0.99);
  }
`;

const CtaHint = styled.span`
  color: rgba(203, 213, 225, 0.42);
  font-size: 10.5px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

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
    color: #ffe9bd;
    border-color: rgba(255, 209, 102, 0.4);
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
