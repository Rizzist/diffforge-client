const ARCHITECTURE_GRAPH_MAX_BYTES: u64 = 16 * 1024 * 1024;
const ARCHITECTURE_GRAPH_ID_MAX: usize = 96;
const ARCHITECTURE_AGENT_GUIDE_FILENAME: &str = "AGENTS.md";
const ARCHITECTURE_ICON_REFERENCE_FILENAME: &str = "icon-aliases.json";
const ARCHITECTURE_REVISION_MANIFEST_FILENAME: &str = "manifest.json";
const ARCHITECTURE_FOLDER_META_FILENAME: &str = "folder.json";
pub(crate) const ARCHITECTURE_GLOBAL_REPO_ID: &str = "account-global-architectures";
pub(crate) const ARCHITECTURE_GLOBAL_WORKSPACE_ID: &str = "account-global";

const ARCHITECTURE_AGENT_GUIDE: &str = r##"# Diff Forge Architectures

Architecture graphs are legacy Diff Forge `.arch` artifacts used by the Architecture tab.

The coordination-kernel `architecture_*` MCP tools have been retired to reduce agent tool prompts and keep normal MCP sessions focused on active coordination work.

Use the Architecture tab and normal Tauri architecture commands for graph management. Do not assume architecture MCP tools exist. If a user explicitly asks to edit a graph file, use the file path or app-selected graph context they provide and edit the `.arch` source directly.
"##;

const ARCHITECTURE_ICON_REFERENCE: &str = r##"{
  "kind": "architecture_icon_alias_reference",
  "version": 1,
  "preferredSyntax": "icon: alias or icon: namespace:name",
  "notes": [
    "Use simple aliases first. The renderer resolves LikeC4 icons, styled-icons simple-icons, and semantic fallbacks.",
    "When a node or container title names a real provider, product, framework, cloud service, database, or company, prefer that exact lowercase slug as the icon alias.",
    "If an exact logo is unknown, use a semantic fallback such as api, server, database, storage, queue, worker, external, or service. The renderer also tries to infer installed package icons from titles when a generic fallback is used.",
    "Architecture graphs are general system graphs. Use group intent, node role, edge role, api-corridor overlay props, and one-line run targets to preserve meaning across agent edits and visual saves."
  ],
  "semanticSchema": {
    "groupIntents": ["architecture", "api-pathway", "api-corridor", "data-flow", "control-graph", "state-machine", "dependency-graph", "deployment", "runtime", "subsystem"],
    "nodeRoles": ["actor", "service", "api", "endpoint", "controller", "worker", "queue", "datastore", "cache", "file", "external", "state", "decision", "action", "event", "timer", "terminal", "dependency", "package"],
    "nodeLifecycle": ["start", "normal", "error", "retry", "terminal", "fallback"],
    "edgeRoles": ["calls", "request", "response", "redirect", "callback", "reads", "writes", "publishes", "subscribes", "transitions", "guards", "depends-on", "emits", "retries", "fails-to", "resolves-to"]
  },
  "apiCorridors": {
    "purpose": "Opt-in overlay containers for important ordered API procedures across existing graph nodes or groups.",
    "syntax": "OAuth Login [intent: api-corridor, display: overlay, from: Browser, to: API Server, anchor: Auth API, orient: shortest-path] { Browser > API Server: GET /auth/start [step: 1, role: request, method: GET, path: /auth/start] }",
    "guardrails": [
      "Use for auth, checkout, webhooks, task dispatch, uploads, token refresh, async jobs, destructive mutations, and external integrations.",
      "Do not create API corridors for ordinary CRUD routes unless order, security, side effects, retries, or external integrations matter.",
      "Message endpoints should reference existing graph nodes or groups; create/update normal architecture topology first.",
      "Keep corridors concise, usually 3-9 meaningful steps. Use status: uncertain when the flow is not evidence-backed."
    ]
  },
  "runTargets": {
    "purpose": "One-line launch metadata for Architecture-tab buttons that queue an agent to operate from the selected graph.",
    "syntax": "run \"Deploy\" [action: deploy, envs: \"local,staging,production\", modes: \"plan,apply,verify,rollback\", defaultEnv: staging, scope: \"Deployment\"]",
    "guardrails": [
      "Use only for graph-level operations a human would intentionally trigger.",
      "Run targets describe intent and guardrails, not shell commands.",
      "Keep each target to one line with semantic action, envs, modes, defaultEnv, and scope.",
      "Agents must inspect the repo and plan from evidence before applying, especially for production or destructive work."
    ]
  },
  "packageResolution": {
    "likec4": "Any installed @likec4/icons slug in aws, azure, gcp, tech, or bootstrap can be used, for example appwrite, appwrite-icon, aws:s3, gcp:cloud-run, or azure:functions.",
    "styledSimpleIcons": "Any installed @styled-icons/simple-icons brand/component can be used by simple slug, for example appwrite, cockroachlabs, vercel, react, stripe, or supabase.",
    "titleInference": "If icon is missing or generic, the renderer also checks the node/container title and strips common suffixes such as SDK, API, Service, App, Client, Server, Database, Queue, and Worker before falling back."
  },
  "semantic": [
    "ai",
    "api",
    "auth",
    "browser",
    "cache",
    "client",
    "cloud",
    "database",
    "external",
    "file",
    "flow",
    "folder",
    "group",
    "decision",
    "dependency",
    "event",
    "queue",
    "router",
    "schema",
    "security",
    "server",
    "service",
    "settings",
    "state",
    "storage",
    "subscription",
    "terminal",
    "users",
    "webhook",
    "worker"
  ],
  "aws": [
    "aws:api-gateway",
    "aws:cloudfront",
    "aws:cloudwatch",
    "aws:dynamodb",
    "aws:ec2",
    "aws:ecr",
    "aws:ecs",
    "aws:eks",
    "aws:eventbridge",
    "aws:iam",
    "aws:kinesis",
    "aws:kms",
    "aws:lambda",
    "aws:rds",
    "aws:route53",
    "aws:s3",
    "aws:secrets-manager",
    "aws:sns",
    "aws:sqs",
    "aws:vpc"
  ],
  "gcp": [
    "gcp:bigquery",
    "gcp:cloud-run",
    "gcp:cloud-sql",
    "gcp:cloud-storage",
    "gcp:gke",
    "gcp:pubsub"
  ],
  "azure": [
    "azure:aks",
    "azure:blob-storage",
    "azure:cosmosdb",
    "azure:functions",
    "azure:postgresql",
    "azure:redis",
    "azure:service-bus",
    "azure:sql",
    "azure:storage"
  ],
  "techAndCompany": [
    "anthropic",
    "appwrite",
    "auth0",
    "cloudflare",
    "cockroachdb",
    "docker",
    "github",
    "github-actions",
    "kubernetes",
    "mongodb",
    "nextjs",
    "nginx",
    "nodejs",
    "openai",
    "postgres",
    "react",
    "redis",
    "stripe",
    "supabase",
    "typescript",
    "vercel"
  ],
  "examples": [
    "User [icon: users, role: actor, display: compact]",
    "AI Agent [icon: ai, role: actor, display: compact]",
    "Appwrite [icon: appwrite, desc: Backend-as-a-service platform]",
    "API Pathway [icon: api, intent: api-pathway] { ... }",
    "Decision [icon: router, role: decision, desc: Branch condition]",
    "Idle [icon: flow, role: state, lifecycle: start]",
    "Done [icon: security, role: terminal, lifecycle: terminal]",
    "API > Store: persist [role: writes]",
    "Decision > Retry: retry [role: guards, condition: recoverable]",
    "Object Store [icon: aws:s3, role: datastore, desc: Stores uploads]",
    "CockroachDB [icon: cockroachdb, role: datastore, desc: Durable SQL state]",
    "GitHub Actions [icon: github-actions, role: service, desc: CI pipeline]"
  ]
}
"##;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureRepositoryEntry {
    id: String,
    name: String,
    path: String,
    relative_path: String,
    has_git: bool,
    architecture_root: String,
    graph_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureRepositoryList {
    root_directory: String,
    repositories: Vec<ArchitectureRepositoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureScannedResult {
    root_directory: String,
    workspace_kind: String,
    cache: Value,
    mounts: Vec<Value>,
    workspace_mounts: Vec<Value>,
    repositories: Vec<ArchitectureRepositoryEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphSummary {
    id: String,
    title: String,
    kind: String,
    group_path: Vec<String>,
    group_intents: Vec<String>,
    content_hash: String,
    node_count: usize,
    edge_count: usize,
    created_at: String,
    updated_at: String,
    file_path: String,
    source_format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphList {
    repo_path: String,
    architecture_root: String,
    graphs: Vec<ArchitectureGraphSummary>,
    missing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphSaveResult {
    repo_path: String,
    architecture_root: String,
    graph_id: String,
    file_path: String,
    graph: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphRevisionSummary {
    revision_id: String,
    graph_id: String,
    title: String,
    reason: String,
    timestamp: String,
    content_hash: String,
    deleted: bool,
    restored_from: Option<String>,
    file_path: String,
    source_format: String,
    node_count: usize,
    edge_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphRevisionManifest {
    kind: String,
    version: u32,
    graph_id: String,
    live_file_path: String,
    updated_at: String,
    revisions: Vec<ArchitectureGraphRevisionSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphRevisionList {
    repo_path: String,
    architecture_root: String,
    revisions_root: String,
    graph_id: Option<String>,
    live_file_path: Option<String>,
    revisions: Vec<ArchitectureGraphRevisionSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphRevisionReadResult {
    repo_path: String,
    architecture_root: String,
    revisions_root: String,
    graph_id: String,
    revision: ArchitectureGraphRevisionSummary,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphRevisionRestoreResult {
    repo_path: String,
    architecture_root: String,
    graph_id: String,
    file_path: String,
    graph: Value,
    restored_revision: ArchitectureGraphRevisionSummary,
}

fn architecture_now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn architecture_modified_millis(path: &Path) -> String {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(architecture_now_millis)
}

fn architecture_content_hash(value: &str) -> String {
    let digest = <Sha256 as Sha1Digest>::digest(value.as_bytes());
    format!("{digest:x}")
}

fn architecture_slug(value: &str) -> String {
    let mut output = String::new();
    let mut last_separator = false;

    for character in value.chars() {
        if output.len() >= ARCHITECTURE_GRAPH_ID_MAX {
            break;
        }
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            last_separator = false;
        } else if !last_separator && !output.is_empty() {
            output.push('-');
            last_separator = true;
        }
    }

    while output.ends_with('-') {
        output.pop();
    }

    output
}

fn architecture_graph_id_from_graph(graph: &Value) -> Result<String, String> {
    let raw = graph
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| graph.get("title").and_then(Value::as_str))
        .unwrap_or_default();
    let graph_id = architecture_slug(raw);
    if graph_id.is_empty() {
        return Err("Architecture graph requires a non-empty id or title.".to_string());
    }
    Ok(graph_id)
}

fn architecture_agents_root(repo: &Path) -> PathBuf {
    repo.join(".agents").join("architectures")
}

fn architecture_agent_guide_path(repo: &Path) -> PathBuf {
    architecture_agents_root(repo).join(ARCHITECTURE_AGENT_GUIDE_FILENAME)
}

fn architecture_icon_reference_path(repo: &Path) -> PathBuf {
    architecture_agents_root(repo).join(ARCHITECTURE_ICON_REFERENCE_FILENAME)
}

fn architecture_write_generated_reference_file(
    path: &Path,
    content: &str,
    label: &str,
) -> Result<(), String> {
    if fs::read_to_string(path).is_ok_and(|existing| existing == content) {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create architecture {label} directory: {error}"))?;
    }

    let temp_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.tmp"))
        .unwrap_or_else(|| "architecture-reference.tmp".to_string());
    let temp_path = path.with_file_name(temp_name);
    fs::write(&temp_path, content)
        .map_err(|error| format!("Unable to write architecture {label}: {error}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to replace architecture {label}: {error}"))?;
    }
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Unable to commit architecture {label}: {error}"))
}

pub(crate) fn ensure_architecture_agent_guide(repo: &Path) -> Result<(), String> {
    let root = architecture_agents_root(repo);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create architecture agent guide directory: {error}"))?;
    let _ = ensure_workspace_agents_gitignore(repo);
    architecture_write_generated_reference_file(
        &architecture_agent_guide_path(repo),
        ARCHITECTURE_AGENT_GUIDE,
        "agent guide",
    )?;
    architecture_write_generated_reference_file(
        &architecture_icon_reference_path(repo),
        ARCHITECTURE_ICON_REFERENCE,
        "icon reference",
    )
}

fn architecture_graphs_root(repo: &Path, create: bool) -> Result<PathBuf, String> {
    let root = architecture_agents_root(repo);
    let graphs_root = root.join("graphs");
    if create {
        fs::create_dir_all(&graphs_root)
            .map_err(|error| format!("Unable to create architecture graph directory: {error}"))?;
        ensure_architecture_agent_guide(repo)?;
    }
    Ok(graphs_root)
}

fn architecture_arch_path(repo: &Path, graph_id: &str) -> PathBuf {
    architecture_agents_root(repo)
        .join("graphs")
        .join(format!("{graph_id}.arch"))
}

fn architecture_json_path(repo: &Path, graph_id: &str) -> PathBuf {
    architecture_agents_root(repo)
        .join("graphs")
        .join(format!("{graph_id}.json"))
}

fn architecture_revisions_root(repo: &Path, create: bool) -> Result<PathBuf, String> {
    let root = architecture_agents_root(repo).join("revisions");
    if create {
        fs::create_dir_all(&root).map_err(|error| {
            format!("Unable to create architecture revisions directory: {error}")
        })?;
    }
    Ok(root)
}

fn architecture_revision_graph_dir(
    repo: &Path,
    graph_id: &str,
    create: bool,
) -> Result<PathBuf, String> {
    let root = architecture_revisions_root(repo, create)?;
    let dir = root.join(architecture_slug(graph_id));
    if create {
        fs::create_dir_all(&dir).map_err(|error| {
            format!("Unable to create architecture graph revision directory: {error}")
        })?;
    }
    Ok(dir)
}

fn architecture_revision_manifest_path(repo: &Path, graph_id: &str) -> Result<PathBuf, String> {
    Ok(architecture_revision_graph_dir(repo, graph_id, false)?
        .join(ARCHITECTURE_REVISION_MANIFEST_FILENAME))
}

fn architecture_revision_manifest_empty(
    repo: &Path,
    graph_id: &str,
) -> ArchitectureGraphRevisionManifest {
    ArchitectureGraphRevisionManifest {
        kind: "architecture_revision_manifest".to_string(),
        version: 1,
        graph_id: graph_id.to_string(),
        live_file_path: workspace_path_display(&architecture_arch_path(repo, graph_id)),
        updated_at: architecture_now_millis(),
        revisions: Vec::new(),
    }
}

fn architecture_read_revision_manifest(
    repo: &Path,
    graph_id: &str,
) -> Result<ArchitectureGraphRevisionManifest, String> {
    let graph_id = architecture_slug(graph_id);
    if graph_id.is_empty() {
        return Err("Architecture graph id is required.".to_string());
    }
    let path = architecture_revision_manifest_path(repo, &graph_id)?;
    if !path.exists() {
        return Ok(architecture_revision_manifest_empty(repo, &graph_id));
    }
    let source = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read architecture revision manifest: {error}"))?;
    let mut manifest = serde_json::from_str::<ArchitectureGraphRevisionManifest>(&source)
        .map_err(|error| format!("Unable to parse architecture revision manifest: {error}"))?;
    manifest.graph_id = architecture_slug(&manifest.graph_id);
    if manifest.graph_id.is_empty() {
        manifest.graph_id = graph_id;
    }
    Ok(manifest)
}

fn architecture_write_revision_manifest(
    repo: &Path,
    graph_id: &str,
    manifest: &ArchitectureGraphRevisionManifest,
) -> Result<(), String> {
    let dir = architecture_revision_graph_dir(repo, graph_id, true)?;
    let path = dir.join(ARCHITECTURE_REVISION_MANIFEST_FILENAME);
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Unable to serialize architecture revision manifest: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Unable to write architecture revision manifest: {error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| {
            format!("Unable to replace architecture revision manifest: {error}")
        })?;
    }
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Unable to commit architecture revision manifest: {error}"))
}

fn architecture_clean_line(value: &str) -> String {
    let mut in_quote = false;
    let mut output = String::new();
    let mut previous = '\0';
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0usize;

    while index < chars.len() {
        let character = chars[index];
        if character == '"' && previous != '\\' {
            in_quote = !in_quote;
        }
        if !in_quote && character == '/' && chars.get(index + 1) == Some(&'/') {
            break;
        }
        if !in_quote && character == '#' {
            break;
        }
        output.push(character);
        previous = character;
        index += 1;
    }

    output.trim().to_string()
}

fn architecture_unquote(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1]
            .replace("\\\"", "\"")
            .trim()
            .to_string()
    } else {
        trimmed.to_string()
    }
}

fn architecture_parse_title(source: &str, fallback_id: &str) -> String {
    for line in source.lines().map(architecture_clean_line) {
        if let Some(rest) = line.strip_prefix("title ") {
            let title = architecture_unquote(rest);
            if !title.is_empty() {
                return title;
            }
        }
    }

    fallback_id
        .split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn architecture_parse_group_path(source: &str) -> Vec<String> {
    for line in source.lines().map(architecture_clean_line) {
        let Some(rest) = line
            .strip_prefix("folder ")
            .or_else(|| line.strip_prefix("groupPath "))
            .or_else(|| line.strip_prefix("path "))
        else {
            continue;
        };
        return architecture_group_path_from_text(rest);
    }
    Vec::new()
}

fn architecture_group_path_from_text(value: &str) -> Vec<String> {
    architecture_unquote(value)
        .split(&['/', '>'][..])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .take(12)
        .map(ToString::to_string)
        .collect()
}

fn architecture_source_counts(source: &str) -> (usize, usize) {
    let mut node_count = 0usize;
    let mut edge_count = 0usize;

    for line in source.lines().map(architecture_clean_line) {
        if line.is_empty()
            || line == "}"
            || line.starts_with("title ")
            || line.starts_with("folder ")
            || line.starts_with("groupPath ")
            || line.starts_with("path ")
            || line.starts_with("direction ")
            || line.starts_with("colorMode ")
            || line.starts_with("styleMode ")
            || line.starts_with("typeface ")
            || line.starts_with("legend ")
            || line.starts_with('[')
        {
            continue;
        }
        if line.contains(">")
            || line.contains("<")
            || line.contains("--")
            || (line.contains(" - ") && !line.ends_with('{'))
        {
            edge_count += 1;
        } else {
            node_count += 1;
        }
    }

    (node_count, edge_count)
}

fn architecture_semantic_slug(value: &str) -> String {
    architecture_slug(&value.replace('_', "-"))
}

fn architecture_parse_dsl_props(value: &str) -> HashMap<String, String> {
    let trimmed = value.trim();
    let Some(open_index) = trimmed.rfind('[') else {
        return HashMap::new();
    };
    let Some(close_index) = trimmed.rfind(']') else {
        return HashMap::new();
    };
    if close_index <= open_index {
        return HashMap::new();
    }
    let props_text = &trimmed[open_index + 1..close_index];
    let mut props = HashMap::new();
    for part in props_text.split(',') {
        let Some((key, value)) = part.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = architecture_unquote(value.trim());
        if !key.is_empty() && !value.is_empty() {
            props.insert(key.to_string(), value);
        }
    }
    props
}

fn architecture_source_group_intents(source: &str) -> Vec<String> {
    let mut intents = HashSet::new();
    for line in source.lines().map(architecture_clean_line) {
        if !line.ends_with('{') {
            continue;
        }
        let group_line = line.trim_end_matches('{').trim();
        let props = architecture_parse_dsl_props(group_line);
        let Some(intent) = props
            .get("intent")
            .or_else(|| props.get("view"))
            .or_else(|| props.get("kind"))
            .or_else(|| props.get("type"))
            .map(|value| architecture_semantic_slug(value))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        intents.insert(intent);
    }
    let mut intents: Vec<String> = intents.into_iter().collect();
    intents.sort();
    intents
}

fn architecture_graph_value_group_intents(graph: &Value) -> Vec<String> {
    let mut intents = HashSet::new();
    if let Some(nodes) = graph.get("nodes").and_then(Value::as_array) {
        for node in nodes {
            let is_group = node
                .get("type")
                .and_then(Value::as_str)
                .or_else(|| node.get("kind").and_then(Value::as_str))
                .map(|value| value == "group")
                .unwrap_or(false);
            if !is_group {
                continue;
            }
            if let Some(intent) = node
                .get("intent")
                .or_else(|| node.get("view"))
                .and_then(Value::as_str)
                .map(architecture_semantic_slug)
                .filter(|value| !value.is_empty())
            {
                intents.insert(intent);
            }
        }
    }
    let mut intents: Vec<String> = intents.into_iter().collect();
    intents.sort();
    intents
}

fn architecture_graph_group_path(graph: &Value) -> Vec<String> {
    graph
        .get("groupPath")
        .or_else(|| graph.get("group_path"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(12)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn architecture_summary_from_arch(
    path: &Path,
    fallback_id: &str,
) -> Option<ArchitectureGraphSummary> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES
    {
        return None;
    }
    let source = fs::read_to_string(path).ok()?;
    let title = architecture_parse_title(&source, fallback_id);
    let group_path = architecture_parse_group_path(&source);
    let group_intents = architecture_source_group_intents(&source);
    let (node_count, edge_count) = architecture_source_counts(&source);
    let updated_at = architecture_modified_millis(path);

    Some(ArchitectureGraphSummary {
        id: fallback_id.to_string(),
        title,
        kind: "architecture".to_string(),
        group_path,
        group_intents,
        content_hash: architecture_content_hash(&source),
        node_count,
        edge_count,
        created_at: updated_at.clone(),
        updated_at,
        file_path: workspace_path_display(path),
        source_format: "eraserDsl".to_string(),
    })
}

fn architecture_graph_summary_from_value(
    graph: &Value,
    fallback_id: &str,
    file_path: &Path,
) -> Option<ArchitectureGraphSummary> {
    let object = graph.as_object()?;
    let id = graph
        .get("id")
        .and_then(Value::as_str)
        .map(architecture_slug)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback_id.to_string());
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id.as_str())
        .to_string();
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("architecture")
        .to_string();
    let node_count = object
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let edge_count = object
        .get("edges")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let created_at = object
        .get("createdAt")
        .or_else(|| object.get("created_at"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated_at = object
        .get("updatedAt")
        .or_else(|| object.get("updated_at"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| architecture_modified_millis(file_path));

    Some(ArchitectureGraphSummary {
        id,
        title,
        kind,
        group_path: architecture_graph_group_path(graph),
        group_intents: architecture_graph_value_group_intents(graph),
        content_hash: serde_json::to_string(graph)
            .map(|source| architecture_content_hash(&source))
            .unwrap_or_default(),
        node_count,
        edge_count,
        created_at,
        updated_at,
        file_path: workspace_path_display(file_path),
        source_format: "json".to_string(),
    })
}

fn architecture_read_json_graph_file(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect architecture graph file: {error}"))?;
    if !metadata.is_file() {
        return Err("Architecture graph path is not a file.".to_string());
    }
    if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture graph file is too large.".to_string());
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("Unable to read architecture graph file: {error}"))?;
    let mut graph = serde_json::from_slice::<Value>(&bytes)
        .map_err(|error| format!("Unable to parse architecture graph JSON: {error}"))?;
    if let Some(object) = graph.as_object_mut() {
        let source = String::from_utf8_lossy(&bytes);
        let hash = architecture_content_hash(&source);
        object
            .entry("contentHash".to_string())
            .or_insert_with(|| Value::String(hash.clone()));
        object
            .entry("contentRevision".to_string())
            .or_insert_with(|| Value::String(hash));
    }
    Ok(graph)
}

fn architecture_read_arch_graph(path: &Path, graph_id: &str) -> Result<Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect architecture DSL file: {error}"))?;
    if !metadata.is_file() {
        return Err("Architecture graph path is not a file.".to_string());
    }
    if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture DSL file is too large.".to_string());
    }
    let source = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read architecture DSL file: {error}"))?;
    let title = architecture_parse_title(&source, graph_id);
    let group_path = architecture_parse_group_path(&source);
    let group_intents = architecture_source_group_intents(&source);
    let (node_count, edge_count) = architecture_source_counts(&source);
    let updated_at = architecture_modified_millis(path);

    Ok(json!({
        "id": graph_id,
        "title": title,
        "kind": "architecture",
        "groupPath": group_path,
        "groupIntents": group_intents,
        "source": source,
        "sourceFormat": "eraserDsl",
        "contentHash": architecture_content_hash(&source),
        "contentRevision": architecture_content_hash(&source),
        "version": 2,
        "createdAt": updated_at,
        "updatedAt": updated_at,
        "filePath": workspace_path_display(path),
        "nodeCount": node_count,
        "edgeCount": edge_count,
    }))
}

fn architecture_revision_source_counts(source_format: &str, source: &str) -> (usize, usize) {
    if source_format == "json" {
        let Ok(graph) = serde_json::from_str::<Value>(source) else {
            return (0, 0);
        };
        let node_count = graph
            .get("nodes")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        let edge_count = graph
            .get("edges")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        return (node_count, edge_count);
    }
    architecture_source_counts(source)
}

fn architecture_revision_title(source_format: &str, source: &str, graph_id: &str) -> String {
    if source_format == "json" {
        return serde_json::from_str::<Value>(source)
            .ok()
            .and_then(|graph| {
                graph
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| architecture_parse_title(source, graph_id));
    }
    architecture_parse_title(source, graph_id)
}

fn architecture_revision_file_path(
    repo: &Path,
    graph_id: &str,
    revision_id: &str,
    source_format: &str,
) -> Result<PathBuf, String> {
    let dir = architecture_revision_graph_dir(repo, graph_id, false)?;
    let preferred_extension = if source_format == "json" {
        "json"
    } else {
        "arch"
    };
    let preferred = dir.join(format!("{revision_id}.{preferred_extension}"));
    if preferred.exists() {
        return Ok(preferred);
    }
    for extension in ["arch", "json"] {
        let candidate = dir.join(format!("{revision_id}.{extension}"));
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Architecture revision file was not found.".to_string())
}

fn architecture_revision_snapshot_file(
    repo: &Path,
    graph_id: &str,
    path: &Path,
    source_format: &str,
    reason: &str,
    deleted: bool,
    restored_from: Option<String>,
) -> Result<Option<ArchitectureGraphRevisionSummary>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Unable to inspect architecture graph for revision: {error}"
            ));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture source is too large to snapshot.".to_string());
    }
    let source = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read architecture source for revision: {error}"))?;
    let timestamp = architecture_now_millis();
    let content_hash = architecture_content_hash(&source);
    let hash_prefix = content_hash.chars().take(10).collect::<String>();
    let mut revision_id = if deleted {
        format!("{timestamp}--deleted--{hash_prefix}")
    } else {
        format!("{timestamp}--{hash_prefix}")
    };
    let source_format = if source_format == "json" {
        "json"
    } else {
        "eraserDsl"
    };
    let extension = if source_format == "json" {
        "json"
    } else {
        "arch"
    };
    let dir = architecture_revision_graph_dir(repo, graph_id, true)?;
    let mut revision_path = dir.join(format!("{revision_id}.{extension}"));
    let mut counter = 1usize;
    while revision_path.exists() {
        revision_id = if deleted {
            format!("{timestamp}--deleted--{hash_prefix}-{counter}")
        } else {
            format!("{timestamp}--{hash_prefix}-{counter}")
        };
        revision_path = dir.join(format!("{revision_id}.{extension}"));
        counter += 1;
    }

    let temp_path = revision_path.with_extension(format!("{extension}.tmp"));
    fs::write(&temp_path, source.as_bytes())
        .map_err(|error| format!("Unable to write architecture revision: {error}"))?;
    fs::rename(&temp_path, &revision_path)
        .map_err(|error| format!("Unable to commit architecture revision: {error}"))?;

    let (node_count, edge_count) = architecture_revision_source_counts(source_format, &source);
    let summary = ArchitectureGraphRevisionSummary {
        revision_id: revision_id.clone(),
        graph_id: graph_id.to_string(),
        title: architecture_revision_title(source_format, &source, graph_id),
        reason: reason.to_string(),
        timestamp: timestamp.clone(),
        content_hash,
        deleted,
        restored_from,
        file_path: workspace_path_display(&revision_path),
        source_format: source_format.to_string(),
        node_count,
        edge_count,
    };
    let mut manifest = architecture_read_revision_manifest(repo, graph_id)?;
    manifest.kind = "architecture_revision_manifest".to_string();
    manifest.version = 1;
    manifest.graph_id = graph_id.to_string();
    manifest.live_file_path = workspace_path_display(path);
    manifest.updated_at = timestamp;
    manifest
        .revisions
        .retain(|revision| revision.revision_id != revision_id);
    manifest.revisions.push(summary.clone());
    manifest.revisions.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| right.revision_id.cmp(&left.revision_id))
    });
    architecture_write_revision_manifest(repo, graph_id, &manifest)?;
    Ok(Some(summary))
}

fn architecture_revision_snapshot_existing(
    repo: &Path,
    graph_id: &str,
    reason: &str,
    deleted: bool,
    restored_from: Option<String>,
) -> Result<Option<ArchitectureGraphRevisionSummary>, String> {
    let arch_path = architecture_arch_path(repo, graph_id);
    if arch_path.exists() {
        return architecture_revision_snapshot_file(
            repo,
            graph_id,
            &arch_path,
            "eraserDsl",
            reason,
            deleted,
            restored_from,
        );
    }
    let json_path = architecture_json_path(repo, graph_id);
    if json_path.exists() {
        return architecture_revision_snapshot_file(
            repo,
            graph_id,
            &json_path,
            "json",
            reason,
            deleted,
            restored_from,
        );
    }
    Ok(None)
}

fn architecture_graph_summaries(repo: &Path) -> Result<Vec<ArchitectureGraphSummary>, String> {
    let graphs_root = architecture_graphs_root(repo, false)?;
    if !graphs_root.exists() {
        return Ok(Vec::new());
    }

    let read_dir = fs::read_dir(&graphs_root)
        .map_err(|error| format!("Unable to list architecture graphs: {error}"))?;
    let mut graphs = Vec::new();
    let mut arch_ids = HashSet::new();
    let mut json_candidates: Vec<(String, PathBuf)> = Vec::new();

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        let fallback_id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(architecture_slug)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "architecture".to_string());

        match extension {
            "arch" => {
                if let Some(summary) = architecture_summary_from_arch(&path, &fallback_id) {
                    arch_ids.insert(summary.id.clone());
                    graphs.push(summary);
                }
            }
            "json" => {
                json_candidates.push((fallback_id, path));
            }
            _ => {}
        }
    }

    for (fallback_id, path) in json_candidates {
        if arch_ids.contains(&fallback_id) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES
        {
            continue;
        }
        let Ok(graph) = architecture_read_json_graph_file(&path) else {
            continue;
        };
        if let Some(summary) = architecture_graph_summary_from_value(&graph, &fallback_id, &path) {
            graphs.push(summary);
        }
    }

    graphs.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(graphs)
}

fn architecture_write_index(
    repo: &Path,
    graphs: &[ArchitectureGraphSummary],
) -> Result<(), String> {
    ensure_architecture_agent_guide(repo)?;
    let root = architecture_agents_root(repo);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create architecture index directory: {error}"))?;
    let index = json!({
        "kind": "architecture_index",
        "version": 2,
        "updatedAt": architecture_now_millis(),
        "sourceFormat": "eraserDsl",
        "graphs": graphs,
    });
    let bytes = serde_json::to_vec_pretty(&index)
        .map_err(|error| format!("Unable to serialize architecture index: {error}"))?;
    fs::write(root.join("index.json"), bytes)
        .map_err(|error| format!("Unable to write architecture index: {error}"))
}

fn architecture_graph_count(repo: &Path) -> usize {
    architecture_graph_summaries(repo)
        .map(|graphs| graphs.len())
        .unwrap_or(0)
}

fn architecture_repository_entry(
    workspace_root: &Path,
    repo: &Path,
    relative_path: String,
    has_git: bool,
) -> ArchitectureRepositoryEntry {
    let name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repo")
        .to_string();
    let path = workspace_path_display(repo);
    let storage_base =
        architecture_central_repo_root_for(repo).unwrap_or_else(|_| repo.to_path_buf());
    let architecture_root = workspace_path_display(&architecture_agents_root(&storage_base));
    let id = normalized_path_key(repo);
    let relative_path = if relative_path.is_empty() {
        if normalized_path_key(workspace_root) == id {
            ".".to_string()
        } else {
            path.clone()
        }
    } else {
        relative_path
    };

    ArchitectureRepositoryEntry {
        id,
        name,
        path,
        relative_path,
        has_git,
        architecture_root,
        graph_count: architecture_graph_count(&storage_base),
    }
}

const ARCHITECTURE_FOLDER_LIST_SKIP_NAMES: [&str; 8] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "__pycache__",
    "venv",
    "tmp",
];

fn architecture_repositories_from_mounts(
    root: &Path,
    mounts: &[WorkspaceProjectMount],
) -> ArchitectureRepositoryList {
    // Simple contract: every visible folder directly under the workspace
    // root is an architecture scope, git or not. The git topology scan only
    // supplies the git label (with a direct .git check for folders the scan
    // didn't mount); deeper project mounts are appended so nested repos stay
    // reachable.
    let mut git_by_path = HashMap::new();
    for mount in mounts {
        git_by_path.insert(normalized_path_key(&mount.root_path), mount.has_git);
    }
    let folder_has_git = |path: &Path| {
        git_by_path
            .get(&normalized_path_key(path))
            .copied()
            .unwrap_or_else(|| workspace_is_exact_git_root(path))
    };

    let mut seen = HashSet::new();
    let mut repositories = Vec::new();

    let root_has_git = folder_has_git(root);
    if root_has_git {
        seen.insert(normalized_path_key(root));
        repositories.push(architecture_repository_entry(
            root,
            root,
            ".".to_string(),
            true,
        ));
    }

    let mut subdirectories = fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path())
                .filter(|path| {
                    let name = path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default();
                    !name.is_empty()
                        && !name.starts_with('.')
                        && !ARCHITECTURE_FOLDER_LIST_SKIP_NAMES.contains(&name)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    subdirectories.sort();
    for directory in subdirectories {
        let key = normalized_path_key(&directory);
        if !seen.insert(key) {
            continue;
        }
        let name = directory
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let has_git = folder_has_git(&directory);
        repositories.push(architecture_repository_entry(
            root, &directory, name, has_git,
        ));
    }

    for mount in mounts
        .iter()
        .filter(|mount| workspace_mount_is_project(mount))
    {
        let key = normalized_path_key(&mount.root_path);
        if seen.insert(key) {
            repositories.push(architecture_repository_entry(
                root,
                &mount.root_path,
                mount.workspace_relative_path.clone(),
                mount.has_git,
            ));
        }
    }

    if repositories.is_empty() {
        let key = normalized_path_key(root);
        if seen.insert(key) {
            repositories.push(architecture_repository_entry(
                root,
                root,
                ".".to_string(),
                root_has_git,
            ));
        }
    }

    repositories.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| left.name.cmp(&right.name))
    });

    ArchitectureRepositoryList {
        root_directory: workspace_path_display(&root),
        repositories,
    }
}

fn architecture_scanned_result_from_topology(
    root: &Path,
    topology: TerminalWorkspaceTopologyScan,
) -> ArchitectureScannedResult {
    let mounts = topology.mounts;
    let workspace_mounts = workspace_mount_manifest_from_projects(root, &mounts);
    let workspace_kind = workspace_kind_for_mounts(&root, &mounts);
    let repositories = architecture_repositories_from_mounts(root, &mounts).repositories;
    let cache = json!({
        "key": topology.cache_key,
        "status": topology.cache_status,
        "hit": topology.cache_hit,
        "fresh": true,
        "scannedAtMs": topology.scanned_ms,
        "ttlMs": TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS,
        "source": "backend_workspace_topology_cache",
        "reason": "Shared workspace topology cache used by terminals, Architectures, and Scanned Result.",
    });

    let mounts = mounts
        .iter()
        .map(|mount| serde_json::to_value(mount).unwrap_or_else(|_| json!({})))
        .collect::<Vec<_>>();
    let workspace_mounts = workspace_mounts
        .iter()
        .map(|mount| serde_json::to_value(mount).unwrap_or_else(|_| json!({})))
        .collect::<Vec<_>>();

    ArchitectureScannedResult {
        root_directory: workspace_path_display(&root),
        workspace_kind,
        cache,
        mounts,
        workspace_mounts,
        repositories,
    }
}

fn architecture_graphs_list_blocking(repo_path: String) -> Result<ArchitectureGraphList, String> {
    // A root that no longer exists (deleted central-store entry, removed
    // checkout) is an empty list, not an error: callers render "No graphs
    // yet" calmly instead of hot-looping an error retry, and the entry drops
    // off the catalog on its next refresh.
    let trimmed = repo_path.trim();
    if !trimmed.is_empty() && !Path::new(trimmed).exists() {
        return Ok(ArchitectureGraphList {
            repo_path: trimmed.to_string(),
            architecture_root: String::new(),
            graphs: Vec::new(),
            missing: true,
        });
    }
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let graphs = architecture_graph_summaries(&repo)?;
    if architecture_agents_root(&repo).exists() {
        let _ = ensure_architecture_agent_guide(&repo);
        let _ = architecture_write_index(&repo, &graphs);
    }
    Ok(ArchitectureGraphList {
        repo_path: workspace_path_display(&display_repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        graphs,
        missing: false,
    })
}

fn architecture_graph_read_blocking(repo_path: String, graph_id: String) -> Result<Value, String> {
    let repo = architecture_storage_repo_base(repo_path.as_str())?;
    let graph_id = architecture_slug(&graph_id);
    if graph_id.is_empty() {
        return Err("Architecture graph id is required.".to_string());
    }
    let arch_path = architecture_arch_path(&repo, &graph_id);
    if arch_path.exists() {
        return architecture_read_arch_graph(&arch_path, &graph_id);
    }
    let json_path = architecture_json_path(&repo, &graph_id);
    if json_path.exists() {
        return architecture_read_json_graph_file(&json_path);
    }
    Err("Architecture graph was not found.".to_string())
}

fn architecture_graph_save_blocking_with_reason(
    repo_path: String,
    mut graph: Value,
    revision_reason: &str,
) -> Result<ArchitectureGraphSaveResult, String> {
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let graph_id = architecture_graph_id_from_graph(&graph)?;
    let graphs_root = architecture_graphs_root(&repo, true)?;
    let now = architecture_now_millis();

    if let Some(source) = graph.get("source").and_then(Value::as_str) {
        if source.as_bytes().len() as u64 > ARCHITECTURE_GRAPH_MAX_BYTES {
            return Err("Architecture DSL source is too large.".to_string());
        }
        let graph_path = graphs_root.join(format!("{graph_id}.arch"));
        if fs::read_to_string(&graph_path)
            .map(|existing| existing != source)
            .unwrap_or(false)
        {
            let _ = architecture_revision_snapshot_existing(
                &repo,
                &graph_id,
                revision_reason,
                false,
                None,
            )?;
        } else if !graph_path.exists() && architecture_json_path(&repo, &graph_id).exists() {
            let _ = architecture_revision_snapshot_existing(
                &repo,
                &graph_id,
                revision_reason,
                false,
                None,
            )?;
        }
        let temp_path = graph_path.with_extension("arch.tmp");
        fs::write(&temp_path, source)
            .map_err(|error| format!("Unable to write architecture DSL file: {error}"))?;
        if graph_path.exists() {
            fs::remove_file(&graph_path)
                .map_err(|error| format!("Unable to replace architecture DSL file: {error}"))?;
        }
        fs::rename(&temp_path, &graph_path)
            .map_err(|error| format!("Unable to commit architecture DSL file: {error}"))?;

        let object = graph
            .as_object_mut()
            .ok_or_else(|| "Architecture graph must be a JSON object.".to_string())?;
        object.insert("id".to_string(), Value::String(graph_id.clone()));
        object.insert(
            "sourceFormat".to_string(),
            Value::String("eraserDsl".to_string()),
        );
        object.insert("updatedAt".to_string(), Value::String(now.clone()));
        object
            .entry("createdAt".to_string())
            .or_insert_with(|| Value::String(now.clone()));
        object.insert(
            "filePath".to_string(),
            Value::String(workspace_path_display(&graph_path)),
        );

        let graphs = architecture_graph_summaries(&repo)?;
        let _ = architecture_write_index(&repo, &graphs);

        return Ok(ArchitectureGraphSaveResult {
            repo_path: workspace_path_display(&display_repo),
            architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
            graph_id,
            file_path: workspace_path_display(&graph_path),
            graph,
        });
    }

    let graph_path = graphs_root.join(format!("{graph_id}.json"));
    let object = graph
        .as_object_mut()
        .ok_or_else(|| "Architecture graph must be a JSON object.".to_string())?;

    object.insert("id".to_string(), Value::String(graph_id.clone()));
    object
        .entry("kind".to_string())
        .or_insert_with(|| Value::String("architecture".to_string()));
    object
        .entry("version".to_string())
        .or_insert_with(|| Value::Number(1.into()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("updatedAt".to_string(), Value::String(now));

    let bytes = serde_json::to_vec_pretty(&graph)
        .map_err(|error| format!("Unable to serialize architecture graph: {error}"))?;
    if bytes.len() as u64 > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture graph is too large.".to_string());
    }

    if fs::read(&graph_path)
        .map(|existing| existing != bytes.as_slice())
        .unwrap_or(false)
    {
        let _ = architecture_revision_snapshot_existing(
            &repo,
            &graph_id,
            revision_reason,
            false,
            None,
        )?;
    } else if !graph_path.exists() && architecture_arch_path(&repo, &graph_id).exists() {
        let _ = architecture_revision_snapshot_existing(
            &repo,
            &graph_id,
            revision_reason,
            false,
            None,
        )?;
    }
    let temp_path = graph_path.with_extension("json.tmp");
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Unable to write architecture graph: {error}"))?;
    if graph_path.exists() {
        fs::remove_file(&graph_path)
            .map_err(|error| format!("Unable to replace architecture graph: {error}"))?;
    }
    fs::rename(&temp_path, &graph_path)
        .map_err(|error| format!("Unable to commit architecture graph: {error}"))?;

    let graphs = architecture_graph_summaries(&repo)?;
    let _ = architecture_write_index(&repo, &graphs);

    Ok(ArchitectureGraphSaveResult {
        repo_path: workspace_path_display(&display_repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        graph_id,
        file_path: workspace_path_display(&graph_path),
        graph,
    })
}

fn architecture_graph_save_blocking(
    repo_path: String,
    graph: Value,
) -> Result<ArchitectureGraphSaveResult, String> {
    architecture_graph_save_blocking_with_reason(repo_path, graph, "save")
}

fn architecture_graph_write_cloud_arch_blocking(
    repo_path: String,
    graph: Value,
) -> Result<ArchitectureGraphSaveResult, String> {
    let source = graph
        .get("source")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Hydrated architecture graph source is required.".to_string())?;
    if source.as_bytes().len() as u64 > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Hydrated architecture DSL source is too large.".to_string());
    }
    architecture_graph_save_blocking_with_reason(repo_path, graph, "cloud-hydrate")
}

fn architecture_graph_revisions_list_blocking(
    repo_path: String,
    graph_id: Option<String>,
) -> Result<ArchitectureGraphRevisionList, String> {
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let revisions_root = architecture_revisions_root(&repo, false)?;
    let mut revisions = Vec::new();
    let mut live_file_path = None;
    let safe_graph_id = graph_id
        .as_deref()
        .map(architecture_slug)
        .filter(|value| !value.is_empty());

    if let Some(graph_id) = safe_graph_id.as_deref() {
        let manifest = architecture_read_revision_manifest(&repo, graph_id)?;
        live_file_path = Some(manifest.live_file_path.clone());
        revisions.extend(manifest.revisions);
    } else if revisions_root.exists() {
        let read_dir = fs::read_dir(&revisions_root).map_err(|error| {
            format!("Unable to list architecture revision directories: {error}")
        })?;
        for entry in read_dir.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_dir() {
                continue;
            }
            let Some(graph_id) = entry
                .file_name()
                .to_str()
                .map(architecture_slug)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let Ok(manifest) = architecture_read_revision_manifest(&repo, &graph_id) else {
                continue;
            };
            revisions.extend(manifest.revisions);
        }
    }

    revisions.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| right.revision_id.cmp(&left.revision_id))
    });

    Ok(ArchitectureGraphRevisionList {
        repo_path: workspace_path_display(&display_repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        revisions_root: workspace_path_display(&revisions_root),
        graph_id: safe_graph_id,
        live_file_path,
        revisions,
    })
}

fn architecture_graph_revision_read_blocking(
    repo_path: String,
    graph_id: String,
    revision_id: String,
) -> Result<ArchitectureGraphRevisionReadResult, String> {
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let graph_id = architecture_slug(&graph_id);
    let revision_id = revision_id.trim().to_string();
    if graph_id.is_empty() || revision_id.is_empty() {
        return Err("Architecture graph id and revision id are required.".to_string());
    }
    let manifest = architecture_read_revision_manifest(&repo, &graph_id)?;
    let revision = manifest
        .revisions
        .into_iter()
        .find(|candidate| candidate.revision_id == revision_id)
        .ok_or_else(|| "Architecture revision was not found.".to_string())?;
    let source_path =
        architecture_revision_file_path(&repo, &graph_id, &revision_id, &revision.source_format)?;
    let metadata = fs::symlink_metadata(&source_path)
        .map_err(|error| format!("Unable to inspect architecture revision: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Architecture revision path is not a file.".to_string());
    }
    if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture revision is too large.".to_string());
    }
    let source = fs::read_to_string(&source_path)
        .map_err(|error| format!("Unable to read architecture revision: {error}"))?;
    Ok(ArchitectureGraphRevisionReadResult {
        repo_path: workspace_path_display(&display_repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        revisions_root: workspace_path_display(&architecture_revisions_root(&repo, false)?),
        graph_id,
        revision,
        source,
    })
}

fn architecture_graph_revision_restore_blocking(
    repo_path: String,
    graph_id: String,
    revision_id: String,
) -> Result<ArchitectureGraphRevisionRestoreResult, String> {
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let graph_id = architecture_slug(&graph_id);
    let revision_id = revision_id.trim().to_string();
    if graph_id.is_empty() || revision_id.is_empty() {
        return Err("Architecture graph id and revision id are required.".to_string());
    }
    let revision = architecture_graph_revision_read_blocking(
        workspace_path_display(&repo),
        graph_id.clone(),
        revision_id.clone(),
    )?;
    let source_format = revision.revision.source_format.clone();
    let graphs_root = architecture_graphs_root(&repo, true)?;
    let graph_path = if source_format == "json" {
        graphs_root.join(format!("{graph_id}.json"))
    } else {
        graphs_root.join(format!("{graph_id}.arch"))
    };

    let _ = architecture_revision_snapshot_existing(
        &repo,
        &graph_id,
        "restore-before-overwrite",
        false,
        Some(revision_id.clone()),
    )?;

    let extension = if source_format == "json" {
        "json"
    } else {
        "arch"
    };
    let temp_path = graph_path.with_extension(format!("{extension}.tmp"));
    fs::write(&temp_path, revision.source.as_bytes())
        .map_err(|error| format!("Unable to write restored architecture graph: {error}"))?;
    if graph_path.exists() {
        fs::remove_file(&graph_path)
            .map_err(|error| format!("Unable to replace restored architecture graph: {error}"))?;
    }
    fs::rename(&temp_path, &graph_path)
        .map_err(|error| format!("Unable to commit restored architecture graph: {error}"))?;
    if source_format == "json" {
        let arch_path = architecture_arch_path(&repo, &graph_id);
        if arch_path.exists() {
            fs::remove_file(&arch_path).map_err(|error| {
                format!("Unable to remove shadowing architecture DSL file: {error}")
            })?;
        }
    }

    let restored_revision = architecture_revision_snapshot_file(
        &repo,
        &graph_id,
        &graph_path,
        &source_format,
        "restore",
        false,
        Some(revision_id),
    )?
    .ok_or_else(|| "Unable to record restored architecture revision.".to_string())?;

    let graphs = architecture_graph_summaries(&repo)?;
    let _ = architecture_write_index(&repo, &graphs);
    let graph = architecture_graph_read_blocking(workspace_path_display(&repo), graph_id.clone())?;

    Ok(ArchitectureGraphRevisionRestoreResult {
        repo_path: workspace_path_display(&display_repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        graph_id,
        file_path: workspace_path_display(&graph_path),
        graph,
        restored_revision,
    })
}

fn architecture_graph_delete_blocking(
    repo_path: String,
    graph_id: String,
) -> Result<ArchitectureGraphRevisionList, String> {
    let (display_repo, repo) = architecture_resolved_and_storage(repo_path.as_str())?;
    let graph_id = architecture_slug(&graph_id);
    if graph_id.is_empty() {
        return Err("Architecture graph id is required.".to_string());
    }
    let graph_paths = [
        architecture_arch_path(&repo, &graph_id),
        architecture_json_path(&repo, &graph_id),
    ];
    let revision_dir = architecture_revision_graph_dir(&repo, &graph_id, false)?;
    if !graph_paths.iter().any(|path| path.exists()) && !revision_dir.exists() {
        return Err("Architecture graph was not found.".to_string());
    }
    for path in graph_paths {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Unable to delete architecture graph: {error}"))?;
        }
    }
    if revision_dir.exists() {
        fs::remove_dir_all(&revision_dir)
            .map_err(|error| format!("Unable to delete architecture revision history: {error}"))?;
    }
    let graphs = architecture_graph_summaries(&repo)?;
    let _ = architecture_write_index(&repo, &graphs);
    architecture_graph_revisions_list_blocking(
        workspace_path_display(&display_repo),
        Some(graph_id),
    )
}

#[tauri::command]
async fn architecture_repositories(
    root_directory: Option<String>,
    state: State<'_, TerminalState>,
) -> Result<ArchitectureRepositoryList, String> {
    let root = resolve_workspace_root_directory(root_directory.as_deref())?;
    let topology = terminal_workspace_topology_scan_for_launch(state.inner(), &root).await;
    Ok(architecture_repositories_from_mounts(
        &root,
        &topology.mounts,
    ))
}

#[tauri::command]
async fn architecture_scanned_result(
    root_directory: Option<String>,
    state: State<'_, TerminalState>,
) -> Result<ArchitectureScannedResult, String> {
    let root = resolve_workspace_root_directory(root_directory.as_deref())?;
    let topology = terminal_workspace_topology_scan_for_launch(state.inner(), &root).await;
    Ok(architecture_scanned_result_from_topology(&root, topology))
}

#[tauri::command]
async fn architecture_graphs_list(repo_path: String) -> Result<ArchitectureGraphList, String> {
    tauri::async_runtime::spawn_blocking(move || architecture_graphs_list_blocking(repo_path))
        .await
        .map_err(|error| format!("Architecture graph list worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_read(repo_path: String, graph_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_read_blocking(repo_path, graph_id)
    })
    .await
    .map_err(|error| format!("Architecture graph read worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_save(
    repo_path: String,
    graph: Value,
) -> Result<ArchitectureGraphSaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || architecture_graph_save_blocking(repo_path, graph))
        .await
        .map_err(|error| format!("Architecture graph save worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_revisions_list(
    repo_path: String,
    graph_id: Option<String>,
) -> Result<ArchitectureGraphRevisionList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_revisions_list_blocking(repo_path, graph_id)
    })
    .await
    .map_err(|error| format!("Architecture revision list worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_revision_read(
    repo_path: String,
    graph_id: String,
    revision_id: String,
) -> Result<ArchitectureGraphRevisionReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_revision_read_blocking(repo_path, graph_id, revision_id)
    })
    .await
    .map_err(|error| format!("Architecture revision read worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_revision_restore(
    repo_path: String,
    graph_id: String,
    revision_id: String,
) -> Result<ArchitectureGraphRevisionRestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_revision_restore_blocking(repo_path, graph_id, revision_id)
    })
    .await
    .map_err(|error| format!("Architecture revision restore worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_delete(
    repo_path: String,
    graph_id: String,
) -> Result<ArchitectureGraphRevisionList, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_delete_blocking(repo_path, graph_id)
    })
    .await
    .map_err(|error| format!("Architecture graph delete worker failed: {error}"))??;
    Ok(result)
}

const ARCHITECTURE_STORE_CHANGED_EVENT: &str = "architecture-store-changed";

/// One recursive watcher over the centralized architecture store keeps the
/// Architecture tab live-refreshed: any graph source change — in-app saves,
/// agent edits from terminals, direct file edits — emits a debounced
/// `architecture-store-changed` event the webview reacts to. Only paths under
/// a `graphs/` directory count, so generated files (index.json, AGENTS.md,
/// icon-aliases.json, revisions) written during listing cannot self-trigger.
fn architecture_store_changed_scope(root: &Path, path: &Path) -> Option<(String, String)> {
    let relative = path.strip_prefix(root).ok()?;
    let components = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    let Some(graphs_index) = components
        .iter()
        .position(|component| *component == "graphs")
    else {
        return None;
    };
    let graph_id = components
        .get(graphs_index + 1)
        .and_then(|name| {
            let path = Path::new(name);
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if extension != "arch" && extension != "json" {
                return None;
            }
            path.file_stem()
        })
        .and_then(|value| value.to_str())
        .map(architecture_slug)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let slug = match components.first().copied() {
        Some("repos") => components.get(1).map(|slug| slug.to_string()),
        Some("global") => Some(ARCHITECTURE_GLOBAL_REPO_ID.to_string()),
        _ => None,
    }?;
    Some((slug, graph_id))
}

pub(crate) fn architecture_store_watcher_start(app: AppHandle) {
    std::thread::spawn(move || {
        use notify::Watcher as _;
        let Some(root) = architecture_central_data_root() else {
            return;
        };
        if fs::create_dir_all(&root).is_err() {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(tx) else {
            return;
        };
        if watcher
            .watch(&root, notify::RecursiveMode::Recursive)
            .is_err()
        {
            return;
        }
        let collect = |event: notify::Result<notify::Event>,
                       slugs: &mut HashSet<String>,
                       graph_ids: &mut HashSet<String>| {
            let Ok(event) = event else {
                return;
            };
            for path in &event.paths {
                if let Some((slug, graph_id)) = architecture_store_changed_scope(&root, path) {
                    slugs.insert(slug);
                    if !graph_id.is_empty() {
                        graph_ids.insert(graph_id);
                    }
                }
            }
        };
        loop {
            let mut pending_slugs = HashSet::new();
            let mut pending_graph_ids = HashSet::new();
            let Ok(first) = rx.recv() else {
                return;
            };
            collect(first, &mut pending_slugs, &mut pending_graph_ids);
            // Quiet-window debounce: keep absorbing the burst until 600ms of
            // silence, then emit one change event for the whole batch.
            loop {
                match rx.recv_timeout(Duration::from_millis(600)) {
                    Ok(event) => collect(event, &mut pending_slugs, &mut pending_graph_ids),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if pending_slugs.is_empty() {
                continue;
            }
            let slugs = pending_slugs.into_iter().collect::<Vec<_>>();
            let graph_ids = pending_graph_ids.into_iter().collect::<Vec<_>>();
            let _ = app.emit(
                ARCHITECTURE_STORE_CHANGED_EVENT,
                json!({
                    "slugs": slugs,
                    "graphIds": graph_ids.clone(),
                    "graph_ids": graph_ids,
                    "changedAtMs": architecture_now_millis(),
                }),
            );
        }
    });
}

pub(crate) fn architecture_global_root_dir() -> Result<PathBuf, String> {
    let root = cloud_mcp_local_data_file_path("architectures")
        .ok_or_else(|| "Global architectures root is unavailable.".to_string())?
        .join("global");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create global architectures root: {error}"))?;
    Ok(root)
}

pub(crate) fn architecture_global_agent_paths(
) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let root = architecture_global_root_dir()?;
    ensure_architecture_agent_guide(&root)?;
    let architecture_root = architecture_agents_root(&root);
    let graphs_root = architecture_root.join("graphs");
    fs::create_dir_all(&graphs_root).map_err(|error| {
        format!("Unable to create global architecture graph directory: {error}")
    })?;
    let guide_path = architecture_agent_guide_path(&root);
    let icon_reference_path = architecture_icon_reference_path(&root);
    Ok((
        root,
        architecture_root,
        graphs_root,
        guide_path,
        icon_reference_path,
    ))
}

pub(crate) fn architecture_global_agent_paths_or_fallback(
) -> (PathBuf, PathBuf, PathBuf, PathBuf, PathBuf) {
    architecture_global_agent_paths().unwrap_or_else(|_| {
        let root = std::env::temp_dir()
            .join("diffforge")
            .join("architectures")
            .join("global");
        let _ = ensure_architecture_agent_guide(&root);
        let architecture_root = architecture_agents_root(&root);
        let graphs_root = architecture_root.join("graphs");
        let _ = fs::create_dir_all(&graphs_root);
        let guide_path = architecture_agent_guide_path(&root);
        let icon_reference_path = architecture_icon_reference_path(&root);
        (
            root,
            architecture_root,
            graphs_root,
            guide_path,
            icon_reference_path,
        )
    })
}

fn architecture_central_data_root() -> Option<PathBuf> {
    cloud_mcp_local_data_file_path("architectures")
}

fn architecture_central_repos_root() -> Result<PathBuf, String> {
    let root = architecture_central_data_root()
        .ok_or_else(|| "Central architectures root is unavailable.".to_string())?
        .join("repos");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create central architectures repos root: {error}"))?;
    Ok(root)
}

fn architecture_path_is_central(path: &Path) -> bool {
    architecture_central_data_root()
        .map(|root| {
            normalized_path_key_is_same_or_child(
                &normalized_path_key(path),
                &normalized_path_key(&root),
            )
        })
        .unwrap_or(false)
}

fn architecture_copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(target)
        .map_err(|error| format!("Unable to create architecture migration directory: {error}"))?;
    let read_dir = fs::read_dir(source)
        .map_err(|error| format!("Unable to read architecture migration directory: {error}"))?;
    for entry in read_dir.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            architecture_copy_dir_recursive(&entry.path(), &destination)?;
        } else if !destination.exists() {
            fs::copy(entry.path(), &destination).map_err(|error| {
                format!("Unable to copy architecture file into central storage: {error}")
            })?;
        }
    }
    Ok(())
}

/// Account-stable identity for a named non-git architecture folder. The name
/// itself is the identity, so the same folder name converges to the same
/// centralized store (and the same cloud rows) on every device.
pub(crate) fn architecture_folder_identity_slug_for_name(name: &str) -> Option<String> {
    let slug = architecture_slug(name);
    if slug.is_empty() {
        return None;
    }
    Some(if slug.starts_with("folder-") {
        slug
    } else {
        format!("folder-{slug}")
    })
}

pub(crate) fn architecture_repo_identity_slug(repo: &Path) -> String {
    let identity = cloud_mcp_git_repo_identity_for_path(repo);
    if let Some(identity_id) = identity
        .get("git_repo_identity_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return architecture_slug(identity_id);
    }
    // Non-git folders are identified by their name, not their device-local
    // path, so the same workspace folder name maps to the same global
    // architecture store on every device.
    repo.file_name()
        .and_then(|value| value.to_str())
        .and_then(architecture_folder_identity_slug_for_name)
        .unwrap_or_else(|| architecture_slug(&cloud_mcp_repo_id_for_root(repo)))
}

fn architecture_folder_meta_path(base: &Path) -> PathBuf {
    architecture_agents_root(base).join(ARCHITECTURE_FOLDER_META_FILENAME)
}

/// Best-effort marker for named non-git architecture folders. Written once;
/// never overwrites an existing meta so user/agent supplied names stick.
fn architecture_write_folder_meta(base: &Path, slug: &str, name: &str, source: &str) {
    let meta_path = architecture_folder_meta_path(base);
    if meta_path.exists() {
        return;
    }
    let Some(parent) = meta_path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let meta = json!({
        "kind": "architecture_folder",
        "name": name,
        "slug": slug,
        "source": source,
        "createdAt": architecture_now_millis(),
    });
    if let Ok(bytes) = serde_json::to_vec_pretty(&meta) {
        let _ = fs::write(&meta_path, bytes);
    }
}

static ARCHITECTURE_CENTRAL_REPO_ROOT_CACHE: OnceLock<StdMutex<HashMap<String, PathBuf>>> =
    OnceLock::new();

/// Centralized per-repo architecture storage: every repo gets one folder under
/// the device's global architectures data root, keyed by its stable identity
/// (git remote identity when available, so the same repo maps to the same
/// folder on every device). Old workspace-local architecture artifacts and
/// legacy `orphans/<identity>` folders are migrated in once.
pub(crate) fn architecture_central_repo_root_for(repo: &Path) -> Result<PathBuf, String> {
    // Ephemeral guard: repos living under the OS temp dir never register in
    // the central architecture store — test harnesses and scratch checkouts
    // were polluting the Architecture hub with one entry per run. They stay
    // isolated to the scratch checkout for legacy test commands only. An
    // env-overridden data root (explicit test isolation)
    // is exempt and may exercise the central-store path.
    if cloud_mcp_env_path(CLOUD_MCP_LOCAL_DATA_DIR_ENV).is_none()
        && cloud_mcp_env_path(CLOUD_MCP_LOCAL_HOME_ENV).is_none()
    {
        let temp_dir = std::env::temp_dir();
        // Callers pass canonicalized roots (macOS /var → /private/var), so
        // match both the raw and the canonicalized temp dir.
        let repo_key = normalized_path_key(repo);
        let is_temp = [Some(temp_dir.clone()), temp_dir.canonicalize().ok()]
            .into_iter()
            .flatten()
            .any(|root| {
                normalized_path_key_is_same_or_child(&repo_key, &normalized_path_key(&root))
            });
        if is_temp {
            return Ok(repo.to_path_buf());
        }
    }
    let cache_key = normalized_path_key(repo);
    let cache = ARCHITECTURE_CENTRAL_REPO_ROOT_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Some(cached) = cache
        .lock()
        .ok()
        .and_then(|map| map.get(&cache_key).cloned())
    {
        return Ok(cached);
    }

    let slug = architecture_repo_identity_slug(repo);
    if slug.is_empty() {
        return Err("Unable to determine the architecture repo identity.".to_string());
    }
    let central = architecture_central_repos_root()?.join(&slug);
    if !architecture_agents_root(&central).exists() {
        // Migrate from legacy locations: the path-hash identity that non-git
        // folders used before name-based identities, plus old orphan caches.
        let legacy_path_hash_slug = architecture_slug(&cloud_mcp_repo_id_for_root(repo));
        let mut legacy_candidates = Vec::new();
        if let Some(data_root) = architecture_central_data_root() {
            if legacy_path_hash_slug != slug && !legacy_path_hash_slug.is_empty() {
                legacy_candidates.push(data_root.join("repos").join(&legacy_path_hash_slug));
                legacy_candidates.push(data_root.join("orphans").join(&legacy_path_hash_slug));
            }
            legacy_candidates.push(data_root.join("orphans").join(&slug));
        }
        if let Some(legacy) = legacy_candidates.into_iter().find(|path| path.exists()) {
            if fs::rename(&legacy, &central).is_err() {
                let _ = architecture_copy_dir_recursive(&legacy, &central);
            }
        }
    }
    fs::create_dir_all(&central)
        .map_err(|error| format!("Unable to create central architecture repo folder: {error}"))?;
    let central_graphs = architecture_agents_root(&central).join("graphs");
    if !central_graphs.exists() {
        let legacy_repo_root = architecture_agents_root(repo);
        if legacy_repo_root.join("graphs").exists() {
            let _ =
                architecture_copy_dir_recursive(&legacy_repo_root.join("graphs"), &central_graphs);
            let _ = architecture_copy_dir_recursive(
                &legacy_repo_root.join("revisions"),
                &architecture_agents_root(&central).join("revisions"),
            );
        }
    }
    if slug.starts_with("folder-") {
        let display_name = repo
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&slug);
        architecture_write_folder_meta(&central, &slug, display_name, "workspace-folder");
    }

    if let Ok(mut map) = cache.lock() {
        map.insert(cache_key, central.clone());
    }
    Ok(central)
}

/// Resolve the requested repo path plus the centralized storage base for it.
/// Paths already inside the central architectures data root (global root,
/// per-repo central folders) are used as-is — and they must be detected
/// BEFORE the workspace-root validation runs: the central store lives under
/// the app data directory (e.g. ~/Library/Application Support), which that
/// validation rejects as "an application settings, cache, or package manager
/// folder" even though it is our own managed storage.
fn architecture_resolved_and_storage(repo_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let trimmed = repo_path.trim();
    if !trimmed.is_empty() {
        let raw = PathBuf::from(trimmed);
        let candidate = raw.canonicalize().unwrap_or(raw);
        if architecture_path_is_central(&candidate) {
            return Ok((candidate.clone(), candidate));
        }
    }
    let resolved = resolve_workspace_root_directory(Some(repo_path))?;
    if architecture_path_is_central(&resolved) {
        return Ok((resolved.clone(), resolved));
    }
    let storage = architecture_central_repo_root_for(&resolved)?;
    Ok((resolved, storage))
}

fn architecture_storage_repo_base(repo_path: &str) -> Result<PathBuf, String> {
    architecture_resolved_and_storage(repo_path).map(|(_, storage)| storage)
}

/// Architecture env/context paths for coding agents launched against a repo.
/// Architecture graph storage is account-global; the repo path is intentionally
/// ignored so agents do not recreate workspace-scoped architecture stores.
pub(crate) fn architecture_env_paths_for_repo(
    _repo_path: &str,
) -> (String, String, String, String) {
    let (_, root, graphs_root, guide_path, icon_reference_path) =
        architecture_global_agent_paths_or_fallback();
    (
        workspace_path_display(&root),
        workspace_path_display(&graphs_root),
        workspace_path_display(&guide_path),
        workspace_path_display(&icon_reference_path),
    )
}

/// Return the account-global architecture root and carry a requested folder
/// path for callers that want to start graph creation inside a named folder.
pub(crate) fn architecture_named_root_value(name: String) -> Result<Value, String> {
    let display_name = name.trim();
    if display_name.is_empty() {
        return Err("Architecture folder name is required.".to_string());
    }
    let folder_path = architecture_group_path_from_text(display_name).join(" / ");
    if folder_path.is_empty() {
        return Err("Architecture folder name needs at least one letter or digit.".to_string());
    }
    let root = architecture_global_root_dir()?;
    ensure_architecture_agent_guide(&root)?;
    let architecture_root = architecture_agents_root(&root);
    Ok(json!({
        "kind": "architecture_named_folder",
        "scopeKind": "global",
        "name": "Global",
        "folderPath": folder_path.clone(),
        "folder_path": folder_path.clone(),
        "initialFolderPath": folder_path.clone(),
        "initial_folder_path": folder_path,
        "repoId": ARCHITECTURE_GLOBAL_REPO_ID,
        "identityKey": ARCHITECTURE_GLOBAL_REPO_ID,
        "rootDirectory": workspace_path_display(&root),
        "root_directory": workspace_path_display(&root),
        "path": workspace_path_display(&root),
        "architectureRoot": workspace_path_display(&architecture_root),
        "graphsRoot": workspace_path_display(&architecture_root.join("graphs")),
        "graphCount": architecture_graph_count(&root),
    }))
}

#[tauri::command]
async fn architecture_named_root(name: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || architecture_named_root_value(name))
        .await
        .map_err(|error| format!("Architecture named root worker failed: {error}"))?
}

pub(crate) fn architecture_global_root_value() -> Result<Value, String> {
    let root = architecture_global_root_dir()?;
    let _ = ensure_architecture_agent_guide(&root);
    let architecture_root = architecture_agents_root(&root);
    Ok(json!({
        "kind": "architecture_global_root",
        "scope": "global",
        "rootDirectory": workspace_path_display(&root),
        "root_directory": workspace_path_display(&root),
        "architectureRoot": workspace_path_display(&architecture_root),
        "graphsRoot": workspace_path_display(&architecture_root.join("graphs")),
        "repoId": ARCHITECTURE_GLOBAL_REPO_ID,
        "repo_id": ARCHITECTURE_GLOBAL_REPO_ID,
        "workspaceId": ARCHITECTURE_GLOBAL_WORKSPACE_ID,
        "workspace_id": ARCHITECTURE_GLOBAL_WORKSPACE_ID,
        "graphCount": architecture_graph_count(&root),
    }))
}

#[tauri::command]
async fn architecture_global_root() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(architecture_global_root_value)
        .await
        .map_err(|error| format!("Architecture global root worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_copy(
    source_repo_path: String,
    target_repo_path: String,
    graph_id: String,
) -> Result<ArchitectureGraphSaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = architecture_storage_repo_base(source_repo_path.as_str())?;
        let target = architecture_storage_repo_base(target_repo_path.as_str())?;
        if normalized_path_key(&source) == normalized_path_key(&target) {
            return Err("Architecture graph is already in that location.".to_string());
        }
        let graph = architecture_graph_read_blocking(source_repo_path, graph_id)?;
        architecture_graph_save_blocking_with_reason(target_repo_path, graph, "copy")
    })
    .await
    .map_err(|error| format!("Architecture graph copy worker failed: {error}"))?
}

#[cfg(test)]
mod architecture_folder_list_tests {
    use super::*;

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "diffforge-arch-list-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn folder_list_includes_all_subfolders_and_labels_git() {
        let root = temp_workspace("mixed");
        let git_repo = root.join("repo-a");
        fs::create_dir_all(git_repo.join(".git")).unwrap();
        fs::write(git_repo.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(root.join("plain-folder")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();

        let list = architecture_repositories_from_mounts(&root, &[]);
        let names: Vec<(String, bool)> = list
            .repositories
            .iter()
            .map(|repo| (repo.name.clone(), repo.has_git))
            .collect();

        assert!(
            names
                .iter()
                .any(|(name, has_git)| name == "repo-a" && *has_git),
            "git subfolder must be listed and labeled git: {names:?}"
        );
        assert!(
            names
                .iter()
                .any(|(name, has_git)| name == "plain-folder" && !*has_git),
            "plain subfolder must be listed without git label: {names:?}"
        );
        assert!(
            !names
                .iter()
                .any(|(name, _)| name == "node_modules" || name == ".hidden"),
            "junk and hidden folders stay out: {names:?}"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
