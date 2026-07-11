const MAX_VOICE_RULE_ENTRIES = 500;
const MAX_VOICE_PHRASE_CHARS = 160;
const MAX_VOICE_EXPANSION_CHARS = 32000;
const MAX_VOICE_DICTIONARY_LISTS = 50;
const MAX_VOICE_DICTIONARY_TERMS = 400;
const MAX_VOICE_DICTIONARY_TERM_CHARS = 64;
const MAX_VOICE_DICTIONARY_NAME_CHARS = 80;

export const DEFAULT_VOICE_DICTIONARY_LIST_ID = "default-programmer-vocabulary";

export const DEFAULT_VOICE_DICTIONARY_TERMS = Object.freeze([
  "Diff Forge AI",
  "Diff Forge Cloud",
  "Diff Forge",
  "Rust client",
  "token",
  "tokens",
  "tokenomics",
  "model context",
  "context window",
  "workspace",
  "workspaces",
  "terminal",
  "terminals",
  "session",
  "sessions",
  "orchestrator",
  "client",
  "server",
  "webview",
  "clipboard",
  "transcript",
  "dictation",
  "snippet",
  "snippets",
  "transform",
  "transforms",
  "dictionary",
  "Codex",
  "OpenAI",
  "ChatGPT",
  "GPT",
  "GPT-5",
  "Claude",
  "Anthropic",
  "Gemini",
  "Copilot",
  "GitHub Copilot",
  "Hugging Face",
  "AI",
  "generative AI",
  "LLM",
  "LLMs",
  "large language model",
  "AI model",
  "foundation model",
  "agent",
  "agents",
  "subagent",
  "subagents",
  "AI agent",
  "agentic AI",
  "MCP",
  "Model Context Protocol",
  "RAG",
  "embedding",
  "embeddings",
  "vector database",
  "prompt",
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "SQL",
  "Go",
  "React",
  "Next.js",
  "Vue.js",
  "Nuxt",
  "Angular",
  "Svelte",
  "SvelteKit",
  "Astro",
  "Remix",
  "SolidJS",
  "Qwik",
  "Node.js",
  "Express",
  "Fastify",
  "NestJS",
  "Hono",
  "tRPC",
  "GraphQL",
  "Apollo",
  "Django",
  "Flask",
  "FastAPI",
  "Pydantic",
  "SQLAlchemy",
  "Spring Boot",
  "ASP.NET Core",
  ".NET",
  "Laravel",
  "Symfony",
  "Ruby on Rails",
  "Rails",
  "Phoenix",
  "Gin",
  "Echo",
  "Fiber",
  "React Native",
  "Flutter",
  "SwiftUI",
  "Electron",
  "Vite",
  "Tailwind CSS",
  "Bootstrap",
  "Prisma",
  "Drizzle",
  "Deepgram",
  "Whisper",
  "retrieval augmented generation",
  "multi-agent",
  "vector store",
  "vector search",
  "system prompt",
  "prompt engineering",
  "tool calling",
  "function calling",
  "inference",
  "fine-tuning",
  "evals",
  "tokenizer",
  "input tokens",
  "output tokens",
  "hallucination",
  "guardrails",
  "LangChain",
  "LangGraph",
  "LlamaIndex",
  "Transformers",
  "PyTorch",
  "TensorFlow",
  "JAX",
  "ONNX",
  "CUDA",
  "Ollama",
  "vLLM",
  "llama.cpp",
  "HTML",
  "CSS",
  "Java",
  "C#",
  "C++",
  "PHP",
  "Ruby",
  "Kotlin",
  "Swift",
  "Bash",
  "Shell",
  "Markdown",
  "SQLite",
  "PostgreSQL",
  "Postgres",
  "MySQL",
  "MongoDB",
  "Redis",
  "Elasticsearch",
  "OpenSearch",
  "Supabase",
  "Firebase",
  "Cloudflare",
  "Vercel",
  "Netlify",
  "AWS",
  "Azure",
  "Google Cloud",
  "GCP",
  "Docker",
  "Docker Compose",
  "Kubernetes",
  "Terraform",
  "GitHub",
  "GitHub Actions",
  "Git",
  "API",
  "REST API",
  "CLI",
  "SDK",
  "npm",
  "pnpm",
  "Yarn",
  "Bun",
  "Deno",
  "JSON",
  "YAML",
  "TOML",
  "XML",
  "HTTP",
  "HTTPS",
  "WebSocket",
  "OAuth",
  "JWT",
  "UUID",
  "URL",
  "URI",
  "CI/CD",
  "macOS",
  "frontend",
  "backend",
  "full stack",
  "middleware",
  "database",
  "schema",
  "migration",
  "cache",
  "queue",
  "worker",
  "runtime",
  "repository",
  "branch",
  "commit",
  "merge",
  "pull request",
  "diff",
  "patch",
]);

export const EMPTY_VOICE_TEXT_RULES = Object.freeze({
  dictionary: [],
  snippets: [],
  transforms: [],
});

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

function normalizeDictionaryTerms(terms) {
  const seen = new Set();
  const normalized = [];

  for (const term of Array.isArray(terms) ? terms : []) {
    const cleaned = cleanRuleText(term, MAX_VOICE_DICTIONARY_TERM_CHARS);
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(cleaned);
    if (normalized.length >= MAX_VOICE_DICTIONARY_TERMS) {
      break;
    }
  }

  return normalized;
}

function defaultVoiceDictionaryList() {
  return {
    id: DEFAULT_VOICE_DICTIONARY_LIST_ID,
    name: "Programmer vocabulary",
    terms: normalizeDictionaryTerms(DEFAULT_VOICE_DICTIONARY_TERMS),
    selected: true,
  };
}

function ensureDefaultVoiceDictionaryList(dictionary) {
  if (dictionary.some((list) => list.id === DEFAULT_VOICE_DICTIONARY_LIST_ID)) {
    return dictionary;
  }

  if (dictionary.length >= MAX_VOICE_DICTIONARY_LISTS) {
    return dictionary;
  }

  return [...dictionary, defaultVoiceDictionaryList()];
}

/**
 * Splits pasted text into dictionary terms: comma or newline separated,
 * trimmed, deduplicated case-insensitively, and capped.
 */
export function parseDictionaryTerms(value) {
  return normalizeDictionaryTerms(String(value ?? "").split(/[\n,]+/));
}

export function normalizeVoiceTextRules(value) {
  const source = value && typeof value === "object" ? value : {};

  const legacyTerms = [];
  const dictionary = [];
  (Array.isArray(source.dictionary) ? source.dictionary : []).forEach((list, index) => {
    const name = cleanRuleText(list?.name, MAX_VOICE_DICTIONARY_NAME_CHARS);
    const terms = normalizeDictionaryTerms(list?.terms);

    if (!name && !terms.length) {
      // Pre-lists dictionary entry: gather its phrase for migration.
      const phrase = cleanRuleText(list?.phrase, MAX_VOICE_DICTIONARY_TERM_CHARS);
      if (phrase && ruleEnabled(list?.enabled)) {
        legacyTerms.push(phrase);
      }
      return;
    }

    if (dictionary.length >= MAX_VOICE_DICTIONARY_LISTS) {
      return;
    }

    dictionary.push({
      id: cleanRuleId(list?.id, "list", index),
      name,
      terms,
      selected: ruleEnabled(list?.selected),
    });
  });

  if (legacyTerms.length && dictionary.length < MAX_VOICE_DICTIONARY_LISTS) {
    dictionary.push({
      id: "imported-legacy",
      name: "Imported",
      terms: normalizeDictionaryTerms(legacyTerms),
      selected: true,
    });
  }

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
        is_regex: entry?.is_regex === true,
        enabled: ruleEnabled(entry?.enabled),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VOICE_RULE_ENTRIES);

  return { dictionary: ensureDefaultVoiceDictionaryList(dictionary), snippets, transforms };
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
  const matches = [];
  const result = text.replace(pattern, (fullMatch, prefix, original, offset) => {
    replacements += 1;
    matches.push({
      index: Number(offset || 0) + String(prefix || "").length,
      original,
      replacement,
      trigger: phrase,
    });
    return `${prefix}${replacement}`;
  });

  return { text: result, replacements, matches };
}

function applyDictionaryCorrections(text, lists) {
  let nextText = text;
  let replacements = 0;
  const seen = new Set();

  for (const list of lists) {
    if (!list.selected) {
      continue;
    }

    for (const term of list.terms) {
      const key = term.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      // Re-cased exact matches: "tauri" spoken becomes "Tauri". Recognition
      // biasing itself happens upstream (Deepgram keyterms, Whisper prompt).
      const outcome = replaceSpokenPhrase(nextText, term, term);
      if (outcome.text !== nextText) {
        replacements += outcome.replacements;
        nextText = outcome.text;
      }
    }
  }

  return { text: nextText, replacements };
}

function applySnippetExpansions(text, entries) {
  let nextText = text;
  let replacements = 0;
  const changes = [];
  const ordered = entries
    .filter((entry) => entry.enabled)
    .slice()
    .sort((left, right) => right.trigger.length - left.trigger.length);

  for (const entry of ordered) {
    const outcome = replaceSpokenPhrase(nextText, entry.trigger, entry.expansion);
    nextText = outcome.text;
    replacements += outcome.replacements;
    changes.push(...outcome.matches);
  }

  return {
    text: nextText,
    replacements,
    changes: changes
      .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
      .map(({ index, ...change }) => change),
  };
}

function applyTransformRules(text, entries) {
  let nextText = text;
  let replacements = 0;

  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }

    if (entry.is_regex) {
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
 * Dictation post-processing in Wispr Flow order: dictionary word lists re-case
 * known terms first so snippet triggers and transform matches see the
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
    source_text: sourceText,
    changed: transformPass.text !== sourceText,
    counts: {
      dictionary: dictionaryPass.replacements,
      snippets: snippetPass.replacements,
      transforms: transformPass.replacements,
    },
    changes: {
      snippets: snippetPass.changes,
    },
  };
}
