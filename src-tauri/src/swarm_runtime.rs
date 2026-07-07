const SWARM_STATE_EVENT: &str = "diffforge://swarm-state";
const SWARM_RUN_EVENT: &str = "diffforge://swarm-run-event";
const SWARM_TAKE_SENTINEL: &str = "SWARM_TAKE_END";
const SWARM_PACK_SENTINEL: &str = "SWARM_PACK_END";
const SWARM_MAX_MEMBERS: usize = 5;
const SWARM_RUN_SUMMARY_LIMIT: usize = 50;
const SWARM_CONTEXT_PACK_TIMEOUT_SECS: u64 = 8 * 60;
const SWARM_TAKE_TIMEOUT_SECS: u64 = 15 * 60;
const SWARM_SYNTHESIS_TIMEOUT_SECS: u64 = 20 * 60;
const SWARM_VERIFY_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const SWARM_PROMPT_ACK_TIMEOUT_SECS: u64 = 8;
const SWARM_SPAWN_READY_MONITOR_SECS: u64 = 120;
const SWARM_IDLE_POLL_MS: u64 = 750;
const SWARM_MIN_IDLE_AFTER_PROMPT_MS: u64 = 5_000;
const SWARM_CAPTURE_MAX_CHARS: usize = 48_000;
const SWARM_PACK_CHAR_CAP: usize = 24_000;
const SWARM_TAKE_FUSE_CHAR_CAP: usize = 10_000;
const SWARM_FUSE_TOTAL_CHAR_CAP: usize = 40_000;
const SWARM_CONVERGENCE_JACCARD: f64 = 0.55;
const SWARM_PACK_REUSE_MAX_AGE_MS: u64 = 6 * 60 * 60 * 1000;
const SWARM_PACK_REUSE_OVERLAP: f64 = 0.45;
const SWARM_VERIFY_OUTPUT_TAIL_CHAR_CAP: usize = 8_000;
const SWARM_CONTEXT_PACK_BUILT_AT_PREFIX: &str = "<!-- diffforge-swarm-context-pack-built-at-ms:";
const SWARM_PACK_TRUNCATED_MARKER: &str = "[pack truncated at cap]";
const SWARM_TAKE_ELISION_MARKER: &str = "[… take elided …]";

#[derive(Clone)]
struct SwarmRuntimeState {
    swarms: Arc<RwLock<HashMap<String, Arc<Mutex<SwarmRuntimeData>>>>>,
    ledger_lock: Arc<Mutex<()>>,
}

impl SwarmRuntimeState {
    fn new() -> Self {
        Self {
            swarms: Arc::new(RwLock::new(HashMap::new())),
            ledger_lock: Arc::new(Mutex::new(())),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct MemberSpec {
    member_id: Option<String>,
    provider: String,
    model: Option<String>,
    label: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SwarmConfig {
    swarm_id: String,
    workspace_id: String,
    repo_path: String,
    champion_member_id: String,
    scout_member_id: String,
    verify_command: String,
    members: Vec<MemberSpec>,
    updated_at: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct MemberStats {
    takes_delivered: u64,
    champion_runs: u64,
    reaps: u64,
    errors: u64,
    scout_runs: u64,
}

#[derive(Clone)]
struct SwarmMemberRuntime {
    member_id: String,
    provider: String,
    model: String,
    label: String,
    pane_id: String,
    instance_id: Option<u64>,
    status: String,
    input_ready: bool,
    stats: MemberStats,
    last_activity_at: u64,
    last_error: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RunSummary {
    run_id: String,
    status: String,
    prompt: String,
    mode: String,
    started_at: u64,
    settled_at: u64,
    result_summary: String,
}

#[derive(Clone)]
struct SwarmRuntimeData {
    config: SwarmConfig,
    members: HashMap<String, SwarmMemberRuntime>,
    context_pack: Option<SwarmContextPackCache>,
    active_run_id: String,
    active_run_cancel: Option<Arc<AtomicBool>>,
    runs: Vec<RunSummary>,
}

#[derive(Clone)]
struct SwarmMemberRef {
    member_id: String,
    provider: String,
    pane_id: String,
    instance_id: u64,
}

#[derive(Clone)]
struct SwarmTakeResult {
    member_id: String,
    text: String,
}

#[derive(Clone)]
struct SwarmContextPackCache {
    at: u64,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextPackSummary {
    at: u64,
    chars: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberState {
    member_id: String,
    provider: String,
    model: String,
    label: String,
    pane_id: String,
    status: String,
    input_ready: bool,
    score: i64,
    stats: MemberStats,
    last_activity_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwarmState {
    swarm_id: String,
    workspace_id: String,
    repo_path: String,
    champion_member_id: String,
    scout_member_id: String,
    verify_command: String,
    context_pack: Value,
    members: Vec<MemberState>,
    active_run_id: String,
    runs: Vec<RunSummary>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwarmRunEvent {
    seq: u64,
    run_id: String,
    at: u64,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    member_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwarmSubmitTaskResult {
    run_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwarmRunEventsResult {
    events: Vec<SwarmRunEvent>,
    latest_seq: u64,
}

fn swarm_key(workspace_id: &str, swarm_id: &str) -> String {
    format!("{workspace_id}\n{swarm_id}")
}

fn swarm_safe_component(value: &str) -> String {
    let safe = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    if safe.is_empty() {
        "default".to_string()
    } else {
        safe
    }
}

fn swarm_root_dir() -> Result<PathBuf, String> {
    cloud_mcp_local_data_file_path("swarm")
        .ok_or_else(|| "Unable to resolve the local swarm data directory.".to_string())
}

fn swarm_workspace_dir(workspace_id: &str) -> Result<PathBuf, String> {
    Ok(swarm_root_dir()?.join(swarm_safe_component(workspace_id)))
}

fn swarm_dir(workspace_id: &str, swarm_id: &str) -> Result<PathBuf, String> {
    Ok(swarm_workspace_dir(workspace_id)?.join(swarm_safe_component(swarm_id)))
}

fn swarm_config_path(workspace_id: &str, swarm_id: &str) -> Result<PathBuf, String> {
    Ok(swarm_dir(workspace_id, swarm_id)?.join("config.json"))
}

fn swarm_context_pack_path(workspace_id: &str, swarm_id: &str) -> Result<PathBuf, String> {
    Ok(swarm_dir(workspace_id, swarm_id)?.join("context-pack.md"))
}

fn swarm_runs_dir(workspace_id: &str, swarm_id: &str) -> Result<PathBuf, String> {
    Ok(swarm_dir(workspace_id, swarm_id)?.join("runs"))
}

fn swarm_run_ledger_path(
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    Ok(swarm_runs_dir(workspace_id, swarm_id)?
        .join(format!("{}.jsonl", swarm_safe_component(run_id))))
}

fn swarm_now_ms() -> u64 {
    terminal_now_ms()
}

fn swarm_system_time_ms(value: std::time::SystemTime) -> u64 {
    value
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn swarm_member_score(stats: &MemberStats) -> i64 {
    (2 * stats.champion_runs as i64) + stats.takes_delivered as i64
        - stats.reaps as i64
        - stats.errors as i64
}

fn swarm_provider_cost_rank(provider: &str) -> u8 {
    match provider {
        "opencode" => 0,
        "codex" => 1,
        "claude" => 2,
        _ => 9,
    }
}

fn swarm_normalize_provider(provider: &str) -> Result<String, String> {
    let normalized = provider
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    match normalized.as_str() {
        "codex" | "claude" | "opencode" => Ok(normalized),
        _ => Err("Swarm member provider must be codex, claude, or opencode.".to_string()),
    }
}

fn swarm_default_member_label(provider: &str) -> String {
    match provider {
        "codex" => "Codex",
        "claude" => "Claude",
        "opencode" => "OpenCode",
        _ => "Agent",
    }
    .to_string()
}

fn swarm_pane_id(swarm_id: &str, member_id: &str) -> String {
    format!("swarm:{swarm_id}:{member_id}")
}

fn swarm_trim_text(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn swarm_char_count(text: &str) -> usize {
    text.chars().count()
}

fn swarm_byte_index_after_chars(text: &str, char_count: usize) -> usize {
    if char_count == 0 {
        return 0;
    }
    text.char_indices()
        .nth(char_count)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn swarm_prefix_on_line_boundary(text: &str, cap: usize) -> String {
    if swarm_char_count(text) <= cap {
        return text.to_string();
    }
    let hard_cut = swarm_byte_index_after_chars(text, cap);
    let candidate = &text[..hard_cut];
    if let Some(index) = candidate.rfind('\n') {
        if index > 0 {
            return candidate[..index].trim_end().to_string();
        }
    }
    candidate.trim_end().to_string()
}

fn swarm_suffix_on_line_boundary(text: &str, cap: usize) -> String {
    let total = swarm_char_count(text);
    if total <= cap {
        return text.to_string();
    }
    let hard_cut = swarm_byte_index_after_chars(text, total.saturating_sub(cap));
    let candidate = &text[hard_cut..];
    if let Some(index) = candidate.find('\n') {
        if index + 1 < candidate.len() {
            return candidate[index + 1..].trim_start().to_string();
        }
    }
    candidate.trim_start().to_string()
}

fn swarm_tail_chars(text: &str, cap: usize) -> String {
    let total = swarm_char_count(text);
    if total <= cap {
        return text.to_string();
    }
    let start = swarm_byte_index_after_chars(text, total.saturating_sub(cap));
    text[start..].to_string()
}

fn swarm_truncate_pack_to_cap(text: &str) -> String {
    let text = text.trim();
    if swarm_char_count(text) <= SWARM_PACK_CHAR_CAP {
        return text.to_string();
    }
    let marker_chars = swarm_char_count(SWARM_PACK_TRUNCATED_MARKER) + 1;
    let content_cap = SWARM_PACK_CHAR_CAP.saturating_sub(marker_chars);
    let truncated = swarm_prefix_on_line_boundary(text, content_cap);
    format!("{}\n{}", truncated.trim_end(), SWARM_PACK_TRUNCATED_MARKER)
}

fn swarm_trim_take_for_fuse_with_cap(text: &str, cap: usize) -> String {
    if swarm_char_count(text) <= cap {
        return text.to_string();
    }
    let marker_chars = swarm_char_count(SWARM_TAKE_ELISION_MARKER) + 2;
    if cap <= marker_chars {
        return swarm_prefix_on_line_boundary(text, cap);
    }
    let content_cap = cap.saturating_sub(marker_chars);
    let head_cap = (content_cap * 7) / 10;
    let tail_cap = content_cap.saturating_sub(head_cap);
    let head = swarm_prefix_on_line_boundary(text, head_cap);
    let tail = swarm_suffix_on_line_boundary(text, tail_cap);
    format!(
        "{}\n{}\n{}",
        head.trim_end(),
        SWARM_TAKE_ELISION_MARKER,
        tail.trim_start()
    )
}

fn swarm_trim_take_for_fuse(text: &str) -> String {
    swarm_trim_take_for_fuse_with_cap(text, SWARM_TAKE_FUSE_CHAR_CAP)
}

fn swarm_trim_takes_for_fuse_with_caps(
    takes: &[SwarmTakeResult],
    per_take_cap: usize,
    total_cap: usize,
) -> (Vec<SwarmTakeResult>, usize) {
    let mut trimmed = takes
        .iter()
        .map(|take| SwarmTakeResult {
            member_id: take.member_id.clone(),
            text: swarm_trim_take_for_fuse_with_cap(&take.text, per_take_cap),
        })
        .collect::<Vec<_>>();
    let mut total_chars = trimmed
        .iter()
        .map(|take| swarm_char_count(&take.text))
        .sum::<usize>();
    if !takes.is_empty() && total_chars > total_cap {
        let reduced_cap = total_cap / takes.len();
        trimmed = takes
            .iter()
            .map(|take| SwarmTakeResult {
                member_id: take.member_id.clone(),
                text: swarm_trim_take_for_fuse_with_cap(&take.text, reduced_cap),
            })
            .collect::<Vec<_>>();
        total_chars = trimmed
            .iter()
            .map(|take| swarm_char_count(&take.text))
            .sum::<usize>();
    }
    (trimmed, total_chars)
}

fn swarm_trim_takes_for_fuse(takes: &[SwarmTakeResult]) -> (Vec<SwarmTakeResult>, usize) {
    swarm_trim_takes_for_fuse_with_caps(takes, SWARM_TAKE_FUSE_CHAR_CAP, SWARM_FUSE_TOTAL_CHAR_CAP)
}

fn swarm_distinct_content_words(text: &str) -> HashSet<String> {
    let mut words = HashSet::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for lower in ch.to_lowercase() {
                current.push(lower);
            }
        } else {
            if current.chars().count() >= 4 {
                words.insert(current.clone());
            }
            current.clear();
        }
    }
    if current.chars().count() >= 4 {
        words.insert(current);
    }
    words
}

fn swarm_jaccard_similarity(left: &str, right: &str) -> f64 {
    let left_words = swarm_distinct_content_words(left);
    let right_words = swarm_distinct_content_words(right);
    if left_words.is_empty() || right_words.is_empty() {
        return 0.0;
    }
    let intersection = left_words.intersection(&right_words).count();
    let union = left_words.len() + right_words.len() - intersection;
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

fn swarm_mean_pairwise_jaccard(takes: &[SwarmTakeResult]) -> f64 {
    if takes.len() < 2 {
        return 0.0;
    }
    let mut total = 0.0;
    let mut pairs = 0usize;
    for left_index in 0..takes.len() {
        for right_index in (left_index + 1)..takes.len() {
            total += swarm_jaccard_similarity(&takes[left_index].text, &takes[right_index].text);
            pairs += 1;
        }
    }
    if pairs == 0 {
        0.0
    } else {
        total / pairs as f64
    }
}

fn swarm_pack_reuse_overlap(task: &str, pack: &str) -> Option<f64> {
    let task_words = swarm_distinct_content_words(task);
    if task_words.len() < 5 {
        return None;
    }
    let pack_words = swarm_distinct_content_words(pack);
    let overlap = task_words
        .iter()
        .filter(|word| pack_words.contains(*word))
        .count();
    Some(overlap as f64 / task_words.len() as f64)
}

fn swarm_round_2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn swarm_normalize_member_id(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(40)
        .collect::<String>();
    if normalized.is_empty() {
        "member".to_string()
    } else {
        normalized
    }
}

fn swarm_member_spec_ids(members: &[MemberSpec]) -> HashSet<String> {
    members
        .iter()
        .filter_map(|spec| spec.member_id.clone())
        .collect()
}

fn swarm_resolve_member_pin(value: Option<String>, members: &[MemberSpec]) -> String {
    let value = value.unwrap_or_default();
    if value.trim().is_empty() {
        return String::new();
    }
    let normalized = swarm_normalize_member_id(&value);
    if swarm_member_spec_ids(members).contains(&normalized) {
        normalized
    } else {
        String::new()
    }
}

fn swarm_next_member_id(used: &HashSet<String>) -> String {
    for index in 1..=SWARM_MAX_MEMBERS {
        let candidate = format!("m{index}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!("m{}", used.len().saturating_add(1))
}

fn swarm_resolve_member_specs(members: Vec<MemberSpec>) -> Result<Vec<MemberSpec>, String> {
    if members.len() > SWARM_MAX_MEMBERS {
        return Err(format!(
            "Swarm v1 supports at most {SWARM_MAX_MEMBERS} members."
        ));
    }

    let mut used = HashSet::new();
    let mut resolved = Vec::with_capacity(members.len());
    for mut member in members {
        let provider = swarm_normalize_provider(&member.provider)?;
        let member_id = member
            .member_id
            .as_deref()
            .map(swarm_normalize_member_id)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| swarm_next_member_id(&used));
        if !used.insert(member_id.clone()) {
            return Err(format!("Duplicate swarm member id: {member_id}"));
        }
        member.member_id = Some(member_id);
        member.provider = provider;
        member.model = Some(swarm_trim_text(member.model));
        member.label = Some(swarm_trim_text(member.label));
        resolved.push(member);
    }
    Ok(resolved)
}

fn swarm_member_from_spec(swarm_id: &str, spec: &MemberSpec) -> Result<SwarmMemberRuntime, String> {
    let member_id = spec
        .member_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Swarm member id is required.".to_string())?
        .to_string();
    let provider = swarm_normalize_provider(&spec.provider)?;
    let model = swarm_trim_text(spec.model.clone());
    let label = swarm_trim_text(spec.label.clone());
    Ok(SwarmMemberRuntime {
        member_id: member_id.clone(),
        provider: provider.clone(),
        model,
        label: if label.is_empty() {
            swarm_default_member_label(&provider)
        } else {
            label
        },
        pane_id: swarm_pane_id(swarm_id, &member_id),
        instance_id: None,
        status: "offline".to_string(),
        input_ready: false,
        stats: MemberStats::default(),
        last_activity_at: 0,
        last_error: String::new(),
    })
}

fn swarm_config_from_parts(
    workspace_id: &str,
    swarm_id: &str,
    repo_path: &str,
    members: Vec<MemberSpec>,
    champion_member_id: Option<String>,
    scout_member_id: Option<String>,
    verify_command: Option<String>,
) -> SwarmConfig {
    let scout_member_id = swarm_resolve_member_pin(scout_member_id, &members);
    SwarmConfig {
        swarm_id: swarm_id.to_string(),
        workspace_id: workspace_id.to_string(),
        repo_path: repo_path.trim().to_string(),
        champion_member_id: champion_member_id.unwrap_or_default().trim().to_string(),
        scout_member_id,
        verify_command: verify_command.unwrap_or_default().trim().to_string(),
        members,
        updated_at: swarm_now_ms(),
    }
}

fn swarm_load_config(workspace_id: &str, swarm_id: &str) -> SwarmConfig {
    let path = match swarm_config_path(workspace_id, swarm_id) {
        Ok(path) => path,
        Err(_) => {
            return SwarmConfig {
                swarm_id: swarm_id.to_string(),
                workspace_id: workspace_id.to_string(),
                ..SwarmConfig::default()
            };
        }
    };
    let mut config = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<SwarmConfig>(&text).ok())
        .unwrap_or_else(|| SwarmConfig {
            swarm_id: swarm_id.to_string(),
            workspace_id: workspace_id.to_string(),
            ..SwarmConfig::default()
        });
    config.swarm_id = swarm_id.to_string();
    config.workspace_id = workspace_id.to_string();
    config.members = swarm_resolve_member_specs(config.members).unwrap_or_default();
    config.scout_member_id =
        swarm_resolve_member_pin(Some(config.scout_member_id.clone()), &config.members);
    config.verify_command = config.verify_command.trim().to_string();
    config
}

fn swarm_save_config(config: &SwarmConfig) -> Result<(), String> {
    let path = swarm_config_path(&config.workspace_id, &config.swarm_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create swarm config directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Unable to serialize swarm config: {error}"))?;
    fs::write(path, bytes).map_err(|error| format!("Unable to write swarm config: {error}"))
}

fn swarm_context_pack_file_text(pack: &SwarmContextPackCache) -> String {
    format!(
        "{}{} -->\n{}\n",
        SWARM_CONTEXT_PACK_BUILT_AT_PREFIX,
        pack.at,
        pack.text.trim()
    )
}

fn swarm_parse_context_pack_file(raw: &str, fallback_at: u64) -> Option<SwarmContextPackCache> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut at = fallback_at;
    let mut text = raw;
    if let Some(rest) = raw.strip_prefix(SWARM_CONTEXT_PACK_BUILT_AT_PREFIX) {
        if let Some((timestamp, body)) = rest.split_once("-->") {
            at = timestamp.trim().parse::<u64>().unwrap_or(fallback_at);
            text = body.trim_start_matches('\n').trim();
        }
    }
    if text.trim().is_empty() {
        None
    } else {
        Some(SwarmContextPackCache {
            at,
            text: swarm_truncate_pack_to_cap(text),
        })
    }
}

fn swarm_load_context_pack(workspace_id: &str, swarm_id: &str) -> Option<SwarmContextPackCache> {
    let path = swarm_context_pack_path(workspace_id, swarm_id).ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    let fallback_at = fs::metadata(&path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(swarm_system_time_ms)
        .unwrap_or(0);
    swarm_parse_context_pack_file(&raw, fallback_at)
}

fn swarm_save_context_pack(
    workspace_id: &str,
    swarm_id: &str,
    text: &str,
) -> Result<SwarmContextPackCache, String> {
    let pack = SwarmContextPackCache {
        at: swarm_now_ms(),
        text: swarm_truncate_pack_to_cap(text),
    };
    let path = swarm_context_pack_path(workspace_id, swarm_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create swarm context pack directory: {error}"))?;
    }
    fs::write(path, swarm_context_pack_file_text(&pack))
        .map_err(|error| format!("Unable to write swarm context pack: {error}"))?;
    Ok(pack)
}

fn swarm_context_pack_summary(pack: Option<&SwarmContextPackCache>) -> Value {
    pack.map(|pack| {
        json!(ContextPackSummary {
            at: pack.at,
            chars: pack.text.chars().count(),
        })
    })
    .unwrap_or_else(|| json!({}))
}

fn swarm_summary_text(value: &str) -> String {
    value
        .trim()
        .chars()
        .take(240)
        .collect::<String>()
        .replace('\n', " ")
}

fn swarm_new_runtime_data(workspace_id: &str, swarm_id: &str) -> SwarmRuntimeData {
    let config = swarm_load_config(workspace_id, swarm_id);
    let mut members = HashMap::new();
    for spec in &config.members {
        if let Ok(member) = swarm_member_from_spec(swarm_id, spec) {
            members.insert(member.member_id.clone(), member);
        }
    }
    let (runs, stats) = swarm_load_run_summaries_and_stats(workspace_id, swarm_id);
    for (member_id, member_stats) in stats {
        if let Some(member) = members.get_mut(&member_id) {
            member.stats = member_stats;
        }
    }
    let context_pack = swarm_load_context_pack(workspace_id, swarm_id);
    SwarmRuntimeData {
        config,
        members,
        context_pack,
        active_run_id: String::new(),
        active_run_cancel: None,
        runs,
    }
}

async fn swarm_entry(
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
) -> Arc<Mutex<SwarmRuntimeData>> {
    let key = swarm_key(workspace_id, swarm_id);
    {
        let swarms = state.swarms.read().await;
        if let Some(entry) = swarms.get(&key) {
            return Arc::clone(entry);
        }
    }
    let mut swarms = state.swarms.write().await;
    swarms
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(swarm_new_runtime_data(workspace_id, swarm_id))))
        .clone()
}

fn swarm_load_run_events(workspace_id: &str, swarm_id: &str, run_id: &str) -> Vec<SwarmRunEvent> {
    let path = match swarm_run_ledger_path(workspace_id, swarm_id, run_id) {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<SwarmRunEvent>(line).ok())
        .collect()
}

fn swarm_run_summary_from_events(events: &[SwarmRunEvent]) -> Option<RunSummary> {
    let first = events.first()?;
    let mut summary = RunSummary {
        run_id: first.run_id.clone(),
        status: "running".to_string(),
        prompt: String::new(),
        mode: "plan".to_string(),
        started_at: first.at,
        settled_at: 0,
        result_summary: String::new(),
    };
    for event in events {
        match event.kind.as_str() {
            "run_started" => {
                summary.started_at = event.at;
                if let Some(data) = event.data.as_ref() {
                    summary.prompt = data
                        .get("prompt")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    summary.mode = data
                        .get("mode")
                        .and_then(Value::as_str)
                        .unwrap_or("plan")
                        .to_string();
                }
            }
            "run_result" => {
                if let Some(text) = event.text.as_deref() {
                    summary.result_summary = swarm_summary_text(text);
                }
            }
            "run_settled" => {
                summary.settled_at = event.at;
                summary.status = event
                    .data
                    .as_ref()
                    .and_then(|data| data.get("status"))
                    .and_then(Value::as_str)
                    .unwrap_or("done")
                    .to_string();
                if summary.result_summary.is_empty() {
                    if let Some(text) = event.text.as_deref() {
                        summary.result_summary = swarm_summary_text(text);
                    }
                }
            }
            _ => {}
        }
    }
    Some(summary)
}

fn swarm_apply_event_stats(
    stats: &mut HashMap<String, MemberStats>,
    event: &SwarmRunEvent,
    run_mode: &str,
) {
    if event.kind == "gate_decision" && run_mode == "plan" {
        if let Some(winner) = event
            .data
            .as_ref()
            .filter(|data| {
                data.get("converged")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .and_then(|data| data.get("winnerMemberId"))
            .and_then(Value::as_str)
        {
            let member_stats = stats.entry(winner.to_string()).or_default();
            member_stats.champion_runs = member_stats.champion_runs.saturating_add(1);
        }
        return;
    }
    let Some(member_id) = event.member_id.as_deref() else {
        return;
    };
    let member_stats = stats.entry(member_id.to_string()).or_default();
    match event.kind.as_str() {
        "member_take" => {
            member_stats.takes_delivered = member_stats.takes_delivered.saturating_add(1)
        }
        "synthesis_started" => {
            member_stats.champion_runs = member_stats.champion_runs.saturating_add(1)
        }
        "context_pack_ready" => member_stats.scout_runs = member_stats.scout_runs.saturating_add(1),
        "member_reaped" => member_stats.reaps = member_stats.reaps.saturating_add(1),
        "member_error" => member_stats.errors = member_stats.errors.saturating_add(1),
        _ => {}
    }
}

fn swarm_load_run_summaries_and_stats(
    workspace_id: &str,
    swarm_id: &str,
) -> (Vec<RunSummary>, HashMap<String, MemberStats>) {
    let mut summaries = Vec::new();
    let mut stats = HashMap::new();
    let Ok(runs_dir) = swarm_runs_dir(workspace_id, swarm_id) else {
        return (summaries, stats);
    };
    let Ok(entries) = fs::read_dir(runs_dir) else {
        return (summaries, stats);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let mut events = Vec::new();
        let mut run_mode = "plan".to_string();
        for event in text
            .lines()
            .filter_map(|line| serde_json::from_str::<SwarmRunEvent>(line).ok())
        {
            if event.kind == "run_started" {
                run_mode = event
                    .data
                    .as_ref()
                    .and_then(|data| data.get("mode"))
                    .and_then(Value::as_str)
                    .unwrap_or("plan")
                    .to_string();
            }
            swarm_apply_event_stats(&mut stats, &event, &run_mode);
            events.push(event);
        }
        if let Some(summary) = swarm_run_summary_from_events(&events) {
            summaries.push(summary);
        }
    }
    summaries.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    summaries.truncate(SWARM_RUN_SUMMARY_LIMIT);
    (summaries, stats)
}

fn swarm_state_from_data(data: &SwarmRuntimeData) -> SwarmState {
    let mut members = data
        .members
        .values()
        .cloned()
        .map(|member| MemberState {
            member_id: member.member_id,
            provider: member.provider,
            model: member.model,
            label: member.label,
            pane_id: member.pane_id,
            status: member.status,
            input_ready: member.input_ready,
            score: swarm_member_score(&member.stats),
            stats: member.stats,
            last_activity_at: member.last_activity_at,
        })
        .collect::<Vec<_>>();
    members.sort_by(|left, right| left.member_id.cmp(&right.member_id));
    let mut runs = data.runs.clone();
    runs.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    runs.truncate(SWARM_RUN_SUMMARY_LIMIT);
    SwarmState {
        swarm_id: data.config.swarm_id.clone(),
        workspace_id: data.config.workspace_id.clone(),
        repo_path: data.config.repo_path.clone(),
        champion_member_id: data.config.champion_member_id.clone(),
        scout_member_id: data.config.scout_member_id.clone(),
        verify_command: data.config.verify_command.clone(),
        context_pack: swarm_context_pack_summary(data.context_pack.as_ref()),
        members,
        active_run_id: data.active_run_id.clone(),
        runs,
    }
}

fn swarm_ready_member_refs_from_data(data: &SwarmRuntimeData) -> Vec<SwarmMemberRef> {
    let mut refs = Vec::new();
    for spec in &data.config.members {
        let Some(member_id) = spec.member_id.as_deref() else {
            continue;
        };
        let Some(member) = data.members.get(member_id) else {
            continue;
        };
        if member.status == "ready" && member.input_ready {
            if let Some(instance_id) = member.instance_id {
                refs.push(SwarmMemberRef {
                    member_id: member.member_id.clone(),
                    provider: member.provider.clone(),
                    pane_id: member.pane_id.clone(),
                    instance_id,
                });
            }
        }
    }
    refs
}

fn swarm_choose_auto_scout(ready_members: &[SwarmMemberRef]) -> Option<SwarmMemberRef> {
    ready_members
        .iter()
        .enumerate()
        .min_by_key(|(index, member)| (swarm_provider_cost_rank(&member.provider), *index))
        .map(|(_, member)| member.clone())
}

fn swarm_choose_scout_from_data(
    data: &SwarmRuntimeData,
    ready_members: &[SwarmMemberRef],
) -> Option<SwarmMemberRef> {
    if !data.config.scout_member_id.trim().is_empty() {
        return ready_members
            .iter()
            .find(|member| member.member_id == data.config.scout_member_id)
            .cloned();
    }
    swarm_choose_auto_scout(ready_members)
}

fn swarm_emit_state(app: &AppHandle, workspace_id: &str, swarm_id: &str) {
    let _ = app.emit(
        SWARM_STATE_EVENT,
        json!({
            "workspaceId": workspace_id,
            "swarmId": swarm_id,
        }),
    );
}

fn swarm_emit_run_event(
    app: &AppHandle,
    workspace_id: &str,
    swarm_id: &str,
    event: &SwarmRunEvent,
) {
    let _ = app.emit(
        SWARM_RUN_EVENT,
        json!({
            "workspaceId": workspace_id,
            "swarmId": swarm_id,
            "runId": event.run_id,
            "event": event,
        }),
    );
}

async fn swarm_append_run_event(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    kind: &str,
    member_id: Option<String>,
    text: Option<String>,
    data: Option<Value>,
) -> Result<SwarmRunEvent, String> {
    let _ledger_guard = state.ledger_lock.lock().await;
    let path = swarm_run_ledger_path(workspace_id, swarm_id, run_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create swarm run directory: {error}"))?;
    }
    let latest_seq = fs::read_to_string(&path)
        .ok()
        .map(|body| {
            body.lines()
                .filter_map(|line| serde_json::from_str::<SwarmRunEvent>(line).ok())
                .map(|event| event.seq)
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0);
    let event = SwarmRunEvent {
        seq: latest_seq.saturating_add(1),
        run_id: run_id.to_string(),
        at: swarm_now_ms(),
        kind: kind.to_string(),
        member_id,
        text,
        data,
    };
    let line = serde_json::to_string(&event)
        .map_err(|error| format!("Unable to serialize swarm run event: {error}"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Unable to open swarm run ledger: {error}"))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| format!("Unable to append swarm run ledger: {error}"))?;
    swarm_emit_run_event(app, workspace_id, swarm_id, &event);
    Ok(event)
}

fn swarm_upsert_run_summary(data: &mut SwarmRuntimeData, summary: RunSummary) {
    if let Some(existing) = data
        .runs
        .iter_mut()
        .find(|candidate| candidate.run_id == summary.run_id)
    {
        *existing = summary;
    } else {
        data.runs.push(summary);
    }
    data.runs
        .sort_by(|left, right| right.started_at.cmp(&left.started_at));
    data.runs.truncate(SWARM_RUN_SUMMARY_LIMIT);
}

async fn swarm_update_member_status(
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    member_id: &str,
    status: &str,
    input_ready: Option<bool>,
    last_activity_at: Option<u64>,
    error: Option<String>,
) {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let mut data = entry.lock().await;
    if let Some(member) = data.members.get_mut(member_id) {
        member.status = status.to_string();
        if let Some(input_ready) = input_ready {
            member.input_ready = input_ready;
        }
        if let Some(last_activity_at) = last_activity_at {
            member.last_activity_at = last_activity_at;
        }
        if let Some(error) = error {
            member.last_error = error;
        }
    }
}

fn swarm_member_status_from_runtime(runtime: &TerminalRuntimeSnapshot) -> (String, bool, u64) {
    let busy = terminal_runtime_snapshot_is_busy_turn(runtime)
        || terminal_projection_state_is_busy(&runtime.activity_status)
        || terminal_projection_state_is_busy(&runtime.command_phase)
        || terminal_projection_state_is_busy(&runtime.status);
    let idle = !busy
        && (runtime.input_ready
            || terminal_projection_state_is_idle(&runtime.activity_status)
            || terminal_projection_state_is_idle(&runtime.command_phase)
            || terminal_projection_state_is_idle(&runtime.status));
    let error = terminal_projection_state_is_error(&runtime.activity_status)
        || terminal_projection_state_is_error(&runtime.command_phase)
        || terminal_projection_state_is_error(&runtime.status);
    let spawning = terminal_runtime_snapshot_is_starting(runtime);
    let status = if error {
        "error"
    } else if idle {
        "ready"
    } else if spawning {
        "spawning"
    } else {
        "working"
    };
    (status.to_string(), idle, runtime.updated_at_ms)
}

async fn swarm_terminal_snapshot(
    terminal_state: &TerminalState,
    pane_id: &str,
) -> Option<(u64, TerminalRuntimeSnapshot, String, String)> {
    let instance = {
        let terminals = terminal_state.terminals.read().await;
        terminals.get(pane_id).cloned()
    }?;
    let runtime = terminal_runtime_snapshot(&instance);
    let cwd = instance.working_directory.to_string_lossy().to_string();
    Some((instance.id, runtime, instance.metadata.agent_kind, cwd))
}

async fn swarm_refresh_members_from_terminals(
    state: &SwarmRuntimeState,
    terminal_state: &TerminalState,
    workspace_id: &str,
    swarm_id: &str,
) {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let members = {
        let data = entry.lock().await;
        data.members
            .values()
            .map(|member| {
                (
                    member.member_id.clone(),
                    member.pane_id.clone(),
                    member.instance_id,
                )
            })
            .collect::<Vec<_>>()
    };
    let mut updates = Vec::new();
    for (member_id, pane_id, expected_instance_id) in members {
        match swarm_terminal_snapshot(terminal_state, &pane_id).await {
            Some((instance_id, runtime, _, _))
                if expected_instance_id.is_none() || expected_instance_id == Some(instance_id) =>
            {
                let (status, input_ready, last_activity_at) =
                    swarm_member_status_from_runtime(&runtime);
                updates.push((
                    member_id,
                    status,
                    input_ready,
                    last_activity_at,
                    Some(instance_id),
                ));
            }
            _ => updates.push((member_id, "dead".to_string(), false, swarm_now_ms(), None)),
        }
    }
    let mut data = entry.lock().await;
    for (member_id, status, input_ready, last_activity_at, instance_id) in updates {
        if let Some(member) = data.members.get_mut(&member_id) {
            if member.instance_id.is_none() && instance_id.is_none() && member.status == "offline" {
                continue;
            }
            if let Some(instance_id) = instance_id {
                member.instance_id = Some(instance_id);
            }
            member.status = status;
            member.input_ready = input_ready;
            member.last_activity_at = last_activity_at;
        }
    }
}

fn swarm_make_run_id() -> String {
    format!("run-{}-{}", swarm_now_ms(), uuid::Uuid::new_v4().simple())
}

fn swarm_prompt_event_id(run_id: &str, member_id: &str, phase: &str) -> String {
    format!("swarm-{run_id}-{member_id}-{phase}")
}

async fn swarm_enqueue_prompt(
    app: &AppHandle,
    member: &SwarmMemberRef,
    run_id: &str,
    phase: &str,
    prompt: String,
) -> Result<(), String> {
    let payload = TerminalInputEventPayload {
        pane_id: member.pane_id.clone(),
        instance_id: Some(member.instance_id),
        data: format!("{prompt}{TERMINAL_ENTER_SEQUENCE}"),
        app_fork_enabled: Some(false),
        prompt_event_id: Some(swarm_prompt_event_id(run_id, &member.member_id, phase)),
        prompt_event_revision: None,
        prompt_event_source: Some(format!("swarm_{phase}")),
        prompt_event_submitted_at: Some(swarm_now_ms().to_string()),
        prompt_event_text: Some(prompt),
        todo_id: None,
        todo_dispatch_id: None,
        todo_command_id: None,
        todo_action: None,
        todo_resume_requested: None,
        thread_id: Some(format!("swarm:{run_id}:{}", member.member_id)),
    };
    let ack = enqueue_terminal_input_event_with_ack(app, payload);
    match timeout(Duration::from_secs(SWARM_PROMPT_ACK_TIMEOUT_SECS), ack).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err("Terminal input acknowledgement channel closed.".to_string()),
        Err(_) => Err("Terminal input write acknowledgement timed out.".to_string()),
    }
}

fn swarm_context_pack_prompt(
    original_prompt: &str,
    repo_path: &str,
    cached_pack: Option<&SwarmContextPackCache>,
) -> String {
    let mut body = String::new();
    body.push_str("You are the scout for a Diff Forge Swarm Agents Panel run.\n\n");
    body.push_str("HARD INVARIANTS:\n");
    body.push_str("- Build a STRICTLY FACTUAL context pack only.\n");
    body.push_str("- Do not recommend an approach, rank options, or include opinions or strategic preferences.\n");
    body.push_str("- Do not edit files.\n");
    body.push_str("- Keep the pack within ~24,000 chars; prioritize build/test commands, task-relevant files, and conventions, and cut anything else.\n");
    body.push_str("- End your reply with a final line containing only `");
    body.push_str(SWARM_PACK_SENTINEL);
    body.push_str("`.\n\n");
    body.push_str("Include only:\n");
    body.push_str("- Repo map: important directories/files and what they contain.\n");
    body.push_str("- Existing conventions relevant to this task.\n");
    body.push_str("- Build/test/check commands that appear valid for this repo.\n");
    body.push_str("- Task-relevant file paths with one-line whys and short key excerpts.\n");
    body.push_str("- Explicit constraints from the user prompt and repository context.\n\n");
    body.push_str("Verify facts from the repo before keeping them. If uncertain, say what is unverified.\n\nRepo root:\n");
    body.push_str(repo_path);
    body.push_str("\n\nTask:\n");
    body.push_str(original_prompt);
    if let Some(pack) = cached_pack {
        body.push_str("\n\nPrevious context pack. Update it incrementally for this new task instead of re-deriving everything from scratch:\n");
        body.push_str(&pack.text);
    }
    body.push_str("\n\nNON-NEGOTIABLE:\n");
    body.push_str("- Factual context only: no recommendations, no preferred solution, no ranking, no advocacy.\n");
    body.push_str("- Stay under the context-pack budget by keeping commands, relevant paths, conventions, and short excerpts only.\n");
    body.push_str("- The last line must be exactly `");
    body.push_str(SWARM_PACK_SENTINEL);
    body.push_str("` and nothing else.");
    body
}

fn swarm_context_pack_prompt_block(context_pack: Option<&str>) -> String {
    let Some(context_pack) = context_pack else {
        return String::new();
    };
    if context_pack.trim().is_empty() {
        return String::new();
    }
    format!(
        "\n\nCONTEXT PACK (factual reference — verify before relying on it)\n{}\n",
        context_pack.trim()
    )
}

fn swarm_take_prompt(
    original_prompt: &str,
    member: &SwarmMemberRef,
    context_pack: Option<&str>,
) -> String {
    let mut body = String::new();
    body.push_str("You are swarm member `");
    body.push_str(&member.member_id);
    body.push_str("` in a Diff Forge Swarm Agents Panel run.\n\n");
    body.push_str("HARD INVARIANTS:\n");
    body.push_str("- This is a plan-only take phase: do NOT edit, create, or delete any file.\n");
    body.push_str("- End your reply with a final line containing only `");
    body.push_str(SWARM_TAKE_SENTINEL);
    body.push_str("`.\n");
    body.push_str("- Respect the take budget: target <= 120 lines / ~8,000 chars, decision-relevant only.\n\nTask:\n");
    body.push_str(original_prompt);
    body.push_str(&swarm_context_pack_prompt_block(context_pack));
    body.push_str("\nReturn an independent take: chosen approach, key files (paths + why), risks/unknowns, and explicit points where you expect other members might disagree. No full file dumps and no exhaustive diffs. You may verify the context pack before relying on it and may explore beyond it.\n\nNON-NEGOTIABLE:\n");
    body.push_str("- Do not change the filesystem in this take phase.\n");
    body.push_str("- Keep the take focused and within the <= 120 line / ~8,000 char target.\n");
    body.push_str("- The last line must be exactly `");
    body.push_str(SWARM_TAKE_SENTINEL);
    body.push_str("` and nothing else.");
    body
}

fn swarm_synthesis_prompt(
    original_prompt: &str,
    mode: &str,
    takes: &[SwarmTakeResult],
    context_pack: Option<&str>,
) -> String {
    let mut body = String::new();
    body.push_str("You are the champion member for a Diff Forge Swarm Agents Panel run.\n\n");
    body.push_str("HARD INVARIANTS:\n");
    if mode == "implement" {
        body.push_str("- Implement mode: apply the fused plan to the repo using the existing project conventions.\n");
    } else {
        body.push_str("- Plan mode: do NOT edit, create, or delete any file.\n");
    }
    body.push_str("- The fused answer must be complete and standalone; do not rely on phrases like \"as member 2 said\".\n\n");
    body.push_str("Original task:\n");
    body.push_str(original_prompt);
    body.push_str(&swarm_context_pack_prompt_block(context_pack));
    body.push_str("\n\nIndependent member takes:\n");
    for take in takes {
        body.push_str("\n--- ");
        body.push_str(&take.member_id);
        body.push_str(" ---\n");
        body.push_str(&take.text);
        body.push('\n');
    }
    if mode == "implement" {
        body.push_str("\nSynthesize these takes, choose the best path, and implement the fused plan in the repo. Use the existing project conventions and finish with a concise report of what changed and how you verified it.");
    } else {
        body.push_str("\nSynthesize these takes into the final answer. Do not edit files. Be concise but include the reasoning and concrete next steps the user needs.");
    }
    body.push_str("\n\nNON-NEGOTIABLE:\n");
    if mode == "implement" {
        body.push_str("- You are in implement mode: make the required repo changes and report what changed plus verification.\n");
    } else {
        body.push_str("- You are in plan mode: do not modify files or apply changes.\n");
    }
    body.push_str("- Your final answer must stand on its own without referring back to member numbers or hidden context.");
    body
}

fn swarm_converged_execution_prompt(winning_take: &str) -> String {
    let mut body = String::new();
    body.push_str("You are the champion member for a Diff Forge Swarm Agents Panel run.\n\n");
    body.push_str("HARD INVARIANTS:\n");
    body.push_str("- Implement mode: members converged on this plan — execute it in the repo.\n");
    body.push_str(
        "- Change only what the winning take requires and follow existing project conventions.\n",
    );
    body.push_str("- The final answer must be complete and standalone.\n\n");
    body.push_str("Winning take:\n");
    body.push_str(winning_take.trim());
    body.push_str("\n\nNON-NEGOTIABLE:\n");
    body.push_str("- Execute the converged plan; do not re-fuse or solicit more opinions.\n");
    body.push_str("- Keep changes scoped to the winning take.\n");
    body.push_str(
        "- Your final answer must stand on its own with what changed and how you verified it.",
    );
    body
}

fn swarm_repair_prompt(command: &str, exit_code: i32, output_tail: &str) -> String {
    let mut body = String::new();
    body.push_str("You are the champion member repairing a Diff Forge Swarm implement run.\n\n");
    body.push_str("HARD INVARIANTS:\n");
    body.push_str("- Implement mode: fix the verification failure in the repo.\n");
    body.push_str("- Change only what is needed for the verification command to pass.\n");
    body.push_str("- The final answer must be complete and standalone.\n\n");
    body.push_str("Verification command:\n");
    body.push_str(command.trim());
    body.push_str("\n\nExit code:\n");
    body.push_str(&exit_code.to_string());
    body.push_str("\n\nOutput tail:\n");
    body.push_str(output_tail.trim());
    body.push_str("\n\nFix the verification failure; change only what is needed.");
    body.push_str("\n\nNON-NEGOTIABLE:\n");
    body.push_str(
        "- Repair the failing verification command only; do not broaden the implementation.\n",
    );
    body.push_str(
        "- Preserve existing behavior unless it is directly required for the verification fix.\n",
    );
    body.push_str(
        "- Your final answer must stand on its own with the repair and verification result.",
    );
    body
}

fn swarm_strip_sentinel(text: &str, sentinel: &str) -> String {
    let before_sentinel = text
        .rfind(sentinel)
        .map(|index| &text[..index])
        .unwrap_or(text);
    before_sentinel.trim().to_string()
}

fn swarm_strip_pack_sentinel(text: &str) -> String {
    swarm_strip_sentinel(text, SWARM_PACK_SENTINEL)
}

fn swarm_tail_text_for_instance(instance: &TerminalInstance) -> Result<String, String> {
    let output = instance
        .headless_output
        .lock()
        .map_err(|_| "Terminal output snapshot lock poisoned.".to_string())?;
    let bytes = output.tail.iter().copied().collect::<Vec<_>>();
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn swarm_capture_from_tail(text: &str, sentinel: &str) -> Option<String> {
    let cleaned = cloud_mcp_clean_terminal_state_text(text);
    let candidate = if cleaned.contains(sentinel) {
        swarm_strip_sentinel(&cleaned, sentinel)
    } else {
        cleaned.trim().to_string()
    };
    if candidate.trim().is_empty() {
        None
    } else {
        Some(
            candidate
                .chars()
                .rev()
                .take(SWARM_CAPTURE_MAX_CHARS)
                .collect::<String>()
                .chars()
                .rev()
                .collect(),
        )
    }
}

async fn swarm_capture_final_message(
    terminal_state: &TerminalState,
    workspace_id: &str,
    member: &SwarmMemberRef,
    sentinel: &str,
) -> Result<String, String> {
    let instance = {
        let terminals = terminal_state.terminals.read().await;
        terminals
            .get(&member.pane_id)
            .cloned()
            .ok_or_else(|| "Terminal session is not running.".to_string())?
    };
    let runtime = terminal_runtime_snapshot(&instance);
    let provider_session_id = runtime
        .provider_session_id
        .as_deref()
        .or(runtime.native_session_id.as_deref())
        .unwrap_or_default()
        .to_string();
    if !provider_session_id.trim().is_empty() {
        let agent_id = instance.metadata.agent_kind.clone();
        let cwd = instance.working_directory.to_string_lossy().to_string();
        let transcript_workspace_id = workspace_id.to_string();
        let transcript = tauri::async_runtime::spawn_blocking(move || {
            read_agent_thread_transcript(
                &agent_id,
                &provider_session_id,
                &cwd,
                Some(transcript_workspace_id.as_str()),
                CODEX_TRANSCRIPT_DEFAULT_LIMIT,
            )
        })
        .await
        .map_err(|error| format!("Transcript read task failed: {error}"))
        .and_then(|result| result);
        if let Ok(result) = transcript {
            if let Some(message) = result.messages.iter().rev().find(|message| {
                message.role == "assistant"
                    && message.kind != "tool"
                    && !message.text.trim().is_empty()
            }) {
                let text = swarm_strip_sentinel(&message.text, sentinel);
                if !text.trim().is_empty() {
                    return Ok(text);
                }
            }
        }
    }
    let tail = swarm_tail_text_for_instance(&instance)?;
    swarm_capture_from_tail(&tail, sentinel)
        .ok_or_else(|| "No assistant message was captured.".to_string())
}

async fn swarm_wait_member_idle(
    state: &SwarmRuntimeState,
    terminal_state: &TerminalState,
    app: &AppHandle,
    workspace_id: &str,
    swarm_id: &str,
    member: &SwarmMemberRef,
    cancel: Arc<AtomicBool>,
    wait_timeout: Duration,
) -> Result<(), String> {
    let started_at = Instant::now();
    let mut saw_busy = false;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Swarm run was cancelled.".to_string());
        }
        if started_at.elapsed() > wait_timeout {
            return Err("Timed out waiting for member to become idle.".to_string());
        }
        let Some((instance_id, runtime, _, _)) =
            swarm_terminal_snapshot(terminal_state, &member.pane_id).await
        else {
            return Err("Terminal session is not running.".to_string());
        };
        if instance_id != member.instance_id {
            return Err("Terminal session was replaced.".to_string());
        }
        let (status, input_ready, last_activity_at) = swarm_member_status_from_runtime(&runtime);
        swarm_update_member_status(
            state,
            workspace_id,
            swarm_id,
            &member.member_id,
            &status,
            Some(input_ready),
            Some(last_activity_at),
            None,
        )
        .await;
        swarm_emit_state(app, workspace_id, swarm_id);
        if input_ready {
            if saw_busy
                || started_at.elapsed() >= Duration::from_millis(SWARM_MIN_IDLE_AFTER_PROMPT_MS)
            {
                return Ok(());
            }
        } else {
            saw_busy = true;
        }
        sleep(Duration::from_millis(SWARM_IDLE_POLL_MS)).await;
    }
}

async fn swarm_member_take_task(
    app: AppHandle,
    state: SwarmRuntimeState,
    workspace_id: String,
    swarm_id: String,
    run_id: String,
    prompt: String,
    context_pack: Option<String>,
    member: SwarmMemberRef,
    cancel: Arc<AtomicBool>,
) -> SwarmTakeResult {
    swarm_update_member_status(
        &state,
        &workspace_id,
        &swarm_id,
        &member.member_id,
        "working",
        Some(false),
        Some(swarm_now_ms()),
        None,
    )
    .await;
    swarm_emit_state(&app, &workspace_id, &swarm_id);

    let prompt_text = swarm_take_prompt(&prompt, &member, context_pack.as_deref());
    let prompted = swarm_enqueue_prompt(&app, &member, &run_id, "take", prompt_text).await;
    if let Err(error) = prompted {
        let _ = swarm_append_run_event(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            "member_error",
            Some(member.member_id.clone()),
            Some(error.clone()),
            None,
        )
        .await;
        swarm_increment_member_stat(
            &state,
            &workspace_id,
            &swarm_id,
            &member.member_id,
            "errors",
        )
        .await;
        swarm_update_member_status(
            &state,
            &workspace_id,
            &swarm_id,
            &member.member_id,
            "error",
            Some(false),
            Some(swarm_now_ms()),
            Some(error),
        )
        .await;
        swarm_emit_state(&app, &workspace_id, &swarm_id);
        return SwarmTakeResult {
            member_id: member.member_id,
            text: String::new(),
        };
    }
    let _ = swarm_append_run_event(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        "member_prompted",
        Some(member.member_id.clone()),
        Some("Take prompt delivered.".to_string()),
        None,
    )
    .await;

    let terminal_state = app.state::<TerminalState>();
    let idle = swarm_wait_member_idle(
        &state,
        terminal_state.inner(),
        &app,
        &workspace_id,
        &swarm_id,
        &member,
        Arc::clone(&cancel),
        Duration::from_secs(SWARM_TAKE_TIMEOUT_SECS),
    )
    .await;
    if let Err(error) = idle {
        if cancel.load(Ordering::SeqCst) {
            return SwarmTakeResult {
                member_id: member.member_id,
                text: String::new(),
            };
        }
        let kind = if error.contains("Timed out") {
            "member_reaped"
        } else {
            "member_error"
        };
        let _ = swarm_append_run_event(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            kind,
            Some(member.member_id.clone()),
            Some(error.clone()),
            None,
        )
        .await;
        swarm_increment_member_stat(
            &state,
            &workspace_id,
            &swarm_id,
            &member.member_id,
            if kind == "member_reaped" {
                "reaps"
            } else {
                "errors"
            },
        )
        .await;
        return SwarmTakeResult {
            member_id: member.member_id,
            text: String::new(),
        };
    }

    match swarm_capture_final_message(
        terminal_state.inner(),
        &workspace_id,
        &member,
        SWARM_TAKE_SENTINEL,
    )
    .await
    {
        Ok(text) => {
            if cancel.load(Ordering::SeqCst) {
                return SwarmTakeResult {
                    member_id: member.member_id,
                    text: String::new(),
                };
            }
            let _ = swarm_append_run_event(
                &app,
                &state,
                &workspace_id,
                &swarm_id,
                &run_id,
                "member_take",
                Some(member.member_id.clone()),
                Some(text.clone()),
                None,
            )
            .await;
            swarm_increment_member_stat(
                &state,
                &workspace_id,
                &swarm_id,
                &member.member_id,
                "takesDelivered",
            )
            .await;
            SwarmTakeResult {
                member_id: member.member_id,
                text,
            }
        }
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return SwarmTakeResult {
                    member_id: member.member_id,
                    text: String::new(),
                };
            }
            let _ = swarm_append_run_event(
                &app,
                &state,
                &workspace_id,
                &swarm_id,
                &run_id,
                "member_error",
                Some(member.member_id.clone()),
                Some(error.clone()),
                None,
            )
            .await;
            swarm_increment_member_stat(
                &state,
                &workspace_id,
                &swarm_id,
                &member.member_id,
                "errors",
            )
            .await;
            SwarmTakeResult {
                member_id: member.member_id,
                text: String::new(),
            }
        }
    }
}

async fn swarm_context_pack_phase(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    prompt: &str,
    ready_members: &[SwarmMemberRef],
    cancel: Arc<AtomicBool>,
) -> Option<String> {
    let (scout, repo_path, cached_pack) = {
        let entry = swarm_entry(state, workspace_id, swarm_id).await;
        let data = entry.lock().await;
        (
            swarm_choose_scout_from_data(&data, ready_members),
            data.config.repo_path.clone(),
            data.context_pack.clone(),
        )
    };
    if let Some(pack) = cached_pack.as_ref() {
        let age = swarm_now_ms().saturating_sub(pack.at);
        if age < SWARM_PACK_REUSE_MAX_AGE_MS {
            if let Some(overlap) = swarm_pack_reuse_overlap(prompt, &pack.text) {
                if overlap >= SWARM_PACK_REUSE_OVERLAP {
                    let chars = swarm_char_count(&pack.text);
                    let _ = swarm_append_run_event(
                        app,
                        state,
                        workspace_id,
                        swarm_id,
                        run_id,
                        "context_pack_reused",
                        None,
                        Some(format!(
                            "Reused cached context pack ({chars} chars, {:.2} overlap).",
                            swarm_round_2(overlap)
                        )),
                        Some(json!({
                            "at": pack.at,
                            "chars": chars,
                            "overlap": swarm_round_2(overlap),
                        })),
                    )
                    .await;
                    return Some(pack.text.clone());
                }
            }
        }
    }
    let Some(scout) = scout else {
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "note",
            None,
            Some(
                "No ready scout member was available; proceeding without context pack.".to_string(),
            ),
            Some(json!({ "phase": "context_pack" })),
        )
        .await;
        return None;
    };
    if cancel.load(Ordering::SeqCst) {
        return None;
    }

    let incremental = cached_pack.is_some();
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "context_pack_started",
        Some(scout.member_id.clone()),
        Some("Context pack scout started.".to_string()),
        Some(json!({ "incremental": incremental })),
    )
    .await;
    swarm_update_member_status(
        state,
        workspace_id,
        swarm_id,
        &scout.member_id,
        "working",
        Some(false),
        Some(swarm_now_ms()),
        None,
    )
    .await;
    swarm_emit_state(app, workspace_id, swarm_id);

    let scout_prompt = swarm_context_pack_prompt(prompt, &repo_path, cached_pack.as_ref());
    if let Err(error) =
        swarm_enqueue_prompt(app, &scout, run_id, "context_pack", scout_prompt).await
    {
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "note",
            Some(scout.member_id.clone()),
            Some(format!(
                "Scout prompt failed — proceeding without context pack: {error}"
            )),
            Some(json!({ "phase": "context_pack" })),
        )
        .await;
        return None;
    }

    let terminal_state = app.state::<TerminalState>();
    let idle = swarm_wait_member_idle(
        state,
        terminal_state.inner(),
        app,
        workspace_id,
        swarm_id,
        &scout,
        Arc::clone(&cancel),
        Duration::from_secs(SWARM_CONTEXT_PACK_TIMEOUT_SECS),
    )
    .await;
    if let Err(error) = idle {
        if cancel.load(Ordering::SeqCst) {
            return None;
        }
        let text = if error.contains("Timed out") {
            "scout timed out — proceeding without context pack".to_string()
        } else {
            format!("Scout failed — proceeding without context pack: {error}")
        };
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "note",
            Some(scout.member_id.clone()),
            Some(text),
            Some(json!({ "phase": "context_pack" })),
        )
        .await;
        return None;
    }

    let pack_text = match swarm_capture_final_message(
        terminal_state.inner(),
        workspace_id,
        &scout,
        SWARM_PACK_SENTINEL,
    )
    .await
    {
        Ok(text) => swarm_truncate_pack_to_cap(&swarm_strip_pack_sentinel(&text)),
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return None;
            }
            let _ = swarm_append_run_event(
                app,
                state,
                workspace_id,
                swarm_id,
                run_id,
                "note",
                Some(scout.member_id.clone()),
                Some(format!(
                    "Scout capture failed — proceeding without context pack: {error}"
                )),
                Some(json!({ "phase": "context_pack" })),
            )
            .await;
            return None;
        }
    };
    if pack_text.trim().is_empty() {
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "note",
            Some(scout.member_id.clone()),
            Some(
                "Scout returned an empty context pack; proceeding without context pack."
                    .to_string(),
            ),
            Some(json!({ "phase": "context_pack" })),
        )
        .await;
        return None;
    }

    match swarm_save_context_pack(workspace_id, swarm_id, &pack_text) {
        Ok(cache) => {
            let entry = swarm_entry(state, workspace_id, swarm_id).await;
            let mut data = entry.lock().await;
            data.context_pack = Some(cache);
        }
        Err(error) => {
            let _ = swarm_append_run_event(
                app,
                state,
                workspace_id,
                swarm_id,
                run_id,
                "note",
                Some(scout.member_id.clone()),
                Some(format!("Unable to cache context pack: {error}")),
                Some(json!({ "phase": "context_pack" })),
            )
            .await;
        }
    }

    let chars = pack_text.chars().count();
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "context_pack_ready",
        Some(scout.member_id.clone()),
        Some(pack_text.clone()),
        Some(json!({ "chars": chars, "incremental": incremental })),
    )
    .await;
    swarm_increment_member_stat(state, workspace_id, swarm_id, &scout.member_id, "scoutRuns").await;
    swarm_emit_state(app, workspace_id, swarm_id);
    Some(pack_text)
}

async fn swarm_increment_member_stat(
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    member_id: &str,
    stat: &str,
) {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let mut data = entry.lock().await;
    let Some(member) = data.members.get_mut(member_id) else {
        return;
    };
    match stat {
        "takesDelivered" => {
            member.stats.takes_delivered = member.stats.takes_delivered.saturating_add(1)
        }
        "championRuns" => member.stats.champion_runs = member.stats.champion_runs.saturating_add(1),
        "reaps" => member.stats.reaps = member.stats.reaps.saturating_add(1),
        "errors" => member.stats.errors = member.stats.errors.saturating_add(1),
        "scoutRuns" => member.stats.scout_runs = member.stats.scout_runs.saturating_add(1),
        _ => {}
    }
}

async fn swarm_mark_run_settled(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    status: &str,
    text: &str,
) -> Result<bool, String> {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let should_emit = {
        let mut data = entry.lock().await;
        if data.active_run_id != run_id {
            false
        } else {
            data.active_run_id.clear();
            data.active_run_cancel = None;
            if let Some(summary) = data
                .runs
                .iter_mut()
                .find(|summary| summary.run_id == run_id)
            {
                summary.status = status.to_string();
                summary.settled_at = swarm_now_ms();
                if summary.result_summary.is_empty() {
                    summary.result_summary = swarm_summary_text(text);
                }
            }
            true
        }
    };
    if should_emit {
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "run_settled",
            None,
            (!text.trim().is_empty()).then(|| text.to_string()),
            Some(json!({ "status": status })),
        )
        .await?;
        swarm_emit_state(app, workspace_id, swarm_id);
        let _ = todo_dispatch_mark_active_for_swarm_completed(
            app,
            workspace_id,
            swarm_id,
            run_id,
            status,
        );
    }
    Ok(should_emit)
}

async fn swarm_choose_champion(
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    takes: &[SwarmTakeResult],
    ready_members: &[SwarmMemberRef],
) -> Option<SwarmMemberRef> {
    if takes.len() == 1 {
        let winner = &takes[0].member_id;
        return ready_members
            .iter()
            .find(|member| &member.member_id == winner)
            .cloned();
    }
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let data = entry.lock().await;
    if let Some(champion) = ready_members
        .iter()
        .find(|member| member.member_id == data.config.champion_member_id)
        .cloned()
    {
        return Some(champion);
    }
    ready_members
        .iter()
        .max_by_key(|member| {
            data.members
                .get(&member.member_id)
                .map(|member| swarm_member_score(&member.stats))
                .unwrap_or(0)
        })
        .cloned()
}

async fn swarm_choose_highest_score_take(
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    takes: &[SwarmTakeResult],
    ready_members: &[SwarmMemberRef],
) -> Option<SwarmTakeResult> {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let data = entry.lock().await;
    let mut best: Option<(usize, i64, SwarmTakeResult)> = None;
    for (index, member) in ready_members.iter().enumerate() {
        let Some(take) = takes
            .iter()
            .find(|candidate| candidate.member_id == member.member_id)
        else {
            continue;
        };
        let score = data
            .members
            .get(&member.member_id)
            .map(|member| swarm_member_score(&member.stats))
            .unwrap_or(0);
        let replace = best
            .as_ref()
            .map(|(best_index, best_score, _)| {
                score > *best_score || (score == *best_score && index < *best_index)
            })
            .unwrap_or(true);
        if replace {
            best = Some((index, score, take.clone()));
        }
    }
    best.map(|(_, _, take)| take)
        .or_else(|| takes.first().cloned())
}

async fn swarm_record_run_result(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    text: &str,
) {
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "run_result",
        None,
        Some(text.to_string()),
        None,
    )
    .await;
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let mut data = entry.lock().await;
    if let Some(summary) = data
        .runs
        .iter_mut()
        .find(|summary| summary.run_id == run_id)
    {
        summary.result_summary = swarm_summary_text(text);
    }
}

struct SwarmVerifyOutcome {
    ok: bool,
    exit_code: i32,
    timed_out: bool,
    output: String,
}

fn swarm_spawn_verify_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    output: Arc<StdMutex<String>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&buffer[..count]);
                    if let Ok(mut output) = output.lock() {
                        output.push_str(&text);
                    }
                }
                Err(_) => return,
            }
        }
    })
}

fn swarm_verify_output_snapshot(output: &Arc<StdMutex<String>>) -> String {
    output
        .lock()
        .map(|output| output.clone())
        .unwrap_or_default()
}

fn swarm_prepare_verify_command_process(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }
}

fn swarm_kill_verify_child(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;
        if pid > 0 {
            unsafe {
                let _ = libc::kill(-pid, libc::SIGKILL);
            }
        }
    }
    let _ = child.kill();
}

async fn swarm_execute_verify_command(
    repo_path: &str,
    command: &str,
    cancel: Arc<AtomicBool>,
) -> Result<SwarmVerifyOutcome, String> {
    let mut verify_command = Command::new("sh");
    verify_command
        .arg("-c")
        .arg(command)
        .current_dir(repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    swarm_prepare_verify_command_process(&mut verify_command);
    let mut child = match verify_command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ok(SwarmVerifyOutcome {
                ok: false,
                exit_code: -1,
                timed_out: false,
                output: format!("Unable to start verification command: {error}"),
            });
        }
    };
    let output = Arc::new(StdMutex::new(String::new()));
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(swarm_spawn_verify_output_reader(
            stdout,
            Arc::clone(&output),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(swarm_spawn_verify_output_reader(
            stderr,
            Arc::clone(&output),
        ));
    }

    let started_at = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if cancel.load(Ordering::SeqCst) {
            swarm_kill_verify_child(&mut child);
            let _ = child.wait();
            return Err("Swarm run was cancelled.".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                swarm_kill_verify_child(&mut child);
                let _ = child.wait();
                return Ok(SwarmVerifyOutcome {
                    ok: false,
                    exit_code: -1,
                    timed_out: false,
                    output: format!("Unable to poll verification command: {error}"),
                });
            }
        }
        if started_at.elapsed() >= SWARM_VERIFY_TIMEOUT {
            timed_out = true;
            swarm_kill_verify_child(&mut child);
            let _ = child
                .wait()
                .map_err(|error| format!("Unable to wait for timed-out verification: {error}"))?;
            let output = swarm_verify_output_snapshot(&output);
            return Ok(SwarmVerifyOutcome {
                ok: false,
                exit_code: -1,
                timed_out,
                output,
            });
        }
        sleep(Duration::from_millis(250)).await;
    };
    for reader in readers {
        let _ = reader.join();
    }
    let output = swarm_verify_output_snapshot(&output);
    Ok(SwarmVerifyOutcome {
        ok: !timed_out && status.success(),
        exit_code: if timed_out {
            -1
        } else {
            status.code().unwrap_or(-1)
        },
        timed_out,
        output,
    })
}

async fn swarm_run_verification_once(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    repo_path: &str,
    command: &str,
    cancel: Arc<AtomicBool>,
) -> Result<SwarmVerifyOutcome, String> {
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "verification_started",
        None,
        Some(command.to_string()),
        None,
    )
    .await;
    let outcome = swarm_execute_verify_command(repo_path, command, cancel).await?;
    let output_tail = swarm_tail_chars(&outcome.output, SWARM_VERIFY_OUTPUT_TAIL_CHAR_CAP);
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "verification_result",
        None,
        Some(output_tail),
        Some(json!({
            "ok": outcome.ok,
            "exitCode": outcome.exit_code,
            "timedOut": outcome.timed_out,
        })),
    )
    .await;
    Ok(outcome)
}

async fn swarm_finish_after_synthesis(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    terminal_state: &TerminalState,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    mode: &str,
    champion: &SwarmMemberRef,
    result_text: String,
    cancel: Arc<AtomicBool>,
) {
    if cancel.load(Ordering::SeqCst) {
        return;
    }
    let (repo_path, verify_command) = {
        let entry = swarm_entry(state, workspace_id, swarm_id).await;
        let data = entry.lock().await;
        (
            data.config.repo_path.clone(),
            data.config.verify_command.trim().to_string(),
        )
    };
    if mode != "implement" || verify_command.is_empty() {
        swarm_record_run_result(app, state, workspace_id, swarm_id, run_id, &result_text).await;
        let _ =
            swarm_mark_run_settled(app, state, workspace_id, swarm_id, run_id, "done", "").await;
        return;
    }

    let first = match swarm_run_verification_once(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        &repo_path,
        &verify_command,
        Arc::clone(&cancel),
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            let _ = swarm_mark_run_settled(
                app,
                state,
                workspace_id,
                swarm_id,
                run_id,
                "failed",
                &format!("Verification failed: {error}"),
            )
            .await;
            return;
        }
    };
    if first.ok {
        swarm_record_run_result(app, state, workspace_id, swarm_id, run_id, &result_text).await;
        let _ =
            swarm_mark_run_settled(app, state, workspace_id, swarm_id, run_id, "done", "").await;
        return;
    }

    let output_tail = swarm_tail_chars(&first.output, SWARM_VERIFY_OUTPUT_TAIL_CHAR_CAP);
    let _ = swarm_append_run_event(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        "repair_started",
        Some(champion.member_id.clone()),
        Some("Repair started after verification failure.".to_string()),
        None,
    )
    .await;
    swarm_update_member_status(
        state,
        workspace_id,
        swarm_id,
        &champion.member_id,
        "working",
        Some(false),
        Some(swarm_now_ms()),
        None,
    )
    .await;
    swarm_emit_state(app, workspace_id, swarm_id);

    let repair_prompt = swarm_repair_prompt(&verify_command, first.exit_code, &output_tail);
    if let Err(error) = swarm_enqueue_prompt(app, champion, run_id, "repair", repair_prompt).await {
        let _ = swarm_append_run_event(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "member_error",
            Some(champion.member_id.clone()),
            Some(error.clone()),
            None,
        )
        .await;
        let _ = swarm_mark_run_settled(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "failed",
            &format!("Unable to deliver repair prompt: {error}"),
        )
        .await;
        return;
    }
    if let Err(error) = swarm_wait_member_idle(
        state,
        terminal_state,
        app,
        workspace_id,
        swarm_id,
        champion,
        Arc::clone(&cancel),
        Duration::from_secs(SWARM_SYNTHESIS_TIMEOUT_SECS),
    )
    .await
    {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let _ = swarm_mark_run_settled(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "failed",
            &format!("Repair failed: {error}"),
        )
        .await;
        return;
    }
    let repair_text = match swarm_capture_final_message(
        terminal_state,
        workspace_id,
        champion,
        SWARM_TAKE_SENTINEL,
    )
    .await
    {
        Ok(text) => text,
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            let _ = swarm_mark_run_settled(
                app,
                state,
                workspace_id,
                swarm_id,
                run_id,
                "failed",
                &format!("Unable to capture repair result: {error}"),
            )
            .await;
            return;
        }
    };
    if cancel.load(Ordering::SeqCst) {
        return;
    }

    let second = match swarm_run_verification_once(
        app,
        state,
        workspace_id,
        swarm_id,
        run_id,
        &repo_path,
        &verify_command,
        Arc::clone(&cancel),
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            let _ = swarm_mark_run_settled(
                app,
                state,
                workspace_id,
                swarm_id,
                run_id,
                "failed",
                &format!("Verification failed after repair: {error}"),
            )
            .await;
            return;
        }
    };
    if second.ok {
        swarm_record_run_result(app, state, workspace_id, swarm_id, run_id, &repair_text).await;
        let _ =
            swarm_mark_run_settled(app, state, workspace_id, swarm_id, run_id, "done", "").await;
    } else {
        let _ = swarm_mark_run_settled(
            app,
            state,
            workspace_id,
            swarm_id,
            run_id,
            "failed",
            &format!(
                "verification failed after repair: exit {}",
                second.exit_code
            ),
        )
        .await;
    }
}

async fn swarm_run_conductor(
    app: AppHandle,
    state: SwarmRuntimeState,
    workspace_id: String,
    swarm_id: String,
    run_id: String,
    prompt: String,
    mode: String,
    ready_members: Vec<SwarmMemberRef>,
    cancel: Arc<AtomicBool>,
) {
    let _ = swarm_append_run_event(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        "run_started",
        None,
        Some("Swarm run started.".to_string()),
        Some(json!({
            "prompt": prompt,
            "mode": mode,
            "members": ready_members.len(),
        })),
    )
    .await;

    let context_pack = swarm_context_pack_phase(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        &prompt,
        &ready_members,
        Arc::clone(&cancel),
    )
    .await;
    if cancel.load(Ordering::SeqCst) {
        return;
    }

    let terminal_state = app.state::<TerminalState>();
    swarm_refresh_members_from_terminals(&state, terminal_state.inner(), &workspace_id, &swarm_id)
        .await;
    let take_members = {
        let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
        let data = entry.lock().await;
        swarm_ready_member_refs_from_data(&data)
    };

    let mut tasks = Vec::new();
    for member in take_members.clone() {
        let task_app = app.clone();
        let task_state = state.clone();
        let task_workspace_id = workspace_id.clone();
        let task_swarm_id = swarm_id.clone();
        let task_run_id = run_id.clone();
        let task_prompt = prompt.clone();
        let task_context_pack = context_pack.clone();
        let task_cancel = Arc::clone(&cancel);
        tasks.push(tauri::async_runtime::spawn(async move {
            swarm_member_take_task(
                task_app,
                task_state,
                task_workspace_id,
                task_swarm_id,
                task_run_id,
                task_prompt,
                task_context_pack,
                member,
                task_cancel,
            )
            .await
        }));
    }

    let mut takes = Vec::new();
    for task in tasks {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        if let Ok(result) = task.await {
            if !result.text.trim().is_empty() {
                takes.push(result);
            }
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return;
    }

    let (trimmed_takes, trimmed_fuse_chars) = swarm_trim_takes_for_fuse(&takes);
    let mut gate_data = serde_json::Map::new();
    gate_data.insert("takes".to_string(), json!(takes.len()));
    let mut converged_take = None;
    let mut convergence_similarity = None;
    if takes.len() >= 2 {
        let similarity = swarm_mean_pairwise_jaccard(&takes);
        let rounded_similarity = swarm_round_2(similarity);
        let converged = similarity >= SWARM_CONVERGENCE_JACCARD;
        gate_data.insert("converged".to_string(), json!(converged));
        gate_data.insert("similarity".to_string(), json!(rounded_similarity));
        convergence_similarity = Some(rounded_similarity);
        if converged {
            converged_take = swarm_choose_highest_score_take(
                &state,
                &workspace_id,
                &swarm_id,
                &takes,
                &take_members,
            )
            .await;
            if let Some(winner) = converged_take.as_ref() {
                gate_data.insert(
                    "winnerMemberId".to_string(),
                    json!(winner.member_id.clone()),
                );
            }
        }
    }

    let converged_execution_take = if mode == "implement" {
        if let Some(winner) = converged_take.as_ref() {
            let trimmed_winner = trimmed_takes
                .iter()
                .find(|take| take.member_id == winner.member_id)
                .map(|take| take.text.clone())
                .unwrap_or_else(|| swarm_trim_take_for_fuse(&winner.text));
            Some(trimmed_winner)
        } else if takes.len() == 1 {
            Some(swarm_trim_take_for_fuse(&takes[0].text))
        } else {
            None
        }
    } else {
        None
    };
    let fuse_chars = if mode == "plan" && converged_take.is_some() {
        0
    } else if let Some(winning_take) = converged_execution_take.as_ref() {
        swarm_char_count(winning_take)
    } else {
        trimmed_fuse_chars
    };
    gate_data.insert("fuseChars".to_string(), json!(fuse_chars));

    let _ = swarm_append_run_event(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        "gate_decision",
        None,
        Some(if takes.is_empty() {
            "No member takes arrived; failing run.".to_string()
        } else if let Some(winner) = converged_take.as_ref() {
            format!(
                "Members converged at {:.2} similarity; winning take: {}.",
                convergence_similarity.unwrap_or(0.0),
                winner.member_id
            )
        } else {
            format!("Proceeding with {} member take(s).", takes.len())
        }),
        Some(Value::Object(gate_data)),
    )
    .await;

    if takes.is_empty() {
        let _ = swarm_mark_run_settled(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            "failed",
            "No member takes arrived before the take phase completed.",
        )
        .await;
        return;
    }

    if mode == "plan" {
        if let Some(winner) = converged_take.as_ref() {
            swarm_increment_member_stat(
                &state,
                &workspace_id,
                &swarm_id,
                &winner.member_id,
                "championRuns",
            )
            .await;
            let result = format!(
                "Members converged at {:.2} similarity; using {}'s take.\n\n{}",
                convergence_similarity.unwrap_or(0.0),
                winner.member_id,
                winner.text
            );
            swarm_record_run_result(&app, &state, &workspace_id, &swarm_id, &run_id, &result).await;
            let _ =
                swarm_mark_run_settled(&app, &state, &workspace_id, &swarm_id, &run_id, "done", "")
                    .await;
            return;
        }
    }

    let Some(champion) =
        swarm_choose_champion(&state, &workspace_id, &swarm_id, &takes, &take_members).await
    else {
        let _ = swarm_mark_run_settled(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            "failed",
            "No ready champion member was available for synthesis.",
        )
        .await;
        return;
    };

    let _ = swarm_append_run_event(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        "synthesis_started",
        Some(champion.member_id.clone()),
        Some(if converged_execution_take.is_some() {
            "Converged execution started.".to_string()
        } else {
            "Synthesis started.".to_string()
        }),
        Some(json!({ "mode": mode })),
    )
    .await;
    swarm_increment_member_stat(
        &state,
        &workspace_id,
        &swarm_id,
        &champion.member_id,
        "championRuns",
    )
    .await;

    let synthesis_prompt = if let Some(winning_take) = converged_execution_take.as_ref() {
        swarm_converged_execution_prompt(winning_take)
    } else {
        swarm_synthesis_prompt(&prompt, &mode, &trimmed_takes, context_pack.as_deref())
    };
    if let Err(error) =
        swarm_enqueue_prompt(&app, &champion, &run_id, "synthesis", synthesis_prompt).await
    {
        let _ = swarm_append_run_event(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            "member_error",
            Some(champion.member_id.clone()),
            Some(error.clone()),
            None,
        )
        .await;
        let _ = swarm_mark_run_settled(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &run_id,
            "failed",
            &format!("Unable to deliver synthesis prompt: {error}"),
        )
        .await;
        return;
    }

    match swarm_wait_member_idle(
        &state,
        terminal_state.inner(),
        &app,
        &workspace_id,
        &swarm_id,
        &champion,
        Arc::clone(&cancel),
        Duration::from_secs(SWARM_SYNTHESIS_TIMEOUT_SECS),
    )
    .await
    {
        Ok(()) => {
            match swarm_capture_final_message(
                terminal_state.inner(),
                &workspace_id,
                &champion,
                SWARM_TAKE_SENTINEL,
            )
            .await
            {
                Ok(text) => {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }
                    swarm_finish_after_synthesis(
                        &app,
                        &state,
                        terminal_state.inner(),
                        &workspace_id,
                        &swarm_id,
                        &run_id,
                        &mode,
                        &champion,
                        text,
                        Arc::clone(&cancel),
                    )
                    .await;
                }
                Err(error) => {
                    let _ = swarm_mark_run_settled(
                        &app,
                        &state,
                        &workspace_id,
                        &swarm_id,
                        &run_id,
                        "failed",
                        &format!("Unable to capture synthesis result: {error}"),
                    )
                    .await;
                }
            }
        }
        Err(error) => {
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            let _ = swarm_mark_run_settled(
                &app,
                &state,
                &workspace_id,
                &swarm_id,
                &run_id,
                "failed",
                &format!("Synthesis failed: {error}"),
            )
            .await;
        }
    }
}

async fn swarm_open_member(
    app: &AppHandle,
    spec: &SwarmMemberRuntime,
    workspace_id: &str,
    repo_path: &str,
) -> Result<TerminalOpenResult, String> {
    let terminal_state = app.state::<TerminalState>();
    let cloud_mcp_state = app.state::<CloudMcpState>();
    let app_control_mcp_state = app.state::<AppControlMcpState>();
    let model = (!spec.model.trim().is_empty()).then(|| spec.model.clone());
    let output_channel = Channel::new(|_body: InvokeResponseBody| Ok(()));
    terminal_open(
        app.clone(),
        terminal_state,
        cloud_mcp_state,
        app_control_mcp_state,
        TerminalOpenRequest {
            pane_id: spec.pane_id.clone(),
            instance_id: None,
            kind: spec.provider.clone(),
            agent_id: Some(spec.provider.clone()),
            agent_kind: Some(spec.provider.clone()),
            provider: Some(spec.provider.clone()),
            provider_session_id: None,
            fork_from_provider_session_id: None,
            model,
            reasoning_effort: None,
            speed: None,
            permission_mode: Some(TERMINAL_PERMISSION_MODE_BYPASS.to_string()),
            plain_shell: Some(false),
            fresh_session: Some(true),
            preserve_coordination_session: Some(false),
            session_mode: Some(TerminalSessionMode::General.as_str().to_string()),
            slot_key: Some(spec.pane_id.clone()),
            terminal_index: None,
            thread_id: Some(format!("swarm:{}:{}", spec.pane_id, spec.member_id)),
            working_directory: Some(repo_path.to_string()),
            workspace_root_was_empty_at_selection: Some(false),
            project_root: None,
            mount_id: None,
            workspace_id: Some(workspace_id.to_string()),
            workspace_name: Some(workspace_id.to_string()),
            terminal_name: Some(spec.label.clone()),
            terminal_nickname: Some(spec.label.clone()),
            app_control_mcp: Some(false),
            cols: Some(TERMINAL_DEFAULT_COLS),
            rows: Some(TERMINAL_DEFAULT_ROWS),
            output_transport: Some(false),
        },
        output_channel,
    )
    .await
}

async fn swarm_close_member(app: &AppHandle, member: &SwarmMemberRuntime) -> Result<bool, String> {
    let terminal_state = app.state::<TerminalState>();
    let cloud_mcp_state = app.state::<CloudMcpState>();
    close_terminal_session(
        Some(app.clone()),
        terminal_state.inner(),
        Some(cloud_mcp_state.inner()),
        &member.pane_id,
        member.instance_id,
        false,
        false,
    )
    .await
}

fn swarm_terminal_open_result_status(result: &TerminalOpenResult) -> (String, bool, u64) {
    let idle = result.input_ready
        || terminal_projection_state_is_idle(&result.activity_status)
        || terminal_projection_state_is_idle(&result.command_phase)
        || terminal_projection_state_is_idle(&result.terminal_work_state);
    let status = if idle { "ready" } else { "spawning" };
    (status.to_string(), idle, swarm_now_ms())
}

async fn swarm_spawn_member_and_update(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    member_id: &str,
) {
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let (member, repo_path) = {
        let data = entry.lock().await;
        let Some(member) = data.members.get(member_id).cloned() else {
            return;
        };
        (member, data.config.repo_path.clone())
    };
    match swarm_open_member(app, &member, workspace_id, &repo_path).await {
        Ok(result) => {
            let (status, input_ready, last_activity_at) =
                swarm_terminal_open_result_status(&result);
            {
                let mut data = entry.lock().await;
                if let Some(member) = data.members.get_mut(member_id) {
                    member.instance_id = Some(result.instance_id);
                    member.status = status;
                    member.input_ready = input_ready;
                    member.last_activity_at = last_activity_at;
                    member.last_error.clear();
                }
            }
            swarm_emit_state(app, workspace_id, swarm_id);
            swarm_spawn_readiness_monitor(
                app.clone(),
                state.clone(),
                workspace_id.to_string(),
                swarm_id.to_string(),
                member_id.to_string(),
                result.instance_id,
            );
        }
        Err(error) => {
            let mut data = entry.lock().await;
            if let Some(member) = data.members.get_mut(member_id) {
                member.status = "error".to_string();
                member.input_ready = false;
                member.last_activity_at = swarm_now_ms();
                member.last_error = error;
                member.stats.errors = member.stats.errors.saturating_add(1);
            }
            drop(data);
            swarm_emit_state(app, workspace_id, swarm_id);
        }
    }
}

fn swarm_spawn_readiness_monitor(
    app: AppHandle,
    state: SwarmRuntimeState,
    workspace_id: String,
    swarm_id: String,
    member_id: String,
    instance_id: u64,
) {
    tauri::async_runtime::spawn(async move {
        let terminal_state = app.state::<TerminalState>();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(SWARM_SPAWN_READY_MONITOR_SECS) {
            let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
            let pane_id = {
                let data = entry.lock().await;
                let Some(member) = data.members.get(&member_id) else {
                    return;
                };
                if member.instance_id != Some(instance_id) {
                    return;
                }
                member.pane_id.clone()
            };
            if let Some((current_instance_id, runtime, _, _)) =
                swarm_terminal_snapshot(terminal_state.inner(), &pane_id).await
            {
                if current_instance_id != instance_id {
                    return;
                }
                let (status, input_ready, last_activity_at) =
                    swarm_member_status_from_runtime(&runtime);
                swarm_update_member_status(
                    &state,
                    &workspace_id,
                    &swarm_id,
                    &member_id,
                    &status,
                    Some(input_ready),
                    Some(last_activity_at),
                    None,
                )
                .await;
                swarm_emit_state(&app, &workspace_id, &swarm_id);
                if input_ready || status == "error" {
                    return;
                }
            }
            sleep(Duration::from_millis(SWARM_IDLE_POLL_MS)).await;
        }
    });
}

#[tauri::command]
async fn swarm_get_state(
    state: State<'_, SwarmRuntimeState>,
    terminal_state: State<'_, TerminalState>,
    workspace_id: String,
    swarm_id: String,
) -> Result<SwarmState, String> {
    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    drop(entry);
    swarm_refresh_members_from_terminals(&state, &terminal_state, &workspace_id, &swarm_id).await;
    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    let data = entry.lock().await;
    Ok(swarm_state_from_data(&data))
}

#[tauri::command]
async fn swarm_configure(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    workspace_id: String,
    swarm_id: String,
    repo_path: String,
    members: Vec<MemberSpec>,
    champion_member_id: Option<String>,
    scout_member_id: Option<String>,
    verify_command: Option<String>,
) -> Result<SwarmState, String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err("repo_path is required.".to_string());
    }
    let resolved_members = swarm_resolve_member_specs(members)?;
    let config = swarm_config_from_parts(
        &workspace_id,
        &swarm_id,
        &repo_path,
        resolved_members.clone(),
        champion_member_id,
        scout_member_id,
        verify_command,
    );
    swarm_save_config(&config)?;

    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    let (to_close, to_spawn) = {
        let mut data = entry.lock().await;
        data.config = config.clone();
        let desired_ids = resolved_members
            .iter()
            .filter_map(|spec| spec.member_id.clone())
            .collect::<HashSet<_>>();
        let mut to_close = Vec::new();
        let mut to_spawn = Vec::new();

        let existing_ids = data.members.keys().cloned().collect::<Vec<_>>();
        for existing_id in existing_ids {
            if !desired_ids.contains(&existing_id) {
                if let Some(member) = data.members.remove(&existing_id) {
                    to_close.push(member);
                }
            }
        }

        for spec in &resolved_members {
            let next_member = swarm_member_from_spec(&swarm_id, spec)?;
            match data.members.get_mut(&next_member.member_id) {
                Some(existing)
                    if existing.provider == next_member.provider
                        && existing.model == next_member.model =>
                {
                    existing.label = next_member.label;
                }
                Some(existing) => {
                    to_close.push(existing.clone());
                    let mut spawning = next_member.clone();
                    spawning.status = "spawning".to_string();
                    data.members.insert(spawning.member_id.clone(), spawning);
                    to_spawn.push(next_member.member_id);
                }
                None => {
                    let mut spawning = next_member.clone();
                    spawning.status = "spawning".to_string();
                    data.members.insert(spawning.member_id.clone(), spawning);
                    to_spawn.push(next_member.member_id);
                }
            }
        }
        (to_close, to_spawn)
    };

    for member in to_close {
        let _ = swarm_close_member(&app, &member).await;
    }
    for member_id in to_spawn {
        swarm_spawn_member_and_update(&app, &state, &workspace_id, &swarm_id, &member_id).await;
    }

    swarm_emit_state(&app, &workspace_id, &swarm_id);
    let data = entry.lock().await;
    Ok(swarm_state_from_data(&data))
}

#[tauri::command]
async fn swarm_member_restart(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    workspace_id: String,
    swarm_id: String,
    member_id: String,
) -> Result<SwarmState, String> {
    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    let member = {
        let mut data = entry.lock().await;
        let Some(member) = data.members.get_mut(&member_id) else {
            return Err("Swarm member not found.".to_string());
        };
        member.status = "spawning".to_string();
        member.input_ready = false;
        member.clone()
    };
    let _ = swarm_close_member(&app, &member).await;
    swarm_spawn_member_and_update(&app, &state, &workspace_id, &swarm_id, &member_id).await;
    swarm_emit_state(&app, &workspace_id, &swarm_id);
    let data = entry.lock().await;
    Ok(swarm_state_from_data(&data))
}

async fn swarm_activate_internal(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    workspace_id: &str,
    swarm_id: &str,
    repo_path: &str,
    member_id: Option<String>,
) -> Result<SwarmState, String> {
    let repo_path = repo_path.trim().to_string();
    let target_member_id = member_id
        .map(|value| swarm_normalize_member_id(&value))
        .filter(|value| !value.trim().is_empty());
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let (to_close, to_spawn) = {
        let mut data = entry.lock().await;
        if !repo_path.is_empty() && data.config.repo_path != repo_path {
            data.config.repo_path = repo_path.clone();
            data.config.updated_at = swarm_now_ms();
            let _ = swarm_save_config(&data.config);
        }
        if data.config.repo_path.trim().is_empty() {
            return Err("repo_path is required.".to_string());
        }
        let mut to_close = Vec::new();
        let mut to_spawn = Vec::new();
        for member in data.members.values_mut() {
            if let Some(target_member_id) = target_member_id.as_deref() {
                if member.member_id != target_member_id {
                    continue;
                }
            }
            let needs_spawn = matches!(member.status.as_str(), "offline" | "dead" | "error")
                || member.instance_id.is_none();
            if !needs_spawn {
                continue;
            }
            if member.instance_id.is_some() {
                to_close.push(member.clone());
            }
            member.status = "spawning".to_string();
            member.input_ready = false;
            member.last_activity_at = swarm_now_ms();
            member.last_error.clear();
            to_spawn.push(member.member_id.clone());
        }
        (to_close, to_spawn)
    };
    for member in to_close {
        let _ = swarm_close_member(app, &member).await;
    }
    for member_id in to_spawn {
        swarm_spawn_member_and_update(app, state, workspace_id, swarm_id, &member_id).await;
    }
    swarm_emit_state(app, workspace_id, swarm_id);
    let data = entry.lock().await;
    Ok(swarm_state_from_data(&data))
}

#[tauri::command]
async fn swarm_activate(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    workspace_id: String,
    swarm_id: String,
    repo_path: String,
    member_id: Option<String>,
) -> Result<SwarmState, String> {
    swarm_activate_internal(
        &app,
        state.inner(),
        &workspace_id,
        &swarm_id,
        &repo_path,
        member_id,
    )
    .await
}

pub(crate) async fn swarm_can_submit_task_internal(
    state: &SwarmRuntimeState,
    terminal_state: &TerminalState,
    workspace_id: &str,
    swarm_id: &str,
) -> Result<(), String> {
    swarm_refresh_members_from_terminals(state, terminal_state, workspace_id, swarm_id).await;
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let data = entry.lock().await;
    if !data.active_run_id.trim().is_empty() {
        return Err("A swarm run is already active.".to_string());
    }
    if swarm_ready_member_refs_from_data(&data).is_empty() {
        return Err("No swarm members are ready.".to_string());
    }
    Ok(())
}

pub(crate) async fn swarm_submit_task_internal(
    app: &AppHandle,
    state: &SwarmRuntimeState,
    terminal_state: &TerminalState,
    workspace_id: &str,
    swarm_id: &str,
    prompt: &str,
    mode: &str,
) -> Result<String, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt is required.".to_string());
    }
    let mode = mode.trim().to_ascii_lowercase();
    let mode = if mode.is_empty() {
        "plan".to_string()
    } else {
        mode
    };
    if !matches!(mode.as_str(), "plan" | "implement") {
        return Err("Swarm mode must be plan or implement.".to_string());
    }

    swarm_refresh_members_from_terminals(state, terminal_state, workspace_id, swarm_id).await;
    let entry = swarm_entry(state, workspace_id, swarm_id).await;
    let (run_id, ready_members, cancel) = {
        let mut data = entry.lock().await;
        if !data.active_run_id.trim().is_empty() {
            return Err("A swarm run is already active.".to_string());
        }
        let ready_members = swarm_ready_member_refs_from_data(&data);
        if ready_members.is_empty() {
            return Err("No swarm members are ready.".to_string());
        }
        let run_id = swarm_make_run_id();
        let cancel = Arc::new(AtomicBool::new(false));
        data.active_run_id = run_id.clone();
        data.active_run_cancel = Some(Arc::clone(&cancel));
        swarm_upsert_run_summary(
            &mut data,
            RunSummary {
                run_id: run_id.clone(),
                status: "running".to_string(),
                prompt: prompt.clone(),
                mode: mode.clone(),
                started_at: swarm_now_ms(),
                settled_at: 0,
                result_summary: String::new(),
            },
        );
        (run_id, ready_members, cancel)
    };
    swarm_emit_state(app, workspace_id, swarm_id);

    let task_app = app.clone();
    let task_state = state.clone();
    let task_workspace_id = workspace_id.to_string();
    let task_swarm_id = swarm_id.to_string();
    let task_run_id = run_id.clone();
    let task_prompt = prompt.clone();
    let task_mode = mode.clone();
    tauri::async_runtime::spawn(async move {
        swarm_run_conductor(
            task_app,
            task_state,
            task_workspace_id,
            task_swarm_id,
            task_run_id,
            task_prompt,
            task_mode,
            ready_members,
            cancel,
        )
        .await;
    });

    Ok(run_id)
}

#[tauri::command]
async fn swarm_submit_task(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    terminal_state: State<'_, TerminalState>,
    workspace_id: String,
    swarm_id: String,
    prompt: String,
    mode: Option<String>,
) -> Result<SwarmSubmitTaskResult, String> {
    let run_id = swarm_submit_task_internal(
        &app,
        state.inner(),
        terminal_state.inner(),
        &workspace_id,
        &swarm_id,
        &prompt,
        mode.as_deref().unwrap_or("plan"),
    )
    .await?;
    Ok(SwarmSubmitTaskResult { run_id })
}

#[tauri::command]
async fn swarm_cancel_run(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    workspace_id: String,
    swarm_id: String,
    run_id: String,
) -> Result<SwarmState, String> {
    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    let members = {
        let data = entry.lock().await;
        if data.active_run_id != run_id {
            return Ok(swarm_state_from_data(&data));
        }
        if let Some(cancel) = data.active_run_cancel.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
        data.members.values().cloned().collect::<Vec<_>>()
    };
    for member in members {
        if let Some(instance_id) = member.instance_id {
            let _ = terminal_interrupt_agent_remote(
                app.clone(),
                member.pane_id.clone(),
                Some(instance_id),
                "swarm_cancel_run".to_string(),
            )
            .await;
        }
    }
    let _ = swarm_mark_run_settled(
        &app,
        &state,
        &workspace_id,
        &swarm_id,
        &run_id,
        "cancelled",
        "Swarm run cancelled.",
    )
    .await?;
    let data = entry.lock().await;
    Ok(swarm_state_from_data(&data))
}

#[tauri::command]
async fn swarm_run_events(
    workspace_id: String,
    swarm_id: String,
    run_id: String,
    after_seq: Option<u64>,
) -> Result<SwarmRunEventsResult, String> {
    let events = swarm_load_run_events(&workspace_id, &swarm_id, &run_id);
    let latest_seq = events.iter().map(|event| event.seq).max().unwrap_or(0);
    let after_seq = after_seq.unwrap_or(0);
    Ok(SwarmRunEventsResult {
        events: events
            .into_iter()
            .filter(|event| event.seq > after_seq)
            .collect(),
        latest_seq,
    })
}

#[tauri::command]
async fn swarm_dispose(
    app: AppHandle,
    state: State<'_, SwarmRuntimeState>,
    workspace_id: String,
    swarm_id: String,
) -> Result<SwarmState, String> {
    let key = swarm_key(&workspace_id, &swarm_id);
    let entry = swarm_entry(&state, &workspace_id, &swarm_id).await;
    let (members, active_run_id) = {
        let mut data = entry.lock().await;
        if let Some(cancel) = data.active_run_cancel.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
        let active_run_id = data.active_run_id.clone();
        data.active_run_id.clear();
        data.active_run_cancel = None;
        (
            data.members.values().cloned().collect::<Vec<_>>(),
            active_run_id,
        )
    };
    if !active_run_id.trim().is_empty() {
        let _ = swarm_append_run_event(
            &app,
            &state,
            &workspace_id,
            &swarm_id,
            &active_run_id,
            "run_settled",
            None,
            Some("Swarm disposed while run was active.".to_string()),
            Some(json!({ "status": "cancelled" })),
        )
        .await;
    }
    for member in &members {
        let _ = swarm_close_member(&app, member).await;
    }
    {
        let mut swarms = state.swarms.write().await;
        swarms.remove(&key);
    }
    swarm_emit_state(&app, &workspace_id, &swarm_id);
    let mut disposed = swarm_new_runtime_data(&workspace_id, &swarm_id);
    for member in disposed.members.values_mut() {
        member.status = "offline".to_string();
        member.input_ready = false;
        member.instance_id = None;
    }
    Ok(swarm_state_from_data(&disposed))
}

#[cfg(test)]
mod swarm_runtime_tests {
    use super::*;

    #[test]
    fn swarm_score_formula_matches_contract() {
        let stats = MemberStats {
            takes_delivered: 3,
            champion_runs: 2,
            reaps: 1,
            errors: 2,
            scout_runs: 99,
        };
        assert_eq!(swarm_member_score(&stats), 4);
    }

    #[test]
    fn swarm_safe_component_is_stable_for_workspace_ids() {
        assert_eq!(
            swarm_safe_component("team/workspace:main"),
            "team_workspace_main"
        );
        assert_eq!(swarm_safe_component(""), "default");
    }

    #[test]
    fn swarm_member_specs_assign_ids_and_validate_providers() {
        let members = swarm_resolve_member_specs(vec![
            MemberSpec {
                provider: "codex".to_string(),
                ..MemberSpec::default()
            },
            MemberSpec {
                member_id: Some("researcher.one".to_string()),
                provider: "claude".to_string(),
                ..MemberSpec::default()
            },
        ])
        .unwrap();
        assert_eq!(members[0].member_id.as_deref(), Some("m1"));
        assert_eq!(members[1].member_id.as_deref(), Some("researcher_one"));
        assert!(swarm_resolve_member_specs(vec![MemberSpec {
            provider: "bad".to_string(),
            ..MemberSpec::default()
        }])
        .is_err());
    }

    #[test]
    fn swarm_auto_scout_prefers_lowest_cost_then_member_order() {
        let members = vec![
            SwarmMemberRef {
                member_id: "codex_first".to_string(),
                provider: "codex".to_string(),
                pane_id: "swarm:test:codex_first".to_string(),
                instance_id: 1,
            },
            SwarmMemberRef {
                member_id: "open_first".to_string(),
                provider: "opencode".to_string(),
                pane_id: "swarm:test:open_first".to_string(),
                instance_id: 2,
            },
            SwarmMemberRef {
                member_id: "open_second".to_string(),
                provider: "opencode".to_string(),
                pane_id: "swarm:test:open_second".to_string(),
                instance_id: 3,
            },
            SwarmMemberRef {
                member_id: "claude_last".to_string(),
                provider: "claude".to_string(),
                pane_id: "swarm:test:claude_last".to_string(),
                instance_id: 4,
            },
        ];
        let scout = swarm_choose_auto_scout(&members).unwrap();
        assert_eq!(scout.member_id, "open_first");
    }

    #[test]
    fn swarm_config_resolves_scout_member_id_to_auto_when_unknown() {
        let members = swarm_resolve_member_specs(vec![
            MemberSpec {
                member_id: Some("researcher.one".to_string()),
                provider: "codex".to_string(),
                ..MemberSpec::default()
            },
            MemberSpec {
                member_id: Some("cheap".to_string()),
                provider: "opencode".to_string(),
                ..MemberSpec::default()
            },
        ])
        .unwrap();
        let config = swarm_config_from_parts(
            "workspace",
            "swarm-abc",
            "/repo",
            members.clone(),
            None,
            Some("researcher.one".to_string()),
            Some(" cargo test ".to_string()),
        );
        assert_eq!(config.scout_member_id, "researcher_one");
        assert_eq!(config.verify_command, "cargo test");
        let auto_config = swarm_config_from_parts(
            "workspace",
            "swarm-abc",
            "/repo",
            members,
            None,
            Some("missing".to_string()),
            None,
        );
        assert_eq!(auto_config.scout_member_id, "");
        assert_eq!(auto_config.verify_command, "");
    }

    #[test]
    fn swarm_config_defaults_missing_verify_command() {
        let config = serde_json::from_str::<SwarmConfig>(
            r#"{
                "swarmId": "swarm-abc",
                "workspaceId": "workspace",
                "repoPath": "/repo",
                "members": []
            }"#,
        )
        .unwrap();
        assert_eq!(config.verify_command, "");
    }

    #[test]
    fn swarm_context_pack_file_round_trips_metadata() {
        let pack = SwarmContextPackCache {
            at: 42,
            text: "Repo map\n- src-tauri: backend".to_string(),
        };
        let file_text = swarm_context_pack_file_text(&pack);
        let parsed = swarm_parse_context_pack_file(&file_text, 7).unwrap();
        assert_eq!(parsed.at, 42);
        assert_eq!(parsed.text, pack.text);

        let legacy = swarm_parse_context_pack_file("legacy pack", 7).unwrap();
        assert_eq!(legacy.at, 7);
        assert_eq!(legacy.text, "legacy pack");
    }

    #[test]
    fn swarm_fuse_trim_keeps_under_cap_and_elides_head_tail() {
        assert_eq!(
            swarm_trim_take_for_fuse_with_cap("short take", 80),
            "short take"
        );

        let long_take = (0..20)
            .map(|index| format!("line{index:02} {}", "x".repeat(10)))
            .collect::<Vec<_>>()
            .join("\n");
        let trimmed = swarm_trim_take_for_fuse_with_cap(&long_take, 80);
        assert!(swarm_char_count(&trimmed) <= 80);
        assert!(trimmed.contains(SWARM_TAKE_ELISION_MARKER));
        assert!(trimmed.starts_with("line00"));
        assert!(trimmed.contains("line19"));
        assert!(!trimmed.contains("line10"));
    }

    #[test]
    fn swarm_fuse_trim_retrims_to_total_budget() {
        let long_take = (0..20)
            .map(|index| format!("line{index:02} {}", "x".repeat(10)))
            .collect::<Vec<_>>()
            .join("\n");
        let takes = vec![
            SwarmTakeResult {
                member_id: "m1".to_string(),
                text: long_take.clone(),
            },
            SwarmTakeResult {
                member_id: "m2".to_string(),
                text: long_take.clone(),
            },
            SwarmTakeResult {
                member_id: "m3".to_string(),
                text: long_take,
            },
        ];
        let (trimmed, total) = swarm_trim_takes_for_fuse_with_caps(&takes, 80, 120);
        assert!(total <= 120);
        assert!(trimmed
            .iter()
            .all(|take| swarm_char_count(&take.text) <= 40));
    }

    #[test]
    fn swarm_jaccard_convergence_scores_expected_cases() {
        assert_eq!(
            swarm_jaccard_similarity("alpha beta gamma delta", "alpha beta gamma delta"),
            1.0
        );
        assert_eq!(
            swarm_jaccard_similarity("alpha beta gamma delta", "omega sigma theta lambda"),
            0.0
        );
        let converged = vec![
            SwarmTakeResult {
                member_id: "m1".to_string(),
                text: "alpha beta gamma delta epsilon".to_string(),
            },
            SwarmTakeResult {
                member_id: "m2".to_string(),
                text: "alpha beta gamma delta zeta".to_string(),
            },
        ];
        assert!(swarm_mean_pairwise_jaccard(&converged) >= SWARM_CONVERGENCE_JACCARD);

        let divergent = vec![
            SwarmTakeResult {
                member_id: "m1".to_string(),
                text: "alpha beta gamma delta".to_string(),
            },
            SwarmTakeResult {
                member_id: "m2".to_string(),
                text: "omega sigma theta lambda".to_string(),
            },
        ];
        assert!(swarm_mean_pairwise_jaccard(&divergent) < SWARM_CONVERGENCE_JACCARD);
    }

    #[test]
    fn swarm_pack_reuse_overlap_rejects_vague_and_accepts_overlap() {
        assert_eq!(swarm_pack_reuse_overlap("fix bug", "fix bug details"), None);
        let overlap = swarm_pack_reuse_overlap(
            "update cargo check swarm runtime verify command",
            "The swarm runtime section documents cargo check and verify command behavior.",
        )
        .unwrap();
        assert!(overlap >= SWARM_PACK_REUSE_OVERLAP);
    }

    #[test]
    fn swarm_pack_cap_truncates_on_line_boundary_with_marker() {
        let line = "abcdefghijklmnopqrstuvwxyz";
        let pack = format!("{}\n", line).repeat(1_100);
        let truncated = swarm_truncate_pack_to_cap(&pack);
        assert!(swarm_char_count(&truncated) < swarm_char_count(&pack));
        assert!(swarm_char_count(&truncated) <= SWARM_PACK_CHAR_CAP);
        assert!(truncated.ends_with(SWARM_PACK_TRUNCATED_MARKER));
        let body = truncated
            .trim_end_matches(SWARM_PACK_TRUNCATED_MARKER)
            .trim_end();
        assert!(swarm_char_count(body) <= SWARM_PACK_CHAR_CAP);
        assert!(body.lines().all(|candidate| candidate == line));
    }

    #[test]
    fn swarm_run_summary_updates_from_events() {
        let events = vec![
            SwarmRunEvent {
                seq: 1,
                run_id: "run-1".to_string(),
                at: 10,
                kind: "run_started".to_string(),
                member_id: None,
                text: None,
                data: Some(json!({ "prompt": "do work", "mode": "implement" })),
            },
            SwarmRunEvent {
                seq: 2,
                run_id: "run-1".to_string(),
                at: 20,
                kind: "run_result".to_string(),
                member_id: None,
                text: Some("finished".to_string()),
                data: None,
            },
            SwarmRunEvent {
                seq: 3,
                run_id: "run-1".to_string(),
                at: 30,
                kind: "run_settled".to_string(),
                member_id: None,
                text: None,
                data: Some(json!({ "status": "done" })),
            },
        ];
        let summary = swarm_run_summary_from_events(&events).unwrap();
        assert_eq!(summary.run_id, "run-1");
        assert_eq!(summary.mode, "implement");
        assert_eq!(summary.status, "done");
        assert_eq!(summary.result_summary, "finished");
        assert_eq!(summary.settled_at, 30);
    }
}
