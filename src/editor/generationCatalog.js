// Client-side generation model catalog (Phase 1: static).
//
// The Generation panel renders its form generically from `params`, so adding or
// changing models is data-only. In Phase 2 this static list is swapped for a model
// list fetched from the cloud (same shape), and the stub generate is replaced by a
// real Rust -> cloud job. Param `type`s the form renderer understands:
//   text | enum | int | image | imageList
// Optional per-param flags: required, advanced, unit, placeholder, rows,
//   modes (only show for these capability modes), min/max (int).

export const GEN_CAPABILITY_LABELS = {
  "text-to-video": "Text → Video",
  "image-to-video": "Image → Video",
  "text-to-image": "Text → Image",
};

export const GENERATION_MODELS = [
  {
    id: "seedance-2",
    label: "Seedance 2",
    provider: "ByteDance",
    capabilities: ["text-to-video", "image-to-video"],
    params: [
      { key: "prompt", type: "text", label: "Prompt", required: true, rows: 3, placeholder: "Describe the shot…" },
      { key: "negativePrompt", type: "text", label: "Negative prompt", rows: 2, advanced: true },
      { key: "startImage", type: "image", label: "Start frame", modes: ["image-to-video"], required: true },
      { key: "duration", type: "enum", label: "Duration", values: [4, 6, 8, 10], default: 6, unit: "s" },
      { key: "aspect", type: "enum", label: "Aspect", values: ["16:9", "9:16", "1:1"], default: "16:9" },
      { key: "resolution", type: "enum", label: "Resolution", values: ["720p", "1080p"], default: "1080p" },
      { key: "seed", type: "int", label: "Seed", min: 0, max: 2147483647, advanced: true },
    ],
  },
  {
    id: "kling-v3",
    label: "Kling V3",
    provider: "Kuaishou",
    capabilities: ["text-to-video", "image-to-video"],
    params: [
      { key: "prompt", type: "text", label: "Prompt", required: true, rows: 3, placeholder: "Describe the shot…" },
      { key: "negativePrompt", type: "text", label: "Negative prompt", rows: 2, advanced: true },
      { key: "startImage", type: "image", label: "Start frame", modes: ["image-to-video"], required: true },
      { key: "references", type: "imageList", label: "References", max: 4, advanced: true },
      { key: "duration", type: "enum", label: "Duration", values: [5, 10], default: 5, unit: "s" },
      { key: "aspect", type: "enum", label: "Aspect", values: ["16:9", "9:16", "1:1"], default: "16:9" },
      { key: "resolution", type: "enum", label: "Resolution", values: ["720p", "1080p"], default: "1080p" },
      { key: "seed", type: "int", label: "Seed", min: 0, max: 2147483647, advanced: true },
    ],
  },
  {
    id: "veo-3",
    label: "Veo 3",
    provider: "Google",
    capabilities: ["text-to-video", "image-to-video"],
    params: [
      { key: "prompt", type: "text", label: "Prompt", required: true, rows: 3, placeholder: "Describe the shot…" },
      { key: "startImage", type: "image", label: "Start frame", modes: ["image-to-video"], required: true },
      { key: "duration", type: "enum", label: "Duration", values: [4, 8], default: 8, unit: "s" },
      { key: "aspect", type: "enum", label: "Aspect", values: ["16:9", "9:16"], default: "16:9" },
      { key: "resolution", type: "enum", label: "Resolution", values: ["720p", "1080p"], default: "1080p" },
      { key: "seed", type: "int", label: "Seed", min: 0, max: 2147483647, advanced: true },
    ],
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    provider: "Google",
    capabilities: ["text-to-image"],
    params: [
      { key: "prompt", type: "text", label: "Prompt", required: true, rows: 3, placeholder: "Describe the image…" },
      { key: "references", type: "imageList", label: "Reference images", max: 4 },
      { key: "aspect", type: "enum", label: "Aspect", values: ["1:1", "16:9", "9:16", "4:3"], default: "1:1" },
      { key: "resolution", type: "enum", label: "Resolution", values: ["1K", "2K", "4K"], default: "2K" },
      { key: "seed", type: "int", label: "Seed", min: 0, max: 2147483647, advanced: true },
    ],
  },
];

export function getGenerationModel(id) {
  return GENERATION_MODELS.find((model) => model.id === id) || GENERATION_MODELS[0];
}

// Params visible for the current capability mode (a param with `modes` only shows
// when the active mode is listed).
export function visibleParams(model, mode) {
  if (!model) {
    return [];
  }
  return model.params.filter((param) => !param.modes || param.modes.includes(mode));
}

// Default value object for a model+mode (only for visible params).
export function defaultValuesFor(model, mode) {
  const values = {};
  for (const param of visibleParams(model, mode)) {
    if (param.type === "enum") {
      values[param.key] = param.default ?? param.values?.[0];
    } else if (param.type === "imageList") {
      values[param.key] = [];
    } else if (param.type === "image") {
      values[param.key] = null;
    } else if (param.type === "int") {
      values[param.key] = "";
    } else {
      values[param.key] = "";
    }
  }
  return values;
}

// Carry compatible values across a model/mode switch, filling new defaults.
export function reconcileValues(model, mode, prev) {
  const defaults = defaultValuesFor(model, mode);
  const next = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (prev && prev[key] !== undefined && prev[key] !== null && prev[key] !== "") {
      next[key] = prev[key];
    }
  }
  return next;
}

// Client-side validation; returns { ok, errors: { [key]: message } }.
export function validateGeneration(model, mode, values) {
  const errors = {};
  for (const param of visibleParams(model, mode)) {
    if (!param.required) {
      continue;
    }
    const value = values?.[param.key];
    if (param.type === "image") {
      if (!value) {
        errors[param.key] = `${param.label} is required`;
      }
    } else if (typeof value === "string" && !value.trim()) {
      errors[param.key] = `${param.label} is required`;
    } else if (value == null) {
      errors[param.key] = `${param.label} is required`;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
