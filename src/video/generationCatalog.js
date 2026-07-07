// Generation model catalog — palmier-style capability descriptors drive the
// entire Generate form and the per-asset Upscale options. Generation runs
// through cloud-diffforge (provider keys live server-side); `jobType` is the
// provider-routing id the cloud's model table understands.
//
// Cloud env keys: HIGGSFIELD_CREDENTIALS ("KEY_ID:KEY_SECRET"), FAL_API_KEY,
// TOPAZ_API_KEY, REPLICATE_API_TOKEN.

export const GENERATION_KINDS = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "code", label: "Code" },
];

export const GENERATION_PROVIDER_LABEL = "Higgsfield";

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
    id: "higgsfield-dop-turbo",
    kind: "video",
    jobType: "higgsfield_dop_turbo",
    direct: { providerId: "higgsfield", model: "dop-turbo" },
    displayName: "DoP Turbo",
    description: "Fast image-to-video camera motion",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.08 },
  },
  {
    id: "higgsfield-dop-standard",
    kind: "video",
    jobType: "higgsfield_dop_standard",
    direct: { providerId: "higgsfield", model: "dop-standard" },
    displayName: "DoP Standard",
    description: "Higher-quality image-to-video motion",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.1 },
  },
  {
    id: "higgsfield-dop-lite",
    kind: "video",
    jobType: "higgsfield_dop_lite",
    direct: { providerId: "higgsfield", model: "dop-lite" },
    displayName: "DoP Lite",
    description: "Preview image-to-video motion",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "kling-v2.5-turbo-pro-text",
    kind: "video",
    jobType: "kling_v2_5_turbo_pro_text_to_video",
    direct: { providerId: "higgsfield", model: "kling-video/v2.5-turbo/pro/text-to-video" },
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
    direct: { providerId: "higgsfield", model: "kling-video/v2.5-turbo/pro/image-to-video" },
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
    displayName: "Kling 3.0",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
      modes: ["pro", "std"],
    },
    est: { usdPerSecond: 0.09 },
  },
  {
    id: "kling-3.0-turbo",
    kind: "video",
    jobType: "kling3_0_turbo",
    displayName: "Kling 3.0 Turbo",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "kling-2.6",
    kind: "video",
    jobType: "kling2_6",
    displayName: "Kling 2.6",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.04 },
  },
  {
    id: "seedance-2.0",
    kind: "video",
    jobType: "seedance_2_0",
    displayName: "Seedance 2.0",
    description: "Multimodal, native audio (via fal)",
    caps: {
      durations: [4, 5, 8, 10, 12, 15],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      // fal caps: 720p for start-frame runs, 1080p with references only.
      resolutions: ["480p", "720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 4,
      supportsSound: true,
    },
    // fal standard tier ≈ $0.30/s at 720p.
    est: { usdPerSecond: 0.30 },
  },
  {
    id: "seedance-1.5-pro",
    kind: "video",
    jobType: "seedance_1_5_pro",
    displayName: "Seedance 1.5 Pro",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["480p", "720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.04 },
  },
  {
    id: "veo-3.1",
    kind: "video",
    jobType: "veo3_1",
    displayName: "Veo 3.1",
    caps: {
      durations: [4, 6, 8],
      defaultDuration: 8,
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p"],
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
    displayName: "Veo 3.1 Lite",
    caps: {
      durations: [4, 6, 8],
      defaultDuration: 8,
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 3,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.15 },
  },
  {
    id: "wan-2.7",
    kind: "video",
    jobType: "wan2_7",
    displayName: "Wan 2.7",
    caps: {
      durations: [5, 10],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "minimax-hailuo",
    kind: "video",
    jobType: "minimax_hailuo",
    displayName: "MiniMax Hailuo",
    caps: {
      durations: [6, 10],
      defaultDuration: 6,
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.045 },
  },
  {
    id: "grok-video-1.5",
    kind: "video",
    jobType: "grok_video_1_5",
    displayName: "Grok Video 1.5",
    caps: {
      durations: [6],
      defaultDuration: 6,
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p"],
      supportsStartFrame: true,
      supportsEndFrame: false,
      maxReferenceImages: 0,
      supportsSound: true,
    },
    est: { usdPerSecond: 0.05 },
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
    id: "seedream-v4",
    kind: "image",
    jobType: "seedream_v4_text_to_image",
    displayName: "Seedream 4",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1K", "2K", "4K"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "seedream-v4-edit",
    kind: "image",
    jobType: "seedream_v4_edit",
    displayName: "Seedream 4 Edit",
    description: "Edit an existing image with instructions",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1K", "2K", "4K"],
      maxImages: 1,
      maxReferenceImages: 1,
      requiresReferenceImage: true,
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
    id: "nano-banana-pro",
    kind: "image",
    jobType: "nano_banana_pro",
    displayName: "Nano Banana Pro",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1k", "2k", "4k"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.14 },
  },
  {
    id: "nano-banana-2",
    kind: "image",
    jobType: "nano_banana_2",
    displayName: "Nano Banana 2",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1k", "2k"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "flux-2",
    kind: "image",
    jobType: "flux_2",
    displayName: "FLUX.2",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1k", "2k"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.05 },
  },
  {
    id: "flux-kontext",
    kind: "image",
    jobType: "flux_kontext",
    displayName: "FLUX Kontext",
    description: "Edit an existing image with instructions",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 1,
      maxReferenceImages: 1,
      requiresReferenceImage: true,
    },
    est: { usdPerImage: 0.06 },
  },
  {
    id: "gpt-image-2",
    kind: "image",
    jobType: "gpt_image_2",
    direct: { providerId: "gpt-image-2", model: "gpt-image-2" },
    displayName: "GPT Image 2",
    caps: {
      aspectRatios: ["1:1", "3:2", "2:3"],
      qualities: ["low", "medium", "high"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.08 },
  },
  {
    id: "soul-v2",
    kind: "image",
    jobType: "text2image_soul_v2",
    displayName: "Soul V2",
    description: "Higgsfield's photorealistic portrait model",
    caps: {
      aspectRatios: ["1:1", "3:4"],
      qualities: ["standard", "hd"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.05 },
  },
  {
    id: "seedream-4.5",
    kind: "image",
    jobType: "seedream_v4_5",
    displayName: "Seedream 4.5",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["2k", "4k"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.04 },
  },
  {
    id: "seedream-v5-lite",
    kind: "image",
    jobType: "seedream_v5_lite",
    displayName: "Seedream V5 Lite",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      resolutions: ["1k", "2k"],
      maxImages: 4,
      maxReferenceImages: 4,
    },
    est: { usdPerImage: 0.02 },
  },
  {
    id: "grok-image",
    kind: "image",
    jobType: "grok_image",
    displayName: "Grok Image",
    caps: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxImages: 4,
      maxReferenceImages: 0,
    },
    est: { usdPerImage: 0.03 },
  },
  {
    id: "recraft-v4.1",
    kind: "image",
    jobType: "recraft_v4_1",
    displayName: "Recraft V4.1",
    caps: {
      aspectRatios: IMAGE_ASPECTS,
      maxImages: 4,
      maxReferenceImages: 1,
    },
    est: { usdPerImage: 0.04 },
  },

  // --- Speak: photo + voice audio → talking video (audio-input flagship) ---
  {
    id: "higgsfield-speak",
    kind: "video",
    jobType: "higgsfield_speak",
    displayName: "Higgsfield Speak",
    description: "Photo + voice audio → talking video",
    caps: {
      supportsStartFrame: true,
      requiresStartFrame: true,
      requiresInputAudio: true,
      maxReferenceImages: 0,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.1 },
  },

  // --- Audio (Higgsfield platform) ---
  {
    id: "text-to-speech",
    kind: "audio",
    jobType: "text2speech_v2",
    displayName: "Text to Speech",
    description: "Narration in a chosen voice",
    caps: {
      voices: ["elevenlabs", "minimax", "seed_speech", "vibe_voice", "cozy_voice"],
      promptLabel: "Text to speak",
    },
    est: { usdPerImage: 0.03 },
  },
  {
    id: "sonilo-music",
    kind: "audio",
    jobType: "sonilo_music",
    displayName: "Sonilo Music",
    description: "Music from a text brief",
    caps: {
      durations: [10, 20, 30, 60],
      defaultDuration: 20,
      promptLabel: "Describe the music",
    },
    est: { usdPerSecond: 0.01 },
  },
  {
    id: "mirelo-sfx",
    kind: "audio",
    jobType: "mirelo_sfx",
    displayName: "Mirelo SFX",
    description: "Sound effects from a description",
    caps: {
      durations: [5, 10, 15],
      defaultDuration: 10,
      promptLabel: "Describe the sound",
    },
    est: { usdPerSecond: 0.015 },
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

export function getGenerationModel(id) {
  return GENERATION_MODELS.find((model) => model.id === id) || null;
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
  kling3_0: { perSecond: 9 },
  kling3_0_turbo: { perSecond: 6 },
  kling2_6: { perSecond: 7 },
  seedance_2_0: { perSecond: 30 },
  seedance_1_5_pro: { perSecond: 7 },
  veo3_1: { perSecond: 12 },
  veo3_1_lite: { perSecond: 7 },
  wan2_7: { perSecond: 7 },
  minimax_hailuo: { perSecond: 7 },
  grok_video_1_5: { perSecond: 9 },
  higgsfield_dop_lite: { perSecond: 5 },
  higgsfield_dop_turbo: { perSecond: 8 },
  higgsfield_dop_standard: { perSecond: 10 },
  kling_v2_5_turbo_pro_text_to_video: { perSecond: 8 },
  kling_v2_5_turbo_pro_image_to_video: { perSecond: 8 },
  kling_v2_1_pro_image_to_video: { perSecond: 8 },
  seedance_v1_pro_image_to_video: { perSecond: 8 },
  higgsfield_speak: { perSecond: 8 },
  // Image (credits per output image)
  nano_banana_pro: { perImage: 24 },
  nano_banana_2: { perImage: 18 },
  flux_2: { perImage: 18 },
  higgsfield_soul_standard: { perImage: 16 },
  reve_text_to_image: { perImage: 16 },
  seedream_v4_text_to_image: { perImage: 18 },
  seedream_v4_edit: { perImage: 18 },
  flux_kontext: { perImage: 18 },
  gpt_image_2: { perImage: 18 },
  text2image_soul_v2: { perImage: 16 },
  seedream_v4_5: { perImage: 18 },
  seedream_v5_lite: { perImage: 12 },
  grok_image: { perImage: 18 },
  recraft_v4_1: { perImage: 16 },
  // Audio
  text2speech_v2: { perGeneration: 8 },
  sonilo_music: { perSecond: 3 },
  mirelo_sfx: { perSecond: 2 },
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
