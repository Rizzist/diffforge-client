// Generation model catalog — palmier-style capability descriptors drive the
// entire Generate form and the per-asset Upscale options. Generation runs
// through cloud-diffforge (provider keys live server-side); `jobType` is the
// provider-routing id the cloud's model table understands.
//
// Cloud env keys: HIGGSFIELD_CREDENTIALS ("KEY_ID:KEY_SECRET"), FAL_API_KEY,
// OPENAI_API_KEY, GEMINI_API_KEY, TOPAZ_API_KEY, REPLICATE_API_TOKEN.

export const GENERATION_KINDS = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "code", label: "Code" },
];

export const GENERATION_PROVIDER_LABEL = "Diff Forge Cloud";

// Where generations run. "cloud" bills Diff Forge credits (keys live
// server-side); "api" routes models with a `direct` mapping straight to the
// provider using the user's own key (videoProviders.js localStorage store).
export const GENERATION_ROUTING_STORAGE_KEY = "diffforge.video.genRouting";

export function readGenerationRouting() {
  try {
    const value = window.localStorage.getItem(GENERATION_ROUTING_STORAGE_KEY);
    return value === "cloud" || value === "api" ? value : "";
  } catch {
    return "";
  }
}

// Fired on this window whenever routing or auto-describe settings change, so
// live consumers (the auto-describe queue) react immediately instead of on
// the next unrelated media refresh. localStorage "storage" events only fire
// on OTHER windows, hence the explicit event.
export const GENERATION_SETTINGS_EVENT = "diffforge-video-gen-settings";

function emitGenerationSettingsChanged() {
  try {
    window.dispatchEvent(new Event(GENERATION_SETTINGS_EVENT));
  } catch {
    /* best-effort */
  }
}

export function writeGenerationRouting(mode) {
  try {
    window.localStorage.setItem(GENERATION_ROUTING_STORAGE_KEY, mode);
  } catch {
    /* best-effort */
  }
  emitGenerationSettingsChanged();
}

// Photo describe (cloud vision annotation). Typical low-detail gpt-4o-mini
// call settles around this many credits — display estimate only; actual
// billing is token-metered in cloud-diffforge src/media_description.rs.
export const DESCRIBE_CREDITS_ESTIMATE = 3;
// Credits floor under which auto-describe stays quiet instead of draining
// the last of a user's balance on background annotation.
export const AUTO_DESCRIBE_CREDITS_FLOOR = 50;

export const AUTO_DESCRIBE_STORAGE_KEY = "diffforge.video.autoDescribe";

export function readAutoDescribeEnabled() {
  try {
    return window.localStorage.getItem(AUTO_DESCRIBE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoDescribeEnabled(enabled) {
  try {
    window.localStorage.setItem(AUTO_DESCRIBE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* best-effort */
  }
  emitGenerationSettingsChanged();
}

const VIDEO_ASPECTS = ["16:9", "9:16", "1:1", "4:3"];
const IMAGE_ASPECTS = ["16:9", "9:16", "1:1", "3:4", "4:3", "2:3", "3:2"];

// KEEP IN SYNC with the Rust MCP catalog copy in
// src-tauri/src/video_editor.rs (video_mcp_generate "models" action).
export const GENERATION_MODELS = [
  // --- Video (Higgsfield platform) ---
  {
    id: "higgsfield-dop-standard",
    kind: "video",
    jobType: "higgsfield_dop_standard",
    direct: { providerId: "higgsfield", model: "higgsfield-ai/dop/standard" },
    displayName: "DoP Standard",
    description: "Higher-quality image-to-video motion",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.1 },
  },
  {
    id: "higgsfield-dop-lite",
    kind: "video",
    jobType: "higgsfield_dop_lite",
    direct: { providerId: "higgsfield", model: "higgsfield-ai/dop/preview" },
    displayName: "DoP Preview",
    description: "Preview image-to-video motion",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "kling-v2.5-turbo-pro-text",
    kind: "video",
    jobType: "kling_v2_5_turbo_pro_text_to_video",
    direct: { providerId: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video" },
    displayName: "Kling 2.5 Turbo Pro",
    description: "Text to video",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      supportsStartFrame: false,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.08 },
  },
  {
    id: "kling-v2.5-turbo-pro-image",
    kind: "video",
    jobType: "kling_v2_5_turbo_pro_image_to_video",
    direct: { providerId: "fal", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" },
    displayName: "Kling 2.5 Turbo Pro I2V",
    description: "Image to video",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.08 },
  },
  {
    id: "kling-v2.1-pro-image",
    kind: "video",
    jobType: "kling_v2_1_pro_image_to_video",
    direct: { providerId: "higgsfield", model: "kling-video/v2.1/pro/image-to-video" },
    displayName: "Kling 2.1 Pro I2V",
    description: "Image to video",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.08 },
  },
  {
    id: "seedance-v1-pro-image",
    kind: "video",
    jobType: "seedance_v1_pro_image_to_video",
    direct: { providerId: "higgsfield", model: "bytedance/seedance/v1/pro/image-to-video" },
    displayName: "Seedance v1 Pro I2V",
    description: "Image to video",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.08 },
  },
  {
    id: "kling-3.0",
    kind: "video",
    jobType: "kling3_0",
    direct: { providerId: "fal", model: "fal-ai/kling-video/v3/pro/text-to-video" },
    displayName: "Kling 3.0",
    caps: {
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      defaultDuration: 5,
      aspectRatios: ["16:9", "9:16", "1:1"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: true,
      modes: ["pro", "standard"],
    },
    est: { usdPerSecond: 0.112 },
  },
  {
    id: "kling-2.6",
    kind: "video",
    jobType: "kling2_6",
    direct: { providerId: "fal", model: "fal-ai/kling-video/v2.6/pro/text-to-video" },
    displayName: "Kling 2.6",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: ["16:9", "9:16", "1:1"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.14 },
  },
  {
    id: "seedance-2.0",
    kind: "video",
    jobType: "seedance_2_0",
    direct: { providerId: "fal", model: "bytedance/seedance-2.0/text-to-video" },
    displayName: "Seedance 2.0",
    description: "Multimodal, native audio (via fal)",
    caps: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      defaultDuration: 5,
      aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      resolutions: ["480p", "720p", "1080p", "4k"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 9,
      supportsSound: true,
    },
    // fal standard tier ≈ $0.30/s at 720p.
    est: { usdPerSecond: 0.30 },
  },
  {
    id: "seedance-1.5-pro",
    kind: "video",
    jobType: "seedance_1_5_pro",
    direct: { providerId: "fal", model: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video" },
    displayName: "Seedance 1.5 Pro",
    caps: {
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12],
      defaultDuration: 5,
      aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"],
      resolutions: ["480p", "720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.14 },
  },
  {
    id: "veo-3.1",
    kind: "video",
    jobType: "veo3_1",
    direct: { providerId: "fal", model: "fal-ai/veo3.1" },
    displayName: "Veo 3.1",
    caps: {
      durations: [4, 6, 8],
      defaultDuration: 8,
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p", "4k"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 3,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.4 },
  },
  {
    id: "veo-3.1-lite",
    kind: "video",
    jobType: "veo3_1_lite",
    direct: { providerId: "fal", model: "fal-ai/veo3.1/lite" },
    displayName: "Veo 3.1 Lite",
    caps: {
      durations: [4, 6, 8],
      defaultDuration: 8,
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.25 },
  },
  {
    id: "wan-2.7",
    kind: "video",
    jobType: "wan2_7",
    direct: { providerId: "fal", model: "fal-ai/wan/v2.7/text-to-video" },
    displayName: "Wan 2.7",
    caps: {
      durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      defaultDuration: 5,
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.15 },
  },
  {
    id: "minimax-hailuo",
    kind: "video",
    jobType: "minimax_hailuo",
    direct: { providerId: "fal", model: "fal-ai/minimax/hailuo-02/standard/text-to-video" },
    displayName: "MiniMax Hailuo",
    caps: {
      durations: [6, 10],
      defaultDuration: 6,
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.045 },
  },
  {
    id: "grok-video-1.5",
    kind: "video",
    jobType: "grok_video_1_5",
    direct: { providerId: "fal", model: "xai/grok-imagine-video/v1.5/image-to-video" },
    displayName: "Grok Imagine Video 1.5",
    caps: {
      durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      defaultDuration: 6,
      resolutions: ["480p", "720p", "1080p"],
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.12 },
  },

  // --- Image (Higgsfield platform) ---
  {
    id: "higgsfield-soul-standard",
    kind: "image",
    jobType: "higgsfield_soul_standard",
    displayName: "Soul Standard",
    description: "Photorealistic Higgsfield image model",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["2K", "4K"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.05 },
  },
  {
    id: "reve-text-to-image",
    kind: "image",
    jobType: "reve_text_to_image",
    displayName: "Reve",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "gpt-image-2",
    kind: "image",
    jobType: "gpt_image_2",
    direct: { providerId: "gpt-image-2", model: "gpt-image-2" },
    displayName: "GPT Image 2",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 10,
    },
    est: { usdPerImage: 0.08 },
  },
  {
    id: "nano-banana-pro",
    kind: "image",
    jobType: "nano_banana_pro",
    direct: { providerId: "nano-banana", model: "gemini-3-pro-image" },
    displayName: "Nano Banana Pro",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 8,
    },
    est: { usdPerImage: 0.10 },
  },
  {
    id: "nano-banana-2",
    kind: "image",
    jobType: "nano_banana_2",
    direct: { providerId: "nano-banana", model: "gemini-3.1-flash-image" },
    displayName: "Nano Banana 2",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 8,
    },
    est: { usdPerImage: 0.06 },
  },
  {
    id: "nano-banana-flash",
    kind: "image",
    jobType: "nano_banana_flash",
    direct: { providerId: "nano-banana", model: "gemini-2.5-flash-image" },
    displayName: "Nano Banana Flash",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 8,
    },
    est: { usdPerImage: 0.03 },
  },
  {
    id: "flux-2",
    kind: "image",
    jobType: "flux_2",
    direct: { providerId: "fal", model: "fal-ai/flux-2" },
    displayName: "FLUX.2",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "seedream-v4",
    kind: "image",
    jobType: "seedream_v4_text_to_image",
    direct: { providerId: "fal", model: "fal-ai/bytedance/seedream/v4/text-to-image" },
    displayName: "Seedream v4",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.06 },
  },
  {
    id: "seedream-v4-edit",
    kind: "image",
    jobType: "seedream_v4_edit",
    direct: { providerId: "fal", model: "fal-ai/bytedance/seedream/v4/edit" },
    displayName: "Seedream v4 Edit",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
      maxImages: 4,
      maxReferenceImages: 10,
      supportsStartFrame: true,
      requiresStartFrame: true,
    },
    est: { usdPerImage: 0.06 },
  },
  {
    id: "seedream-v4.5",
    kind: "image",
    jobType: "seedream_v4_5",
    direct: { providerId: "fal", model: "fal-ai/bytedance/seedream/v4.5/text-to-image" },
    displayName: "Seedream v4.5",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.07 },
  },
  {
    id: "seedream-v5-lite",
    kind: "image",
    jobType: "seedream_v5_lite",
    direct: { providerId: "fal", model: "fal-ai/bytedance/seedream/v5/lite/text-to-image" },
    displayName: "Seedream v5 Lite",
    caps: {
      resolutions: ["auto_2K", "auto_4K"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.05 },
  },
  {
    id: "recraft-v4.1",
    kind: "image",
    jobType: "recraft_v4_1",
    direct: { providerId: "fal", model: "fal-ai/recraft/v4.1/text-to-image" },
    displayName: "Recraft v4.1",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
      maxImages: 1,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "flux-kontext",
    kind: "image",
    jobType: "flux_kontext",
    direct: { providerId: "fal", model: "fal-ai/flux-pro/kontext" },
    displayName: "FLUX Kontext",
    caps: {
      maxImages: 1,
      maxReferenceImages: 1,
      supportsStartFrame: true,
      requiresStartFrame: true,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "mirelo-sfx",
    kind: "audio",
    jobType: "mirelo_sfx",
    direct: { providerId: "fal", model: "mirelo-ai/sfx-v1.5/video-to-audio" },
    displayName: "Mirelo SFX",
    description: "Video-conditioned sound effects",
    caps: {
      supportedTypes: ["video"],
      durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30],
      defaultDuration: 6,
      requiresSourceVideo: true,
      maxReferenceImages: 0,
    },
    est: { usdPerSecond: 0.04 },
  },
  // --- Code (local Hyperframes HTML render — no cloud cost) ---
  {
    id: "hyperframes",
    kind: "code",
    jobType: "hyperframes",
    displayName: "Hyperframes",
    description: "HTML composition rendered locally to mp4",
    caps: {
      twoPhase: true,
      localRender: true,
      durations: [5, 10, 15, 30],
      defaultDuration: 10,
      fpsOptions: [24, 30, 60],
      promptLabel: "Composition title",
    },
    est: {},
  },

  // --- Upscalers (three providers: fal.ai, Topaz Labs, Replicate) ---
  {
    id: "seedvr2-video-upscaler",
    kind: "upscale",
    jobType: "fal:fal-ai/seedvr/upscale/video",
    displayName: "SeedVR2 Video Upscaler",
    providerLabel: "fal.ai",
    caps: { supportedTypes: ["video"], speed: "Medium" },
    est: { usdPerSecond: 0.02 },
  },
  {
    id: "topaz-video-upscale",
    kind: "upscale",
    jobType: "topaz:video",
    displayName: "Topaz Video AI",
    providerLabel: "Topaz Labs",
    caps: { supportedTypes: ["video"], speed: "Slow" },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "esrgan-image-upscaler",
    kind: "upscale",
    jobType: "fal:fal-ai/esrgan",
    displayName: "ESRGAN Image Upscaler",
    providerLabel: "fal.ai",
    caps: { supportedTypes: ["image"], speed: "Fast" },
    est: { usdPerImage: 0.01 },
  },
  {
    id: "topaz-image-upscale",
    kind: "upscale",
    jobType: "topaz:image",
    displayName: "Topaz Image AI",
    providerLabel: "Topaz Labs",
    caps: { supportedTypes: ["image"], speed: "Medium" },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "real-esrgan-replicate",
    kind: "upscale",
    jobType: "replicate:nightmareai/real-esrgan",
    displayName: "Real-ESRGAN",
    providerLabel: "Replicate",
    caps: { supportedTypes: ["image"], speed: "Fast" },
    est: { usdPerImage: 0.005 },
  },
];

export function generationModels(kind) {
  return GENERATION_MODELS.filter((model) => model.kind === kind && !model.disabled);
}

const GENERATION_MODEL_ALIASES = {
  seedance1_5: "seedance_1_5_pro",
  grok_video_v15: "grok_video_1_5",
  "fal-ai/veo3.1/image-to-video": "veo3_1",
  "fal-ai/veo3.1/first-last-frame-to-video": "veo3_1",
  "fal-ai/veo3.1/reference-to-video": "veo3_1",
  "fal-ai/veo3.1/lite/image-to-video": "veo3_1_lite",
  "fal-ai/veo3.1/lite/first-last-frame-to-video": "veo3_1_lite",
  "bytedance/seedance-2.0/image-to-video": "seedance_2_0",
  "bytedance/seedance-2.0/reference-to-video": "seedance_2_0",
  "fal-ai/bytedance/seedance/v1.5/pro/image-to-video": "seedance_1_5_pro",
  "fal-ai/kling-video/v3/pro/image-to-video": "kling3_0",
  "fal-ai/kling-video/v3/standard/text-to-video": "kling3_0",
  "fal-ai/kling-video/v3/standard/image-to-video": "kling3_0",
  "fal-ai/kling-video/v2.6/pro/image-to-video": "kling2_6",
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": "kling_v2_5_turbo_pro_image_to_video",
  "fal-ai/wan/v2.7/image-to-video": "wan2_7",
  "fal-ai/minimax/hailuo-02/standard/image-to-video": "minimax_hailuo",
};

export function getGenerationModel(id) {
  const key = String(id || "").trim();
  const canonical = GENERATION_MODEL_ALIASES[key] || key;
  return (
    GENERATION_MODELS.find(
      (model) =>
        model.id === canonical
        || model.jobType === canonical
        || model.direct?.model === canonical,
    ) || null
  );
}

export function upscaleModelsFor(assetKind) {
  return GENERATION_MODELS.filter(
    (model) => model.kind === "upscale" && model.caps.supportedTypes?.includes(assetKind),
  );
}

// Cloud credit pricing — KEEP IN SYNC with cloud-diffforge
// src/media_generation.rs MEDIA_MODELS (credit_unit + credit_rate): the cloud
// is authoritative at capture time; these mirror it for pre-submit estimates.
// Keyed by the cloud model id (jobType for generation, catalog id for
// upscales — that's what each request sends as `model`).
const CLOUD_CREDIT_RATES = {
  // Video (credits per requested second)
  kling3_0: { perSecond: 12 },
  kling2_6: { perSecond: 14 },
  seedance_2_0: { perSecond: 30 },
  seedance_1_5_pro: { perSecond: 14 },
  veo3_1: { perSecond: 40 },
  veo3_1_lite: { perSecond: 25 },
  wan2_7: { perSecond: 10 },
  minimax_hailuo: { perSecond: 6 },
  grok_video_1_5: { perSecond: 12 },
  higgsfield_dop_lite: { perSecond: 5 },
  higgsfield_dop_standard: { perSecond: 10 },
  kling_v2_5_turbo_pro_text_to_video: { perSecond: 8 },
  kling_v2_5_turbo_pro_image_to_video: { perSecond: 8 },
  kling_v2_1_pro_image_to_video: { perSecond: 8 },
  seedance_v1_pro_image_to_video: { perSecond: 8 },
  // Image (credits per output image)
  higgsfield_soul_standard: { perImage: 16 },
  reve_text_to_image: { perImage: 16 },
  gpt_image_2: { perImage: 16 },
  nano_banana_pro: { perImage: 20 },
  nano_banana_2: { perImage: 12 },
  nano_banana_flash: { perImage: 8 },
  flux_2: { perImage: 8 },
  seedream_v4_text_to_image: { perImage: 12 },
  seedream_v4_edit: { perImage: 12 },
  seedream_v4_5: { perImage: 14 },
  seedream_v5_lite: { perImage: 10 },
  recraft_v4_1: { perImage: 8 },
  flux_kontext: { perImage: 8 },
  // Audio (credits per requested second)
  mirelo_sfx: { perSecond: 4 },
  // Upscalers (video per source second, image per image)
  "seedvr2-video-upscaler": { perSecond: 3 },
  "topaz-video-upscale": { perSecond: 4 },
  "esrgan-image-upscaler": { perImage: 8 },
  "topaz-image-upscale": { perImage: 10 },
  "real-esrgan-replicate": { perImage: 8 },
};

// Mirrors the cloud's estimated_credits(): ceil(units × rate), min 1 credit;
// duration clamps to 1–120s (5s default), image count to 1–16.
export function estimateModelCredits(model, { durationSec = 5, numImages = 1 } = {}) {
  const rate = CLOUD_CREDIT_RATES[model?.jobType] || CLOUD_CREDIT_RATES[model?.id];
  if (!rate) {
    return null;
  }
  if (rate.perSecond != null) {
    const seconds = Math.min(120, Math.max(1, Number(durationSec) || 5));
    return Math.max(1, Math.ceil(rate.perSecond * seconds));
  }
  if (rate.perImage != null) {
    const images = Math.min(16, Math.max(1, Number(numImages) || 1));
    return Math.max(1, Math.ceil(rate.perImage * images));
  }
  return Math.max(1, Math.ceil(rate.perGeneration || 1));
}

export function estimateModelUsd(model, { durationSec = 5, numImages = 1 } = {}) {
  if (!model) {
    return null;
  }
  if (model.est?.usdPerSecond != null) {
    return model.est.usdPerSecond * Math.max(1, durationSec);
  }
  if (model.est?.usdPerImage != null) {
    return model.est.usdPerImage * Math.max(1, numImages);
  }
  return null;
}

// "1080p" style class from pixel dimensions (library badges + upscale hints).
export function resolutionClass(width, height) {
  const h = Math.min(Number(width) || 0, Number(height) || 0);
  const w = Math.max(Number(width) || 0, Number(height) || 0);
  if (!h || !w) {
    return "";
  }
  if (h >= 2100 || w >= 3800) {
    return "4K";
  }
  if (h >= 1400 || w >= 2500) {
    return "2K";
  }
  if (h >= 1050) {
    return "1080p";
  }
  if (h >= 700) {
    return "720p";
  }
  if (h >= 470) {
    return "480p";
  }
  return `${Math.round(w)}×${Math.round(h)}`;
}
