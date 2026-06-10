export const EMPTY_VOICE_TEXT_RULES = Object.freeze({
  dictionary: [],
  snippets: [],
  transforms: [],
});

const MAX_VOICE_RULE_ENTRIES = 500;
const MAX_VOICE_PHRASE_CHARS = 160;
const MAX_VOICE_EXPANSION_CHARS = 32000;

function cleanRuleText(value, maxChars) {
  const text = String(value ?? "").trim();

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// Transform replacements keep intentional whitespace ("\n", "- ", ", ").
function capRuleText(value, maxChars) {
  const text = String(value ?? "");

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function cleanRuleId(value, prefix, index) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);

  return cleaned || `${prefix}-${Date.now()}-${index}`;
}

function ruleEnabled(value) {
  return value !== false;
}

export function normalizeVoiceTextRules(value) {
  const source = value && typeof value === "object" ? value : {};

  const dictionary = (Array.isArray(source.dictionary) ? source.dictionary : [])
    .map((entry, index) => {
      const phrase = cleanRuleText(entry?.phrase, MAX_VOICE_PHRASE_CHARS);
      if (!phrase) {
        return null;
      }

      const soundsLike = (Array.isArray(entry?.soundsLike) ? entry.soundsLike : [])
        .map((alias) => cleanRuleText(alias, MAX_VOICE_PHRASE_CHARS))
        .filter(Boolean)
        .slice(0, 16);

      return {
        id: cleanRuleId(entry?.id, "dict", index),
        phrase,
        soundsLike,
        enabled: ruleEnabled(entry?.enabled),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VOICE_RULE_ENTRIES);

  const snippets = (Array.isArray(source.snippets) ? source.snippets : [])
    .map((entry, index) => {
      const trigger = cleanRuleText(entry?.trigger, MAX_VOICE_PHRASE_CHARS);
      const expansion = cleanRuleText(entry?.expansion, MAX_VOICE_EXPANSION_CHARS);
      if (!trigger || !expansion) {
        return null;
      }

      return {
        id: cleanRuleId(entry?.id, "snippet", index),
        trigger,
        expansion,
        enabled: ruleEnabled(entry?.enabled),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VOICE_RULE_ENTRIES);

  const transforms = (Array.isArray(source.transforms) ? source.transforms : [])
    .map((entry, index) => {
      const match = cleanRuleText(entry?.match, MAX_VOICE_PHRASE_CHARS);
      if (!match) {
        return null;
      }

      return {
        id: cleanRuleId(entry?.id, "transform", index),
        match,
        replacement: capRuleText(entry?.replacement, MAX_VOICE_EXPANSION_CHARS),
        isRegex: entry?.isRegex === true,
        enabled: ruleEnabled(entry?.enabled),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VOICE_RULE_ENTRIES);

  return { dictionary, snippets, transforms };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordCharacter(character) {
  return /[A-Za-z0-9_]/.test(character || "");
}

/**
 * Word-boundary-guarded, case-insensitive literal replacement. The guard only
 * applies on sides of the phrase that start or end with a word character, so
 * punctuation-edged phrases still match. Replacement runs through a callback,
 * which keeps `$` sequences in user text literal.
 */
function replaceSpokenPhrase(text, phrase, replacement) {
  const prefixGuard = isWordCharacter(phrase[0]) ? "(^|[^A-Za-z0-9_])" : "()";
  const suffixGuard = isWordCharacter(phrase[phrase.length - 1])
    ? "(?=[^A-Za-z0-9_]|$)"
    : "";
  const pattern = new RegExp(
    `${prefixGuard}(${escapeRegExp(phrase)})${suffixGuard}`,
    "gi",
  );

  let replacements = 0;
  const result = text.replace(pattern, (fullMatch, prefix) => {
    replacements += 1;
    return `${prefix}${replacement}`;
  });

  return { text: result, replacements };
}

function applyDictionaryCorrections(text, entries) {
  let nextText = text;
  let replacements = 0;

  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }

    for (const alias of entry.soundsLike) {
      if (alias.toLowerCase() === entry.phrase.toLowerCase()) {
        continue;
      }

      const outcome = replaceSpokenPhrase(nextText, alias, entry.phrase);
      nextText = outcome.text;
      replacements += outcome.replacements;
    }

    // Re-cased exact matches: "tauri" spoken becomes "Tauri".
    const recased = replaceSpokenPhrase(nextText, entry.phrase, entry.phrase);
    nextText = recased.text;
  }

  return { text: nextText, replacements };
}

function applySnippetExpansions(text, entries) {
  let nextText = text;
  let replacements = 0;
  const ordered = entries
    .filter((entry) => entry.enabled)
    .slice()
    .sort((left, right) => right.trigger.length - left.trigger.length);

  for (const entry of ordered) {
    const outcome = replaceSpokenPhrase(nextText, entry.trigger, entry.expansion);
    nextText = outcome.text;
    replacements += outcome.replacements;
  }

  return { text: nextText, replacements };
}

function applyTransformRules(text, entries) {
  let nextText = text;
  let replacements = 0;

  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }

    if (entry.isRegex) {
      try {
        const pattern = new RegExp(entry.match, "gi");
        const before = nextText;
        nextText = nextText.replace(pattern, entry.replacement);
        if (nextText !== before) {
          replacements += 1;
        }
      } catch {
        // Invalid user regex rules are skipped rather than breaking dictation.
      }
      continue;
    }

    const outcome = replaceSpokenPhrase(nextText, entry.match, entry.replacement);
    nextText = outcome.text;
    replacements += outcome.replacements;
  }

  return { text: nextText, replacements };
}

/**
 * Dictation post-processing in Wispr Flow order: dictionary corrections fix
 * recognition errors first so snippet triggers and transform matches see the
 * corrected words, then snippets expand, then transforms reshape.
 */
export function applyVoiceTextPipeline(text, rules) {
  const sourceText = String(text ?? "");
  const normalized = normalizeVoiceTextRules(rules);

  const dictionaryPass = applyDictionaryCorrections(sourceText, normalized.dictionary);
  const snippetPass = applySnippetExpansions(dictionaryPass.text, normalized.snippets);
  const transformPass = applyTransformRules(snippetPass.text, normalized.transforms);

  return {
    text: transformPass.text,
    sourceText,
    changed: transformPass.text !== sourceText,
    counts: {
      dictionary: dictionaryPass.replacements,
      snippets: snippetPass.replacements,
      transforms: transformPass.replacements,
    },
  };
}
