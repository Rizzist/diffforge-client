const VOICE_TEXT_RULES_FILE: &str = "voice-text-rules.json";
const VOICE_TEXT_RULES_CHANGED_EVENT: &str = "forge-voice-text-rules-changed";
const VOICE_TEXT_RULES_MAX_ENTRIES: usize = 500;
const VOICE_TEXT_RULES_MAX_PHRASE_CHARS: usize = 160;
const VOICE_TEXT_RULES_MAX_EXPANSION_CHARS: usize = 32_000;
const VOICE_TEXT_RULES_MAX_TOTAL_BYTES: usize = 512 * 1024;
const VOICE_DICTIONARY_BIAS_TERM_LIMIT: usize = 64;
const VOICE_DICTIONARY_BIAS_TERM_CHARS: usize = 64;

fn voice_rule_default_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct VoiceDictionaryEntry {
    id: String,
    phrase: String,
    sounds_like: Vec<String>,
    #[serde(default = "voice_rule_default_enabled")]
    enabled: bool,
}

impl Default for VoiceDictionaryEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            phrase: String::new(),
            sounds_like: Vec::new(),
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
    dictionary: Vec<VoiceDictionaryEntry>,
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

fn normalize_voice_text_rules(rules: VoiceTextRules) -> VoiceTextRules {
    let dictionary = rules
        .dictionary
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let phrase = truncate_voice_rule_text(&entry.phrase, VOICE_TEXT_RULES_MAX_PHRASE_CHARS);
            if phrase.is_empty() {
                return None;
            }

            let sounds_like = entry
                .sounds_like
                .iter()
                .map(|alias| truncate_voice_rule_text(alias, VOICE_TEXT_RULES_MAX_PHRASE_CHARS))
                .filter(|alias| !alias.is_empty())
                .take(16)
                .collect::<Vec<_>>();

            Some(VoiceDictionaryEntry {
                id: normalized_voice_rule_id(&entry.id, "dict", index),
                phrase,
                sounds_like,
                enabled: entry.enabled,
            })
        })
        .take(VOICE_TEXT_RULES_MAX_ENTRIES)
        .collect::<Vec<_>>();

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

/// Enabled dictionary phrases used to bias speech recognition (Whisper initial
/// prompt and Deepgram keyterms). Capped so neither backend gets an oversized
/// vocabulary payload.
fn voice_dictionary_bias_terms(app: &AppHandle) -> Vec<String> {
    read_voice_text_rules(app)
        .dictionary
        .into_iter()
        .filter(|entry| entry.enabled)
        .map(|entry| truncate_voice_rule_text(&entry.phrase, VOICE_DICTIONARY_BIAS_TERM_CHARS))
        .filter(|phrase| !phrase.is_empty())
        .take(VOICE_DICTIONARY_BIAS_TERM_LIMIT)
        .collect()
}

fn voice_dictionary_whisper_prompt(app: &AppHandle) -> Option<String> {
    let terms = voice_dictionary_bias_terms(app);

    if terms.is_empty() {
        return None;
    }

    Some(format!("Glossary: {}.", terms.join(", ")))
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
    fn normalize_drops_empty_entries_and_trims() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: vec![
                VoiceDictionaryEntry {
                    phrase: "  Tauri  ".to_string(),
                    sounds_like: vec!["  towery ".to_string(), "   ".to_string()],
                    ..Default::default()
                },
                VoiceDictionaryEntry::default(),
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
        assert_eq!(rules.dictionary[0].phrase, "Tauri");
        assert_eq!(rules.dictionary[0].sounds_like, vec!["towery".to_string()]);
        assert!(rules.dictionary[0].enabled);
        assert!(!rules.dictionary[0].id.is_empty());
        assert_eq!(rules.snippets.len(), 1);
        assert_eq!(rules.snippets[0].trigger, "gstack");
        assert_eq!(rules.snippets[0].expansion, "full prompt");
        assert_eq!(rules.transforms.len(), 1);
        assert_eq!(rules.transforms[0].replacement, "\n");
    }

    #[test]
    fn normalize_caps_entry_counts_and_lengths() {
        let rules = normalize_voice_text_rules(VoiceTextRules {
            dictionary: (0..(VOICE_TEXT_RULES_MAX_ENTRIES + 20))
                .map(|index| VoiceDictionaryEntry {
                    phrase: format!("term-{index}{}", "x".repeat(400)),
                    ..Default::default()
                })
                .collect(),
            snippets: Vec::new(),
            transforms: Vec::new(),
        });

        assert_eq!(rules.dictionary.len(), VOICE_TEXT_RULES_MAX_ENTRIES);
        assert!(rules.dictionary[0].phrase.chars().count() <= VOICE_TEXT_RULES_MAX_PHRASE_CHARS);
    }

    #[test]
    fn rules_deserialize_with_enabled_defaulting_true() {
        let rules: VoiceTextRules = serde_json::from_str(
            r#"{
                "dictionary": [{ "phrase": "Tauri" }],
                "snippets": [{ "trigger": "gstack", "expansion": "do the thing" }],
                "transforms": [{ "match": "new line", "replacement": "\n" }]
            }"#,
        )
        .expect("rules parse");

        assert!(rules.dictionary[0].enabled);
        assert!(rules.snippets[0].enabled);
        assert!(rules.transforms[0].enabled);
        assert_eq!(rules.transforms[0].match_text, "new line");
    }

    #[test]
    fn percent_encoding_covers_query_unsafe_characters() {
        assert_eq!(percent_encode_query_component("Diff Forge"), "Diff%20Forge");
        assert_eq!(percent_encode_query_component("a&b=c"), "a%26b%3Dc");
        assert_eq!(percent_encode_query_component("safe-term_1.~"), "safe-term_1.~");
    }
}
