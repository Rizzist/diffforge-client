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

/* DeepSeek's whale — the official simple-icons mark. */
function DeepseekMark(props) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" />
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
export function ModelBrandIcon({ model, provider, status, park = false }) {
  /* A park outranks the run bucket: a session waiting on a human reads amber
     here rather than as a word elsewhere in the row, so the mark carries the
     whole state and nothing competes with the title for space. */
  const state = park ? "waiting" : status;
  const family = modelBrandFor(model, provider);
  if (!family) {
    return <FallbackDot aria-hidden="true" data-status={state} />;
  }
  return (
    <BrandWrap
      aria-hidden="true"
      data-brand={family.key}
      style={{ "--brand-color": family.color, "--brand-color-light": family.colorLight || family.color }}
      title={family.label}
    >
      {brandGlyph(family)}
      {(state === "running" || state === "waiting" || state === "error") && (
        <ActivityBadge data-status={state} />
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
