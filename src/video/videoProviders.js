// AI generation provider metadata + local key storage for the Video Editor.
// Keys follow the Deepgram precedent: localStorage only, passed to Rust per
// call as the request's `auth` field — never persisted backend-side.
//
// `capabilities` drives the Generate form: fields only render when the
// selected provider/mode actually uses them (a Higgsfield image-to-video run
// wants a start frame + duration; GPT Image 2 wants neither).

export const VIDEO_PROVIDER_KEYS_STORAGE_KEY = "diffforge.video.providerKeys";

export const VIDEO_PROVIDERS = [
  {
    id: "higgsfield",
    label: "Higgsfield",
    kind: "video",
    models: ["higgsfield-standard"],
    modes: ["text-to-video", "image-to-video"],
    requiresSecretKey: true,
    keyHint: "API key + secret from platform.higgsfield.ai",
    capabilities: { duration: { min: 1, max: 10, default: 5 }, startFrame: true, aspect: true },
  },
  {
    id: "seedance",
    label: "Seedance",
    kind: "video",
    models: ["seedance-2.0", "seedance-2.5"],
    modes: ["text-to-video", "image-to-video"],
    requiresSecretKey: false,
    keyHint: "BytePlus ModelArk API key",
    capabilities: { duration: { min: 2, max: 12, default: 5 }, startFrame: true, aspect: true },
  },
  {
    id: "kling",
    label: "Kling",
    kind: "video",
    models: ["kling-v3"],
    modes: ["text-to-video", "image-to-video"],
    requiresSecretKey: true,
    keyHint: "Kling access key + secret key",
    capabilities: { duration: { min: 5, max: 10, default: 5 }, startFrame: true, aspect: true },
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    kind: "image",
    models: ["gpt-image-2"],
    modes: ["text-to-image", "image-edit"],
    requiresSecretKey: false,
    keyHint: "OpenAI API key",
    capabilities: { sourceImages: true, aspect: true },
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    kind: "image",
    models: ["gemini-2.5-flash-image"],
    modes: ["text-to-image", "image-edit"],
    requiresSecretKey: false,
    keyHint: "Google AI Studio API key",
    capabilities: { sourceImages: true },
  },
  {
    id: "flux-lora",
    label: "Flux + LoRA",
    kind: "image",
    models: ["flux-klein"],
    modes: ["text-to-image"],
    requiresSecretKey: false,
    supportsLora: true,
    keyHint: "fal.ai API key (also used for LoRA training)",
    capabilities: { aspect: true, lora: true },
  },
];

export function getVideoProvider(providerId) {
  return VIDEO_PROVIDERS.find((provider) => provider.id === providerId) || null;
}

export function readVideoProviderKeys() {
  try {
    const raw = window.localStorage.getItem(VIDEO_PROVIDER_KEYS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeVideoProviderKey(providerId, patch) {
  const keys = readVideoProviderKeys();
  const current = keys[providerId] && typeof keys[providerId] === "object" ? keys[providerId] : {};
  const next = { ...current, ...patch };
  for (const field of ["apiKey", "secretKey", "baseUrl"]) {
    if (typeof next[field] !== "string" || !next[field].trim()) {
      delete next[field];
    } else {
      next[field] = next[field].trim();
    }
  }
  if (Object.keys(next).length) {
    keys[providerId] = next;
  } else {
    delete keys[providerId];
  }
  try {
    window.localStorage.setItem(VIDEO_PROVIDER_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* persistence is best-effort */
  }
  return keys;
}

export function videoProviderAuth(providerId) {
  const entry = readVideoProviderKeys()[providerId] || {};
  return {
    apiKey: typeof entry.apiKey === "string" ? entry.apiKey : "",
    secretKey: typeof entry.secretKey === "string" ? entry.secretKey : "",
    baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : "",
  };
}

export function videoProviderKeyReady(providerId) {
  const provider = getVideoProvider(providerId);
  const auth = videoProviderAuth(providerId);
  if (!provider) {
    return false;
  }
  if (!auth.apiKey) {
    return false;
  }
  return provider.requiresSecretKey ? Boolean(auth.secretKey) : true;
}
