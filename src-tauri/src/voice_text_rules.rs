const VOICE_TEXT_RULES_FILE: &str = "voice-text-rules.json";
const VOICE_TEXT_RULES_CHANGED_EVENT: &str = "forge-voice-text-rules-changed";
const VOICE_TEXT_RULES_MAX_ENTRIES: usize = 500;
const VOICE_TEXT_RULES_MAX_PHRASE_CHARS: usize = 160;
const VOICE_TEXT_RULES_MAX_EXPANSION_CHARS: usize = 32_000;
const VOICE_TEXT_RULES_MAX_TOTAL_BYTES: usize = 512 * 1024;
const VOICE_DICTIONARY_MAX_LISTS: usize = 50;
const VOICE_DICTIONARY_MAX_TERMS_PER_LIST: usize = 400;
const VOICE_DICTIONARY_LIST_NAME_CHARS: usize = 80;
const VOICE_DICTIONARY_BIAS_TERM_LIMIT: usize = 100;
const VOICE_DICTIONARY_BIAS_TERM_CHARS: usize = 64;
const VOICE_DICTIONARY_WHISPER_PROMPT_CHARS: usize = 600;
const DEFAULT_VOICE_DICTIONARY_LIST_ID: &str = "default-programmer-vocabulary";
const DEFAULT_VOICE_DICTIONARY_LIST_NAME: &str = "Programmer vocabulary";
const DEFAULT_VOICE_DICTIONARY_TERMS: &[&str] = &[
    "Diff Forge AI",
    "Diff Forge Cloud",
    "Diff Forge",
    "DiffForge",
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
];

fn voice_rule_default_enabled() -> bool {
    true
}

/// A named word list. Terms from selected lists bias recognition on every
/// dictation backend: Deepgram keyterms (own key and via the cloud start
/// frame) and the local Whisper glossary prompt.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct VoiceDictionaryList {
    id: String,
    name: String,
    terms: Vec<String>,
    #[serde(default = "voice_rule_default_enabled")]
    selected: bool,
    /// Legacy single-phrase dictionary entry (pre-lists format). Read so old
    /// files migrate into one "Imported" list; never written back.
    #[serde(skip_serializing)]
    phrase: String,
    #[serde(skip_serializing, default = "voice_rule_default_enabled")]
    enabled: bool,
}

impl Default for VoiceDictionaryList {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            terms: Vec::new(),
            selected: true,
            phrase: String::new(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct VoiceSnippetEntry {
    id: String,
    trigger: String,
    expansion: String,
    #[serde(default = "voice_rule_default_enabled")]
    enabled: bool,
}

impl Default for VoiceSnippetEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            trigger: String::new(),
            expansion: String::new(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct VoiceTransformEntry {
    id: String,
    #[serde(rename = "match")]
    match_text: String,
    replacement: String,
    is_regex: bool,
    #[serde(default = "voice_rule_default_enabled")]
    enabled: bool,
}

impl Default for VoiceTransformEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            match_text: String::new(),
            replacement: String::new(),
            is_regex: false,
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct VoiceTextRules {
    dictionary: Vec<VoiceDictionaryList>,
    snippets: Vec<VoiceSnippetEntry>,
    transforms: Vec<VoiceTransformEntry>,
}

fn voice_text_rules_path(app: &AppHandle) -> Result<PathBuf, String> {
    device_data_path(
        app,
        Path::new(VOICE_TEXT_RULES_FILE),
        DeviceDataMigrationStrategy::PreferNewest,
    )
}

fn truncate_voice_rule_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();

    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    trimmed.chars().take(max_chars).collect()
}

/// Transform replacements keep intentional whitespace ("\n", "- ", ", ").
fn cap_voice_rule_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    value.chars().take(max_chars).collect()
}

fn normalized_voice_rule_id(id: &str, prefix: &str, index: usize) -> String {
    let cleaned = id
        .trim()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(64)
        .collect::<String>();

    if cleaned.is_empty() {
        format!("{prefix}-{}-{index}", current_time_ms())
    } else {
        cleaned
    }
}

fn normalize_voice_dictionary_terms(terms: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut normalized: Vec<String> = Vec::new();

    for term in terms {
        let cleaned = truncate_voice_rule_text(term, VOICE_DICTIONARY_BIAS_TERM_CHARS);
        if cleaned.is_empty() {
            continue;
        }

        let key = cleaned.to_lowercase();
        if seen.contains(&key) {
            continue;
        }

        seen.push(key);
        normalized.push(cleaned);
        if normalized.len() >= VOICE_DICTIONARY_MAX_TERMS_PER_LIST {
            break;
        }
    }

    normalized
}

fn default_voice_dictionary_list() -> VoiceDictionaryList {
    VoiceDictionaryList {
        id: DEFAULT_VOICE_DICTIONARY_LIST_ID.to_string(),
        name: DEFAULT_VOICE_DICTIONARY_LIST_NAME.to_string(),
        terms: normalize_voice_dictionary_terms(
            &DEFAULT_VOICE_DICTIONARY_TERMS
                .iter()
                .map(|term| (*term).to_string())
                .collect::<Vec<_>>(),
        ),
        selected: true,
        ..Default::default()
    }
}

fn ensure_default_voice_dictionary_list(dictionary: &mut Vec<VoiceDictionaryList>) {
    if dictionary
        .iter()
        .any(|list| list.id == DEFAULT_VOICE_DICTIONARY_LIST_ID)
    {
        return;
    }

    if dictionary.len() >= VOICE_DICTIONARY_MAX_LISTS {
        return;
    }

    dictionary.push(default_voice_dictionary_list());
}

fn normalize_voice_text_rules(rules: VoiceTextRules) -> VoiceTextRules {
    let mut legacy_terms: Vec<String> = Vec::new();
    let mut dictionary: Vec<VoiceDictionaryList> = Vec::new();

    for (index, list) in rules.dictionary.into_iter().enumerate() {
        let name = truncate_voice_rule_text(&list.name, VOICE_DICTIONARY_LIST_NAME_CHARS);
        let terms = normalize_voice_dictionary_terms(&list.terms);

        if name.is_empty() && terms.is_empty() {
            // Pre-lists dictionary entry: gather its phrase for migration.
            if list.enabled {
                let phrase =
                    truncate_voice_rule_text(&list.phrase, VOICE_DICTIONARY_BIAS_TERM_CHARS);
                if !phrase.is_empty() {
                    legacy_terms.push(phrase);
                }
            }
            continue;
        }

        if dictionary.len() >= VOICE_DICTIONARY_MAX_LISTS {
            continue;
        }

        dictionary.push(VoiceDictionaryList {
            id: normalized_voice_rule_id(&list.id, "list", index),
            name,
            terms,
            selected: list.selected,
            ..Default::default()
        });
    }

    if !legacy_terms.is_empty() && dictionary.len() < VOICE_DICTIONARY_MAX_LISTS {
        dictionary.push(VoiceDictionaryList {
            id: "imported-legacy".to_string(),
            name: "Imported".to_string(),
            terms: normalize_voice_dictionary_terms(&legacy_terms),
            selected: true,
            ..Default::default()
        });
    }

    ensure_default_voice_dictionary_list(&mut dictionary);

    let snippets = rules
        .snippets
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let trigger = truncate_voice_rule_text(&entry.trigger, VOICE_TEXT_RULES_MAX_PHRASE_CHARS);
            let expansion =
                truncate_voice_rule_text(&entry.expansion, VOICE_TEXT_RULES_MAX_EXPANSION_CHARS);
            if trigger.is_empty() || expansion.is_empty() {
                return None;
            }

            Some(VoiceSnippetEntry {
                id: normalized_voice_rule_id(&entry.id, "snippet", index),
                trigger,
                expansion,
                enabled: entry.enabled,
            })
        })
        .take(VOICE_TEXT_RULES_MAX_ENTRIES)
        .collect::<Vec<_>>();

    let transforms = rules
        .transforms
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let match_text =
                truncate_voice_rule_text(&entry.match_text, VOICE_TEXT_RULES_MAX_PHRASE_CHARS);
            if match_text.is_empty() {
                return None;
            }

            Some(VoiceTransformEntry {
                id: normalized_voice_rule_id(&entry.id, "transform", index),
                match_text,
                replacement: cap_voice_rule_text(
                    &entry.replacement,
                    VOICE_TEXT_RULES_MAX_EXPANSION_CHARS,
                ),
                is_regex: entry.is_regex,
                enabled: entry.enabled,
            })
        })
        .take(VOICE_TEXT_RULES_MAX_ENTRIES)
        .collect::<Vec<_>>();

    VoiceTextRules {
        dictionary,
        snippets,
        transforms,
    }
}

fn voice_text_rules_map_persisted_keys(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| voice_text_rules_map_persisted_keys(item, to_runtime))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, item)| {
                    let mapped = if to_runtime && key == "isRegex" {
                        "is_regex".to_string()
                    } else if !to_runtime && key == "is_regex" {
                        "isRegex".to_string()
                    } else {
                        key
                    };
                    (mapped, voice_text_rules_map_persisted_keys(item, to_runtime))
                })
                .collect(),
        ),
        other => other,
    }
}

fn read_voice_text_rules(app: &AppHandle) -> VoiceTextRules {
    let Ok(path) = voice_text_rules_path(app) else {
        return normalize_voice_text_rules(VoiceTextRules::default());
    };

    let Ok(contents) = fs::read_to_string(path) else {
        return normalize_voice_text_rules(VoiceTextRules::default());
    };

    serde_json::from_str::<Value>(&contents)
        .map(|value| voice_text_rules_map_persisted_keys(value, true))
        .and_then(serde_json::from_value::<VoiceTextRules>)
        .map(normalize_voice_text_rules)
        .unwrap_or_else(|_| normalize_voice_text_rules(VoiceTextRules::default()))
}

fn write_voice_text_rules(app: &AppHandle, rules: &VoiceTextRules) -> Result<(), String> {
    let path = voice_text_rules_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to save voice text rules: {error}"))?;
    }

    let persisted = serde_json::to_value(rules)
        .map(|value| voice_text_rules_map_persisted_keys(value, false))
        .map_err(|error| format!("Unable to save voice text rules: {error}"))?;
    let contents = serde_json::to_string_pretty(&persisted)
        .map_err(|error| format!("Unable to save voice text rules: {error}"))?;

    if contents.len() > VOICE_TEXT_RULES_MAX_TOTAL_BYTES {
        return Err("Voice dictionary, snippets, and transforms are limited to 512 KB total.".to_string());
    }

    fs::write(path, contents).map_err(|error| format!("Unable to save voice text rules: {error}"))
}

fn push_voice_bias_term(seen: &mut Vec<String>, terms: &mut Vec<String>, value: &str) -> bool {
    let cleaned = truncate_voice_rule_text(value, VOICE_DICTIONARY_BIAS_TERM_CHARS);
    if cleaned.is_empty() {
        return false;
    }

    let key = cleaned.to_lowercase();
    if seen.contains(&key) {
        return false;
    }

    seen.push(key);
    terms.push(cleaned);
    terms.len() >= VOICE_DICTIONARY_BIAS_TERM_LIMIT
}

/// Recognition bias terms, used for Whisper's initial prompt, own-key Deepgram
/// keyterms, and the cloud dictation start frame, which forwards them to
/// Deepgram server-side. Includes selected dictionary terms plus enabled
/// snippet triggers, but never snippet expansions.
/// Deduplicated case-insensitively in UI order and capped so no backend gets an
/// oversized vocabulary payload.
fn voice_dictionary_bias_terms_from_rules(rules: &VoiceTextRules) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut terms: Vec<String> = Vec::new();

    for list in &rules.dictionary {
        if !list.selected {
            continue;
        }

        for term in &list.terms {
            if push_voice_bias_term(&mut seen, &mut terms, term) {
                return terms;
            }
        }
    }

    for snippet in &rules.snippets {
        if !snippet.enabled {
            continue;
        }

        if push_voice_bias_term(&mut seen, &mut terms, &snippet.trigger) {
            return terms;
        }
    }

    terms
}

fn voice_dictionary_bias_terms(app: &AppHandle) -> Vec<String> {
    voice_dictionary_bias_terms_from_rules(&read_voice_text_rules(app))
}

/// Whisper has no keyterm boosting; the closest equivalent is seeding the
/// decoder with a glossary prompt. Budgeted by characters so the prompt stays
/// well under the model's ~224-token prompt window.
fn voice_dictionary_whisper_prompt(app: &AppHandle) -> Option<String> {
    let terms = voice_dictionary_bias_terms(app);
    let mut joined = String::new();

    for term in terms {
        let separator_chars = if joined.is_empty() { 0 } else { 2 };
        if joined.chars().count() + separator_chars + term.chars().count()
            > VOICE_DICTIONARY_WHISPER_PROMPT_CHARS
        {
            break;
        }

        if !joined.is_empty() {
            joined.push_str(", ");
        }
        joined.push_str(&term);
    }

    if joined.is_empty() {
        return None;
    }

    Some(format!("Glossary: {joined}."))
}

fn percent_encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 3);

    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }

    encoded
}

#[tauri::command(rename_all = "snake_case")]
async fn voice_text_rules_get(app: AppHandle) -> Result<VoiceTextRules, String> {
    Ok(read_voice_text_rules(&app))
}

#[tauri::command(rename_all = "snake_case")]
async fn voice_text_rules_set(
    app: AppHandle,
    rules: VoiceTextRules,
) -> Result<VoiceTextRules, String> {
    let normalized = normalize_voice_text_rules(rules);
    write_voice_text_rules(&app, &normalized)?;
    let _ = app.emit(VOICE_TEXT_RULES_CHANGED_EVENT, &normalized);
    Ok(normalized)
}

#[cfg(test)]
mod voice_text_rules_tests {
    use super::*;

    #[test]
    fn normalize_trims_lists_and_dedupes_terms() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: vec![
                VoiceDictionaryList {
                    name: "  Project jargon  ".to_string(),
                    terms: vec![
                        "  Tauri ".to_string(),
                        "tauri".to_string(),
                        "Deepgram".to_string(),
                        "   ".to_string(),
                    ],
                    ..Default::default()
                },
                VoiceDictionaryList::default(),
            ],
            snippets: vec![
                VoiceSnippetEntry {
                    trigger: " gstack ".to_string(),
                    expansion: " full prompt ".to_string(),
                    ..Default::default()
                },
                VoiceSnippetEntry {
                    trigger: "orphan".to_string(),
                    expansion: String::new(),
                    ..Default::default()
                },
            ],
            transforms: vec![VoiceTransformEntry {
                match_text: "new line".to_string(),
                replacement: "\n".to_string(),
                ..Default::default()
            }],
        });

        let project = rules
            .dictionary
            .iter()
            .find(|list| list.name == "Project jargon")
            .expect("project dictionary exists");
        let defaults = rules
            .dictionary
            .iter()
            .find(|list| list.id == DEFAULT_VOICE_DICTIONARY_LIST_ID)
            .expect("default dictionary exists");
        assert_eq!(rules.dictionary.len(), 2);
        assert_eq!(
            project.terms,
            vec!["Tauri".to_string(), "Deepgram".to_string()]
        );
        assert!(project.selected);
        assert!(!project.id.is_empty());
        assert_eq!(defaults.name, DEFAULT_VOICE_DICTIONARY_LIST_NAME);
        assert!(defaults.selected);
        assert_eq!(rules.snippets.len(), 1);
        assert_eq!(rules.snippets[0].trigger, "gstack");
        assert_eq!(rules.snippets[0].expansion, "full prompt");
        assert_eq!(rules.transforms.len(), 1);
        assert_eq!(rules.transforms[0].replacement, "\n");
    }

    #[test]
    fn normalize_caps_list_counts_and_term_lengths() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: (0..(VOICE_DICTIONARY_MAX_LISTS + 20))
                .map(|index| VoiceDictionaryList {
                    name: format!("List {index}"),
                    terms: (0..(VOICE_DICTIONARY_MAX_TERMS_PER_LIST + 50))
                        .map(|term| format!("term-{term}{}", "x".repeat(100)))
                        .collect(),
                    ..Default::default()
                })
                .collect(),
            snippets: Vec::new(),
            transforms: Vec::new(),
        });

        assert_eq!(rules.dictionary.len(), VOICE_DICTIONARY_MAX_LISTS);
        assert_eq!(
            rules.dictionary[0].terms.len(),
            VOICE_DICTIONARY_MAX_TERMS_PER_LIST
        );
        assert!(
            rules.dictionary[0].terms[0].chars().count() <= VOICE_DICTIONARY_BIAS_TERM_CHARS
        );
    }

    #[test]
    fn legacy_phrase_entries_migrate_into_one_imported_list() {
        let rules: VoiceTextRules = serde_json::from_str(
            r#"{
                "dictionary": [
                    { "phrase": "Tauri", "soundsLike": ["towery"] },
                    { "phrase": "Deepgram" },
                    { "phrase": "Skipped", "enabled": false }
                ],
                "snippets": [],
                "transforms": []
            }"#,
        )
        .expect("rules parse");
        let rules = normalize_voice_text_rules(rules);

        let imported = rules
            .dictionary
            .iter()
            .find(|list| list.name == "Imported")
            .expect("imported dictionary exists");
        let defaults = rules
            .dictionary
            .iter()
            .find(|list| list.id == DEFAULT_VOICE_DICTIONARY_LIST_ID)
            .expect("default dictionary exists");
        assert_eq!(rules.dictionary.len(), 2);
        assert_eq!(
            imported.terms,
            vec!["Tauri".to_string(), "Deepgram".to_string()]
        );
        assert!(imported.selected);
        assert_eq!(defaults.name, DEFAULT_VOICE_DICTIONARY_LIST_NAME);
        assert!(defaults.selected);
    }

    #[test]
    fn rules_deserialize_with_selected_and_enabled_defaulting_true() {
        let rules: VoiceTextRules = serde_json::from_str(
            r#"{
                "dictionary": [{ "name": "Jargon", "terms": ["Tauri"] }],
                "snippets": [{ "trigger": "gstack", "expansion": "do the thing" }],
                "transforms": [{ "match": "new line", "replacement": "\n" }]
            }"#,
        )
        .expect("rules parse");

        assert!(rules.dictionary[0].selected);
        assert!(rules.snippets[0].enabled);
        assert!(rules.transforms[0].enabled);
        assert_eq!(rules.transforms[0].match_text, "new line");
    }

    #[test]
    fn bias_terms_include_selected_dictionary_terms_and_enabled_snippet_triggers_only() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: vec![
                VoiceDictionaryList {
                    name: "Selected".to_string(),
                    terms: vec!["Tauri".to_string(), "GStack".to_string()],
                    selected: true,
                    ..Default::default()
                },
                VoiceDictionaryList {
                    name: "Parked".to_string(),
                    terms: vec!["Skipped".to_string()],
                    selected: false,
                    ..Default::default()
                },
                VoiceDictionaryList {
                    id: DEFAULT_VOICE_DICTIONARY_LIST_ID.to_string(),
                    name: DEFAULT_VOICE_DICTIONARY_LIST_NAME.to_string(),
                    terms: DEFAULT_VOICE_DICTIONARY_TERMS
                        .iter()
                        .map(|term| (*term).to_string())
                        .collect(),
                    selected: false,
                    ..Default::default()
                },
            ],
            snippets: vec![
                VoiceSnippetEntry {
                    trigger: "gstack".to_string(),
                    expansion: "duplicate trigger expansion should not appear".to_string(),
                    enabled: true,
                    ..Default::default()
                },
                VoiceSnippetEntry {
                    trigger: "shipit".to_string(),
                    expansion: "snippet expansion should not appear".to_string(),
                    enabled: true,
                    ..Default::default()
                },
                VoiceSnippetEntry {
                    trigger: "disabled-trigger".to_string(),
                    expansion: "disabled expansion should not appear".to_string(),
                    enabled: false,
                    ..Default::default()
                },
            ],
            transforms: Vec::new(),
        });

        let terms = voice_dictionary_bias_terms_from_rules(&rules);

        assert_eq!(
            terms,
            vec![
                "Tauri".to_string(),
                "GStack".to_string(),
                "shipit".to_string()
            ]
        );
        assert!(!terms.contains(&"Skipped".to_string()));
        assert!(!terms.contains(&"snippet expansion should not appear".to_string()));
        assert!(!terms.contains(&"disabled-trigger".to_string()));
    }

    #[test]
    fn serialized_lists_omit_legacy_fields() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: vec![VoiceDictionaryList {
                name: "Jargon".to_string(),
                terms: vec!["Tauri".to_string()],
                ..Default::default()
            }],
            snippets: Vec::new(),
            transforms: Vec::new(),
        });
        let json = serde_json::to_string(&rules).expect("rules serialize");

        assert!(json.contains("\"terms\""));
        assert!(json.contains("\"selected\""));
        assert!(!json.contains("\"phrase\""));
        // Snippets and transforms are empty, so any "enabled" key would have
        // leaked from the dictionary list's skipped legacy field.
        assert!(!json.contains("\"enabled\""));
    }

    #[test]
    fn default_programmer_dictionary_is_selected_and_not_duplicated() {
        let rules = normalize_voice_text_rules(VoiceTextRules::default());
        let renormalized = normalize_voice_text_rules(rules.clone());

        assert_eq!(rules.dictionary.len(), 1);
        assert_eq!(rules.dictionary[0].id, DEFAULT_VOICE_DICTIONARY_LIST_ID);
        assert_eq!(rules.dictionary[0].name, DEFAULT_VOICE_DICTIONARY_LIST_NAME);
        assert!(rules.dictionary[0].selected);
        assert!(rules.dictionary[0]
            .terms
            .contains(&"Diff Forge AI".to_string()));
        assert!(rules.dictionary[0]
            .terms
            .contains(&"tokenomics".to_string()));
        assert_eq!(
            renormalized
                .dictionary
                .iter()
                .filter(|list| list.id == DEFAULT_VOICE_DICTIONARY_LIST_ID)
                .count(),
            1
        );
    }

    #[test]
    fn percent_encoding_covers_query_unsafe_characters() {
        assert_eq!(percent_encode_query_component("Diff Forge"), "Diff%20Forge");
        assert_eq!(percent_encode_query_component("a&b=c"), "a%26b%3Dc");
        assert_eq!(percent_encode_query_component("safe-term_1.~"), "safe-term_1.~");
    }
}
