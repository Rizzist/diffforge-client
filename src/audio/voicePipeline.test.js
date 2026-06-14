import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VOICE_DICTIONARY_LIST_ID,
  applyVoiceTextPipeline,
  normalizeVoiceTextRules,
  parseDictionaryTerms,
} from "./voicePipeline.js";

test("dictionary recases exact matches with word boundaries", () => {
  const result = applyVoiceTextPipeline("use tauri in tauritown", {
    dictionary: [{ name: "Jargon", terms: ["Tauri"] }],
  });

  assert.equal(result.text, "use Tauri in tauritown");
  assert.equal(result.counts.dictionary, 1);
  assert.equal(result.changed, true);
});

test("unselected dictionary lists are ignored", () => {
  const result = applyVoiceTextPipeline("use foobar and bazqux", {
    dictionary: [
      { name: "Active", terms: ["BazQux"] },
      { name: "Parked", terms: ["FooBar"], selected: false },
    ],
  });

  assert.equal(result.text, "use foobar and BazQux");
});

test("parseDictionaryTerms splits pasted text and dedupes case-insensitively", () => {
  const terms = parseDictionaryTerms("Tauri, deepgram\n tauri ,, Diff Forge\n\n");

  assert.deepEqual(terms, ["Tauri", "deepgram", "Diff Forge"]);
});

test("legacy phrase entries migrate into one imported list", () => {
  const rules = normalizeVoiceTextRules({
    dictionary: [
      { phrase: "Tauri", soundsLike: ["towery"] },
      { phrase: "Deepgram" },
      { phrase: "Skipped", enabled: false },
    ],
  });

  const imported = rules.dictionary.find((list) => list.name === "Imported");
  const defaults = rules.dictionary.find((list) => list.id === DEFAULT_VOICE_DICTIONARY_LIST_ID);
  assert.equal(rules.dictionary.length, 2);
  assert.deepEqual(imported?.terms, ["Tauri", "Deepgram"]);
  assert.equal(imported?.selected, true);
  assert.equal(defaults?.name, "Programmer vocabulary");
  assert.equal(defaults?.selected, true);
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
  assert.deepEqual(result.changes.snippets, [
    {
      original: "Gstack",
      replacement: "[short prompt]",
      trigger: "gstack",
    },
    {
      original: "gstack pro",
      replacement: "[long prompt]",
      trigger: "gstack pro",
    },
  ]);
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

test("dictionary recasing runs before snippet expansion", () => {
  const result = applyVoiceTextPipeline("run gstack now", {
    dictionary: [{ name: "Jargon", terms: ["GStack"] }],
    snippets: [{ trigger: "GStack", expansion: "[the full prompt]" }],
  });

  assert.equal(result.text, "run [the full prompt] now");
});

test("disabled rules are ignored", () => {
  const result = applyVoiceTextPipeline("gstack zedword", {
    dictionary: [{ name: "Parked", terms: ["ZedWord"], selected: false }],
    snippets: [{ trigger: "gstack", expansion: "nope", enabled: false }],
  });

  assert.equal(result.text, "gstack zedword");
  assert.equal(result.changed, false);
  assert.deepEqual(result.changes.snippets, []);
});

test("normalize drops empty entries, trims, and defaults selection true", () => {
  const rules = normalizeVoiceTextRules({
    dictionary: [
      { name: " Jargon ", terms: ["  Tauri ", " ", "tauri"] },
      { name: " ", terms: [] },
    ],
    snippets: [{ trigger: " gstack ", expansion: " prompt " }, { trigger: "x", expansion: "" }],
    transforms: [{ match: " new line ", replacement: "\n" }, { match: "" }],
  });

  const jargon = rules.dictionary.find((list) => list.name === "Jargon");
  const defaults = rules.dictionary.find((list) => list.id === DEFAULT_VOICE_DICTIONARY_LIST_ID);
  assert.equal(rules.dictionary.length, 2);
  assert.deepEqual(jargon?.terms, ["Tauri"]);
  assert.equal(jargon?.selected, true);
  assert.ok(jargon?.id);
  assert.equal(defaults?.name, "Programmer vocabulary");
  assert.equal(defaults?.selected, true);
  assert.equal(rules.snippets.length, 1);
  assert.equal(rules.snippets[0].trigger, "gstack");
  assert.equal(rules.transforms.length, 1);
  assert.equal(rules.transforms[0].match, "new line");
});

test("default programmer dictionary is selected and not duplicated", () => {
  const first = normalizeVoiceTextRules(null);
  const second = normalizeVoiceTextRules(first);

  assert.equal(first.dictionary.length, 1);
  assert.equal(first.dictionary[0].id, DEFAULT_VOICE_DICTIONARY_LIST_ID);
  assert.equal(first.dictionary[0].selected, true);
  assert.ok(first.dictionary[0].terms.includes("Diff Forge AI"));
  assert.ok(first.dictionary[0].terms.includes("tokenomics"));
  assert.equal(
    second.dictionary.filter((list) => list.id === DEFAULT_VOICE_DICTIONARY_LIST_ID).length,
    1,
  );
});

test("pipeline reports source text and handles empty rules", () => {
  const result = applyVoiceTextPipeline("hello there", null);

  assert.equal(result.text, "hello there");
  assert.equal(result.sourceText, "hello there");
  assert.equal(result.changed, false);
});
