import styled, { keyframes } from "styled-components";
import { Openai } from "@styled-icons/simple-icons/Openai";

/* Brand marks for the model a session is currently on. Detection is
   substring-based over the model id with the provider id as fallback, so
   new model names ("gpt-5.7-…", "claude-…-6") keep resolving without a
   catalog update. Unknown families fall back to the plain status dot. */

const BRAND_FAMILIES = [
  {
    key: "openai",
    label: "OpenAI",
    color: "#ffffff",
    colorLight: "#0d0d0d",
    model: ["gpt", "openai", "codex", "sol", "o1", "o3", "o4"],
    provider: ["openai"],
  },
  {
    key: "claude",
    label: "Claude",
    color: "#D97757",
    model: ["claude", "anthropic", "fable", "opus", "sonnet", "haiku", "mythos"],
    provider: ["anthropic"],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    color: "#4D6BFE",
    model: ["deepseek"],
    provider: ["deepseek"],
  },
  {
    key: "gemini",
    label: "Gemini",
    color: "#4E86F5",
    model: ["gemini", "antigravity", "google", "palm"],
    provider: ["google", "gemini"],
  },
  {
    key: "grok",
    label: "Grok",
    color: "#ffffff",
    colorLight: "#0d0d0d",
    model: ["grok", "xai"],
    provider: ["xai", "grok"],
  },
  {
    key: "qwen",
    label: "Qwen",
    color: "#615CED",
    letter: "Q",
    model: ["qwen", "qwq"],
    provider: ["alibaba", "qwen"],
  },
  {
    key: "kimi",
    label: "Kimi",
    color: "#16A8F0",
    letter: "K",
    model: ["kimi", "moonshot"],
    provider: ["moonshot", "kimi"],
  },
  {
    key: "mistral",
    label: "Mistral",
    color: "#FF7000",
    letter: "M",
    model: ["mistral", "magistral", "devstral", "codestral"],
    provider: ["mistral"],
  },
  {
    key: "meta",
    label: "Llama",
    color: "#0668E1",
    letter: "L",
    model: ["llama", "meta"],
    provider: ["meta"],
  },
  {
    key: "glm",
    label: "GLM",
    color: "#3859FF",
    letter: "G",
    model: ["glm", "zhipu"],
    provider: ["zhipu", "zai"],
  },
];

export function modelBrandFor(model, provider) {
  const modelText = String(model || "").toLowerCase();
  const providerText = String(provider || "").toLowerCase();
  if (modelText) {
    for (const family of BRAND_FAMILIES) {
      if (family.model.some((token) => modelText.includes(token))) {
        return family;
      }
    }
  }
  if (providerText && providerText !== "haider") {
    for (const family of BRAND_FAMILIES) {
      if (family.provider.some((token) => providerText.includes(token))) {
        return family;
      }
    }
  }
  return null;
}

/* Claude's radiating spark: twelve tapered rays. */
function ClaudeMark(props) {
  const rays = [];
  for (let i = 0; i < 12; i += 1) {
    rays.push(
      <path
        d="M12 2.4 L13.35 8.9 L12 11 L10.65 8.9 Z"
        key={i}
        transform={`rotate(${i * 30} 12 12)`}
      />,
    );
  }
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      {rays}
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/* Gemini's four-point curved sparkle. */
function GeminiMark(props) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
    </svg>
  );
}

/* DeepSeek's whale, simplified to the head-swoosh silhouette. */
function DeepseekMark(props) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M22.4 6.2c-.5 2.6-2 4.6-4 6.1.6 1.4.9 2.9.8 4.5-.1 1.4-.6 2.7-1.5 3.9-.3.4-.8.5-1.2.2-.4-.3-.4-.8-.2-1.2.7-1 1.1-2 1.2-3.1.1-1.1-.1-2.2-.5-3.2-1.8 1-3.8 1.6-5.8 1.8-2.4.2-4.7-.3-6.6-1.7C2.7 12.2 1.5 10.2 1 7.9c-.1-.5.2-.9.7-1 .4-.1.8.1 1 .5.9 1.6 2.2 2.8 3.9 3.5-.4-1-.6-2.1-.4-3.2.2-1.3.9-2.4 1.9-3.3.4-.3.9-.3 1.2.1.3.4.2.9-.1 1.2-.7.7-1.2 1.5-1.3 2.4-.1 1 .1 1.9.7 2.8 1.5.3 3 .3 4.5 0 1.9-.4 3.6-1.2 5.1-2.5 1.1-1 1.9-2.1 2.4-3.5.2-.4.6-.7 1.1-.5.5.1.8.6.7 1.1z" />
    </svg>
  );
}

/* Grok / xAI: the diagonal strike mark. */
function GrokMark(props) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M4.2 4.2h3.4L20 19.8h-3.4z" />
      <path d="M20 4.2 12.9 12l-1.7-2.1 5.4-5.7z" />
      <path d="M4 19.8l5.2-5.5 1.7 2.1-3.5 3.4z" />
    </svg>
  );
}

function LetterMark({ letter, ...props }) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <rect fill="currentColor" height="22" rx="6" width="22" x="1" y="1" />
      <text
        dominantBaseline="central"
        fill="var(--forge-surface, #101418)"
        fontFamily="inherit"
        fontSize="13"
        fontWeight="700"
        textAnchor="middle"
        x="12"
        y="12.6"
      >
        {letter}
      </text>
    </svg>
  );
}

function brandGlyph(family) {
  switch (family.key) {
    case "openai":
      return <Openai aria-hidden="true" />;
    case "claude":
      return <ClaudeMark aria-hidden="true" />;
    case "gemini":
      return <GeminiMark aria-hidden="true" />;
    case "deepseek":
      return <DeepseekMark aria-hidden="true" />;
    case "grok":
      return <GrokMark aria-hidden="true" />;
    default:
      return <LetterMark aria-hidden="true" letter={family.letter || family.label[0]} />;
  }
}

/* Rail marker: the brand mark of the session's current model, with a tiny
   activity badge (pulsing green/amber, solid red) only while non-idle.
   Unknown model families keep the classic status dot. */
export function ModelBrandIcon({ model, provider, status }) {
  const family = modelBrandFor(model, provider);
  if (!family) {
    return <FallbackDot aria-hidden="true" data-status={status} />;
  }
  return (
    <BrandWrap
      aria-hidden="true"
      data-brand={family.key}
      style={{ "--brand-color": family.color, "--brand-color-light": family.colorLight || family.color }}
      title={family.label}
    >
      {brandGlyph(family)}
      {(status === "running" || status === "waiting" || status === "error") && (
        <ActivityBadge data-status={status} />
      )}
    </BrandWrap>
  );
}

const badgePulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.72); }
`;

const BrandWrap = styled.span`
  position: relative;
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--brand-color);

  svg {
    width: 13px;
    height: 13px;
  }

  [data-forge-theme="light"] & {
    color: var(--brand-color-light, var(--brand-color));
  }
`;

const ActivityBadge = styled.i`
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--forge-green);
  box-shadow: 0 0 0 2px var(--forge-rail-bg, var(--forge-surface));
  animation: ${badgePulse} 1.6s ease-in-out infinite;

  &[data-status="waiting"] {
    background: var(--forge-amber);
  }

  &[data-status="error"] {
    background: var(--forge-red);
    animation: none;
  }
`;

const FallbackDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--forge-text-disabled);

  &[data-status="running"] {
    background: var(--forge-green);
  }

  &[data-status="waiting"] {
    background: var(--forge-amber);
  }

  &[data-status="error"] {
    background: var(--forge-red);
  }
`;
