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
];

export const GENERATION_PROVIDER_LABEL = "Higgsfield";

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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
    caps: {
      durations: [4, 5, 8, 10, 12],
      defaultDuration: 5,
      aspectRatios: VIDEO_ASPECTS,
      resolutions: ["480p", "720p", "1080p"],
      supportsStartFrame: true,
      supportsEndFrame: true,
      maxReferenceImages: 4,
      supportsSound: false,
    },
    est: { usdPerSecond: 0.05 },
  },
  {
    id: "seedance-1.5-pro",
    kind: "video",
    jobType: "seedance_1_5_pro",
    displayName: "Seedance 1.5 Pro",
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    displayName: "GPT Image 2",
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
    disabled: true,
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
