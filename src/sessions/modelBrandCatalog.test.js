import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BRAND_FAMILIES, modelBrandFor } from "./modelBrandCatalog.js";

const brandSource = readFileSync(
  fileURLToPath(new URL("./modelBrand.jsx", import.meta.url)),
  "utf8",
);

test("modelBrandFor resolves each shipped family from a real model id", () => {
  const expected = {
    "gpt-5.7-codex": "openai",
    "claude-opus-4-8": "claude",
    "fable-5.1": "claude",
    "deepseek-v3.2": "deepseek",
    "gemini-2.5-pro": "gemini",
    "grok-4": "grok",
    "qwen3-max": "qwen",
    "kimi-k2": "kimi",
    "mistral-large": "mistral",
    "llama-4": "meta",
    "glm-4.6": "glm",
  };
  for (const [model, key] of Object.entries(expected)) {
    assert.equal(modelBrandFor(model, "")?.key, key, `model ${model} → ${key}`);
  }
});

test("modelBrandFor falls back to the provider id when the model is opaque", () => {
  assert.equal(modelBrandFor("", "anthropic")?.key, "claude");
  assert.equal(modelBrandFor("internal-alias", "openai")?.key, "openai");
  assert.equal(modelBrandFor("", "google")?.key, "gemini");
  assert.equal(modelBrandFor("", "xai")?.key, "grok");
});

test("modelBrandFor stays null for unknown families and the neutral harness provider", () => {
  // No family → <ModelBrandIcon> renders the neutral FallbackDot, never a crash.
  assert.equal(modelBrandFor("some-unlisted-model", ""), null);
  assert.equal(modelBrandFor("", ""), null);
  // "haider" is the local harness, not a model vendor — it must not borrow a brand.
  assert.equal(modelBrandFor("", "haider"), null);
});

test("every catalogue family is shaped for detection + rendering", () => {
  assert.ok(BRAND_FAMILIES.length >= 5);
  for (const family of BRAND_FAMILIES) {
    assert.ok(family.key && family.label, "family has key + label");
    assert.ok(Array.isArray(family.model) && family.model.length, "model tokens present");
    assert.ok(Array.isArray(family.provider) && family.provider.length, "provider tokens present");
  }
});

test("the four newly-wired brands keep a real glyph, not a letter tile", () => {
  // claude/deepseek/gemini/grok resolve AND modelBrand.jsx routes each to a
  // dedicated vendor glyph (not the LetterMark fallback). Guards against a
  // future edit silently demoting one of them to a letter tile.
  for (const key of ["openai", "claude", "deepseek", "gemini", "grok"]) {
    assert.match(
      brandSource,
      new RegExp(`case "${key}":`),
      `modelBrand.jsx routes ${key} to a real glyph`,
    );
  }
});

test("ModelBrandIcon renders the neutral fallback dot when no family resolves", () => {
  assert.match(
    brandSource,
    /if \(!family\)\s*\{\s*return <FallbackDot/,
    "unknown model → FallbackDot, no crash",
  );
});
