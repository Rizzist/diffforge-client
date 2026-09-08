/* Brand catalogue for the model a session is currently on. Detection is
   substring-based over the model id with the provider id as fallback, so
   new model names ("gpt-5.7-…", "claude-…-6") keep resolving without a
   catalog update. Unknown families fall back to the plain status dot.

   This module is intentionally free of JSX/React so the resolution logic can
   be unit-tested under `node --test`; the glyphs and the <ModelBrandIcon>
   component live in modelBrand.jsx and consume this catalogue. */

export const BRAND_FAMILIES = [
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
