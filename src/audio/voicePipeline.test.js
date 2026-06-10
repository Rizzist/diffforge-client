import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVoiceTextPipeline,
  normalizeVoiceTextRules,
} from "./voicePipeline.js";

test("dictionary aliases correct misheard words with word boundaries", () => {
  const result = applyVoiceTextPipeline("open the towery window in towerytown", {
    dictionary: [{ phrase: "Tauri", soundsLike: ["towery"] }],
  });

  assert.equal(result.text, "open the Tauri window in towerytown");
  assert.equal(result.counts.dictionary, 1);
  assert.equal(result.changed, true);
});

test("dictionary recases exact matches to the canonical spelling", () => {
  const result = applyVoiceTextPipeline("use tauri for the app", {
    dictionary: [{ phrase: "Tauri", soundsLike: [] }],
  });

  assert.equal(result.text, "use Tauri for the app");
});

test("snippets expand triggers case-insensitively, longest trigger first", () => {
  const result = applyVoiceTextPipeline("Gstack and gstack pro please", {
    snippets: [
      { trigger: "gstack", expansion: "[short prompt]" },
      { trigger: "gstack pro", expansion: "[long prompt]" },
    ],
  });

  assert.equal(result.text, "[short prompt] and [long prompt] please");
  assert.equal(result.counts.snippets, 2);
});

test("snippet expansions keep dollar signs literal", () => {
  const result = applyVoiceTextPipeline("pay gstack now", {
    snippets: [{ trigger: "gstack", expansion: "$100 & $200" }],
  });

  assert.equal(result.text, "pay $100 & $200 now");
});

test("transforms run in order and support literal replacements", () => {
  const result = applyVoiceTextPipeline("first point new line second point", {
    transforms: [
      { match: "new line", replacement: "\n" },
      { match: "point", replacement: "item" },
    ],
  });

  assert.equal(result.text, "first item \n second item");
  assert.equal(result.counts.transforms, 3);
});

test("regex transforms apply and invalid regex rules are skipped", () => {
  const result = applyVoiceTextPipeline("bug 123 and bug 456", {
    transforms: [
      { match: "bug (\\d+)", replacement: "BUG-$1", isRegex: true },
      { match: "([", replacement: "x", isRegex: true },
    ],
  });

  assert.equal(result.text, "BUG-123 and BUG-456");
});

test("dictionary corrections run before snippet expansion", () => {
  const result = applyVoiceTextPipeline("run jeestack now", {
    dictionary: [{ phrase: "gstack", soundsLike: ["jeestack"] }],
    snippets: [{ trigger: "gstack", expansion: "[the full prompt]" }],
  });

  assert.equal(result.text, "run [the full prompt] now");
});

test("disabled rules are ignored", () => {
  const result = applyVoiceTextPipeline("gstack towery", {
    dictionary: [{ phrase: "Tauri", soundsLike: ["towery"], enabled: false }],
    snippets: [{ trigger: "gstack", expansion: "nope", enabled: false }],
  });

  assert.equal(result.text, "gstack towery");
  assert.equal(result.changed, false);
});

test("normalize drops empty entries, trims, and defaults enabled true", () => {
  const rules = normalizeVoiceTextRules({
    dictionary: [{ phrase: "  Tauri  ", soundsLike: ["  towery ", " "] }, { phrase: " " }],
    snippets: [{ trigger: " gstack ", expansion: " prompt " }, { trigger: "x", expansion: "" }],
    transforms: [{ match: " new line ", replacement: "\n" }, { match: "" }],
  });

  assert.equal(rules.dictionary.length, 1);
  assert.deepEqual(rules.dictionary[0].soundsLike, ["towery"]);
  assert.equal(rules.dictionary[0].enabled, true);
  assert.ok(rules.dictionary[0].id);
  assert.equal(rules.snippets.length, 1);
  assert.equal(rules.snippets[0].trigger, "gstack");
  assert.equal(rules.transforms.length, 1);
  assert.equal(rules.transforms[0].match, "new line");
});

test("pipeline reports source text and handles empty rules", () => {
  const result = applyVoiceTextPipeline("hello there", null);

  assert.equal(result.text, "hello there");
  assert.equal(result.sourceText, "hello there");
  assert.equal(result.changed, false);
});
