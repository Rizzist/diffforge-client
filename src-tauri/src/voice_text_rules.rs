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

fn voice_rule_default_enabled() -> bool {
    true
}

/// A named word list. Terms from selected lists bias recognition on every
/// dictation backend: Deepgram keyterms (own key and via the cloud start
/// frame) and the local Whisper glossary prompt.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
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
#[serde(rename_all = "camelCase", default)]
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
#[serde(rename_all = "camelCase", default)]
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
#[serde(rename_all = "camelCase", default)]
struct VoiceTextRules {
    dictionary: Vec<VoiceDictionaryList>,
    snippets: Vec<VoiceSnippetEntry>,
    transforms: Vec<VoiceTransformEntry>,
}

fn voice_text_rules_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(VOICE_TEXT_RULES_FILE))
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

fn read_voice_text_rules(app: &AppHandle) -> VoiceTextRules {
    let Ok(path) = voice_text_rules_path(app) else {
        return VoiceTextRules::default();
    };

    let Ok(contents) = fs::read_to_string(path) else {
        return VoiceTextRules::default();
    };

    serde_json::from_str::<VoiceTextRules>(&contents)
        .map(normalize_voice_text_rules)
        .unwrap_or_default()
}

fn write_voice_text_rules(app: &AppHandle, rules: &VoiceTextRules) -> Result<(), String> {
    let path = voice_text_rules_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to save voice text rules: {error}"))?;
    }

    let contents = serde_json::to_string_pretty(rules)
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

#[tauri::command]
async fn voice_text_rules_get(app: AppHandle) -> Result<VoiceTextRules, String> {
    Ok(read_voice_text_rules(&app))
}

#[tauri::command]
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

        assert_eq!(rules.dictionary.len(), 1);
        assert_eq!(rules.dictionary[0].name, "Project jargon");
        assert_eq!(
            rules.dictionary[0].terms,
            vec!["Tauri".to_string(), "Deepgram".to_string()]
        );
        assert!(rules.dictionary[0].selected);
        assert!(!rules.dictionary[0].id.is_empty());
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

        assert_eq!(rules.dictionary.len(), 1);
        assert_eq!(rules.dictionary[0].name, "Imported");
        assert_eq!(
            rules.dictionary[0].terms,
            vec!["Tauri".to_string(), "Deepgram".to_string()]
        );
        assert!(rules.dictionary[0].selected);
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
    fn percent_encoding_covers_query_unsafe_characters() {
        assert_eq!(percent_encode_query_component("Diff Forge"), "Diff%20Forge");
        assert_eq!(percent_encode_query_component("a&b=c"), "a%26b%3Dc");
        assert_eq!(percent_encode_query_component("safe-term_1.~"), "safe-term_1.~");
    }
}
