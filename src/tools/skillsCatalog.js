import { CLI_CATALOG } from "./cliCatalog.js";

/**
 * Downloadable skills for the Tools tab: a curated set of widely used
 * engineering playbooks plus skills tied to CLIs from the CLI catalog.
 * "Adding" a skill copies it into the user's cloud-synced library, where it
 * can be edited like any custom skill. `icon` is either `codicon:<name>` or
 * `cli:<catalog id>` (resolved to the CLI's brand icon).
 */
export const SKILLS_CATALOG = [
  {
    id: "conventional-commits",
    title: "Conventional Commits",
    description: "Structured commit messages that make history and changelogs machine-readable.",
    icon: "codicon:git-commit",
    tone: "amber",
    source: "catalog",
    content: `Write every commit as \`type(scope): summary\`.

- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
- Summary in imperative mood, lowercase, no trailing period, under 72 chars.
- Breaking changes: add \`!\` after the type/scope and a \`BREAKING CHANGE:\` footer.
- Body explains the why, not the what; wrap at 72 columns.
- One logical change per commit — split mechanical renames from behavior changes.`,
  },
  {
    id: "code-review-checklist",
    title: "Code Review Checklist",
    description: "What to verify before approving a pull request.",
    icon: "codicon:checklist",
    tone: "blue",
    source: "catalog",
    content: `Review in this order, stopping at the first failed gate:

1. Correctness — does the change do what the description claims? Trace one happy path and one failure path by hand.
2. Tests — new behavior has tests that fail without the change; edge cases (empty, null, concurrent) are covered.
3. Security — inputs validated, secrets out of code, authz checked at every new entry point.
4. Readability — names say intent, no dead code, comments explain constraints not mechanics.
5. Blast radius — migrations reversible, feature-flagged when risky, public APIs versioned.

Prefer small, specific comments ("this loop is O(n²) for X") over vague ones ("could be faster").`,
  },
  {
    id: "test-driven-development",
    title: "Test-Driven Development",
    description: "Red, green, refactor — drive design from failing tests.",
    icon: "codicon:beaker",
    tone: "green",
    source: "catalog",
    content: `Loop: write a failing test, make it pass with the simplest code, refactor, repeat.

- Write the assertion first; name the test after the behavior, not the method.
- One behavior per test. If a test needs heavy setup, the design is telling you something.
- Never refactor on red. Never add behavior on green without a new failing test.
- Fast tests or it doesn't work: keep the unit suite under a few seconds.
- Treat flaky tests as production bugs — quarantine and fix the root cause same day.`,
  },
  {
    id: "systematic-debugging",
    title: "Systematic Debugging",
    description: "Scientific-method debugging instead of shotgun changes.",
    icon: "codicon:bug",
    tone: "red",
    source: "catalog",
    content: `1. Reproduce reliably first — a bug you can't reproduce is a bug you can't verify fixed.
2. Write down the expected vs observed behavior precisely.
3. Form one hypothesis, design the cheapest experiment that can falsify it, run it.
4. Bisect aggressively: half the input, half the commits (\`git bisect\`), half the code path.
5. Change one variable at a time; revert experiments that taught you nothing.
6. When found, explain why the bug existed AND why it escaped tests — then add the missing test before the fix.`,
  },
  {
    id: "safe-refactoring",
    title: "Safe Refactoring",
    description: "Behavior-preserving changes in small reversible steps.",
    icon: "codicon:tools",
    tone: "purple",
    source: "catalog",
    content: `- Establish a safety net first: tests green, or add characterization tests for the code you're about to touch.
- Separate refactors from behavior changes into different commits — reviewers should be able to skim the mechanical ones.
- Use the smallest named refactor that applies: extract function, inline, rename, move. Avoid "rewrite".
- Keep the build green after every step; if a step can't be done green, find a smaller step (parallel change / expand-migrate-contract).
- Stop when the code supports the feature you actually need — refactoring without a driver is gold-plating.`,
  },
  {
    id: "semantic-versioning",
    title: "Semantic Versioning & Releases",
    description: "When to bump major/minor/patch and how to cut clean releases.",
    icon: "codicon:tag",
    tone: "cyan",
    source: "catalog",
    content: `MAJOR.MINOR.PATCH:

- PATCH: bug fixes only, no API change.
- MINOR: new backwards-compatible functionality; deprecations announced here.
- MAJOR: any breaking change — removed/renamed APIs, changed defaults, raised minimum runtimes.

Release hygiene:
- Tag from a green main; the tag is immutable, fixes get a new patch.
- Changelog entries grouped Added/Changed/Fixed/Removed, written for users not committers.
- Deprecate in one minor, remove in the next major, never silently.`,
  },
  {
    id: "readme-writing",
    title: "Writing Good READMEs",
    description: "The five sections every README needs, in order.",
    icon: "codicon:book",
    tone: "blue",
    source: "catalog",
    content: `Order matters — readers bail fast:

1. One-sentence pitch: what it is and who it's for.
2. Quickstart: copy-paste commands from zero to running in under a minute.
3. Usage: the 3-5 most common operations with real examples.
4. Configuration: only the options people actually change, table form.
5. Contributing/license footer.

Rules: show output next to commands, keep examples runnable, delete anything describing how the code works internally — that belongs in docs/ or the code.`,
  },
  {
    id: "security-review",
    title: "Security Review Basics",
    description: "OWASP-flavored checklist for reviewing changes that touch inputs, auth, or data.",
    icon: "codicon:shield",
    tone: "red",
    source: "catalog",
    content: `For any change handling user input, auth, or persistence:

- Injection: parameterized queries only; never build shell commands from input.
- AuthZ: check permissions server-side at every endpoint, not just the UI.
- Secrets: no keys in code or logs; rotate anything that ever leaked into a commit.
- Data exposure: log IDs not payloads; error messages reveal nothing internal.
- SSRF/paths: validate URLs and file paths against allowlists, resolve before checking.
- Dependencies: pin versions, review postinstall scripts, run the audit tooling in CI.`,
  },
  {
    id: "performance-profiling",
    title: "Performance Profiling",
    description: "Measure before optimizing; find the actual bottleneck.",
    icon: "codicon:dashboard",
    tone: "orange",
    source: "catalog",
    content: `- Never optimize without a profile. Intuition about hot spots is wrong more often than right.
- Define the metric first (p95 latency, throughput, memory ceiling) and the target number.
- Profile the real workload — synthetic microbenchmarks lie about caches and I/O.
- Fix the biggest bar in the flame graph, re-measure, repeat. One change per measurement.
- Watch for the classics: N+1 queries, sync I/O on hot paths, unbounded caches, accidental O(n²) in loops over loops.
- Keep the benchmark script in the repo so regressions are one command to detect.`,
  },
  {
    id: "api-design",
    title: "API Design Review",
    description: "Designing endpoints and interfaces people can't misuse.",
    icon: "codicon:plug",
    tone: "purple",
    source: "catalog",
    content: `- Model resources, not database tables; URLs are nouns, methods are verbs.
- Make the easy path the correct path: good defaults, required params explicit, footguns impossible.
- Errors are part of the API: stable error codes, human message, machine-readable details.
- Paginate every list from day one; cap page sizes.
- Version from day one (path or header) and never change response shapes in place.
- Idempotency keys for anything that charges, sends, or creates.`,
  },
  {
    id: "git-workflows",
    title: "Git Workflows",
    description: "Branching, interactive rebase, and bisect for a clean history.",
    icon: "cli:git",
    tone: "orange",
    source: "cli",
    cliBinary: "git",
    content: `- Branch per change, rebase on main before review: \`git fetch && git rebase origin/main\`.
- Shape history before pushing: \`git rebase -i\` to squash fixups, reorder, reword.
- \`git add -p\` to stage hunks — commits stay focused even when the working tree isn't.
- Find regressions with \`git bisect run <test-cmd>\` — automate it, don't guess.
- Recover anything with \`git reflog\`; nothing committed is ever lost.
- \`git stash push -m "why"\` with a message, or you'll never know what stash@{3} was.`,
  },
  {
    id: "github-cli",
    title: "GitHub CLI Flows",
    description: "PRs, reviews, and CI from the terminal with gh.",
    icon: "cli:gh",
    tone: "slate",
    source: "cli",
    cliBinary: "gh",
    content: `- \`gh pr create --fill\` from the branch; \`--draft\` until CI is green.
- \`gh pr checks --watch\` to follow CI; \`gh run view --log-failed\` for the broken job's logs only.
- Review without leaving the terminal: \`gh pr diff\`, \`gh pr review --approve|--request-changes -b "..."\`.
- \`gh pr checkout 123\` to test a contributor's PR locally.
- Automate with \`gh api\` + \`--jq\` for anything the porcelain doesn't cover.
- \`gh issue develop 456 --checkout\` links the branch to the issue from the start.`,
  },
  {
    id: "docker-workflows",
    title: "Docker Builds & Debugging",
    description: "Small images, fast builds, and container debugging.",
    icon: "cli:docker",
    tone: "blue",
    source: "cli",
    cliBinary: "docker",
    content: `- Multi-stage builds: compile in a fat stage, copy artifacts into a slim runtime stage.
- Order Dockerfile lines by change frequency — dependencies before source — to keep cache hits.
- Pin base images by digest for reproducible builds.
- Debug a running container: \`docker exec -it <id> sh\`; debug a crashed one: \`docker logs\` then \`docker run --entrypoint sh\`.
- \`docker system df\` and \`docker system prune\` when disk mysteriously vanishes.
- One process per container; use compose for anything that needs friends.`,
  },
  {
    id: "kubectl-debugging",
    title: "kubectl Debugging",
    description: "Inspecting and debugging workloads in a cluster.",
    icon: "cli:kubectl",
    tone: "blue",
    source: "cli",
    cliBinary: "kubectl",
    content: `Triage order for a sick workload:

1. \`kubectl get pods -o wide\` — status, restarts, node.
2. \`kubectl describe pod <pod>\` — events at the bottom tell you why it won't schedule/start.
3. \`kubectl logs <pod> --previous\` — the crash before the restart.
4. \`kubectl exec -it <pod> -- sh\` — poke the live container.
5. \`kubectl debug node/<node> -it --image=busybox\` when it's the node, not the pod.

\`-o yaml\` + diff against git is the fastest way to spot drift.`,
  },
  {
    id: "terraform-discipline",
    title: "Terraform Discipline",
    description: "Plan/apply hygiene that keeps state and reality in sync.",
    icon: "cli:terraform",
    tone: "purple",
    source: "cli",
    cliBinary: "terraform",
    content: `- Never apply what you didn't plan: \`terraform plan -out=tfplan\` then \`terraform apply tfplan\`.
- Read every destroy in a plan twice; \`prevent_destroy\` on stateful resources.
- Remote state with locking, one state per environment, never edit state by hand — use \`terraform state mv/rm\`.
- \`terraform fmt -check\` and \`validate\` in CI; modules versioned with semver tags.
- Import existing infra (\`terraform import\`) before recreating it.
- Variables for things that differ per env; locals for things that don't.`,
  },
  {
    id: "aws-cli-skills",
    title: "AWS CLI Essentials",
    description: "Querying and scripting AWS safely from the terminal.",
    icon: "cli:aws",
    tone: "amber",
    source: "cli",
    cliBinary: "aws",
    content: `- Profiles per account/role in \`~/.aws/config\`; never default to prod — \`--profile\` explicitly.
- \`--query\` (JMESPath) + \`--output table|json\` beats grepping: \`aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name]'\`.
- Dry-run destructive calls where supported (\`--dry-run\` on EC2).
- \`aws sts get-caller-identity\` before anything mutating — know who you are.
- Paginate big lists with \`--max-items\`/\`--starting-token\`, don't truncate silently.
- Script with \`set -euo pipefail\` and explicit \`--region\`.`,
  },
  {
    id: "jq-wrangling",
    title: "jq JSON Wrangling",
    description: "Filtering and reshaping JSON on the command line.",
    icon: "cli:jq",
    tone: "green",
    source: "cli",
    cliBinary: "jq",
    content: `- Select fields: \`jq '.items[] | {id, name}'\`; filter: \`jq '.[] | select(.status=="failed")'\`.
- \`-r\` for raw strings when piping into other tools.
- Group and count: \`jq 'group_by(.type) | map({type: .[0].type, n: length})'\`.
- Build objects from env in scripts: \`jq -n --arg v "$VAL" '{value: $v}'\` — never string-interpolate JSON.
- \`keys\`, \`type\`, and \`paths\` are your explorers for unknown payloads.
- Streaming huge files: \`jq -c '.[]'\` to NDJSON, then process line by line.`,
  },
  {
    id: "psql-skills",
    title: "psql & SQL Hygiene",
    description: "Inspecting schemas and writing safe queries in psql.",
    icon: "cli:psql",
    tone: "cyan",
    source: "cli",
    cliBinary: "psql",
    content: `- Explore fast: \`\\dt\` tables, \`\\d table\` schema, \`\\df\` functions, \`\\x\` for wide rows.
- Always \`EXPLAIN ANALYZE\` before adding an index; verify it's used after.
- Wrap risky writes: \`BEGIN; UPDATE ...; SELECT ... ;\` inspect, then \`COMMIT\` or \`ROLLBACK\`.
- \`UPDATE\`/\`DELETE\` without \`WHERE\` should scare you — write the \`SELECT\` first, then convert.
- \`\\timing on\` to see query latency; \`pg_stat_activity\` to find what's stuck.
- Migrations: additive first (new column nullable), backfill, then constrain.`,
  },
  {
    id: "curl-debugging",
    title: "curl HTTP Debugging",
    description: "Reproducing and debugging HTTP issues precisely.",
    icon: "cli:curl",
    tone: "slate",
    source: "cli",
    cliBinary: "curl",
    content: `- \`-v\` shows the full exchange; \`-sS\` quiet but loud on errors; \`-i\` to keep response headers.
- Time breakdown: \`curl -w '%{time_namelookup} %{time_connect} %{time_starttransfer} %{time_total}\\n' -o /dev/null -s URL\`.
- POST JSON: \`curl -X POST -H 'content-type: application/json' -d @body.json URL\`.
- Follow redirects with \`-L\`, but debug them without it first.
- \`--resolve host:443:1.2.3.4\` to test a specific backend behind DNS/LB.
- Save the exact failing request as a \`.sh\` in the bug report — reproducibility wins arguments.`,
  },
  {
    id: "ffmpeg-essentials",
    title: "FFmpeg Essentials",
    description: "The transcode, trim, and inspect recipes you actually need.",
    icon: "cli:ffmpeg",
    tone: "green",
    source: "cli",
    cliBinary: "ffmpeg",
    content: `- Inspect first: \`ffprobe -v error -show_format -show_streams input.mp4\`.
- Transcode sanely: \`ffmpeg -i in.mov -c:v libx264 -crf 23 -preset medium -c:a aac out.mp4\` (lower CRF = bigger/better).
- Trim without re-encoding: \`ffmpeg -ss 00:01:00 -to 00:02:00 -i in.mp4 -c copy out.mp4\`.
- Extract audio: \`-vn -c:a copy\`; make a GIF: scale + palette two-pass for quality.
- \`-c copy\` whenever you aren't changing codecs — it's instant and lossless.
- Batch in shell loops; FFmpeg flags before \`-i\` apply to input, after apply to output.`,
  },
];

const CLI_BY_ID = new Map(CLI_CATALOG.map((entry) => [entry.id, entry]));

/** Resolves `cli:<id>` skill icons to the CLI catalog's brand icon component. */
export function skillCliIcon(iconKey) {
  const key = String(iconKey || "");
  if (!key.startsWith("cli:")) return null;
  return CLI_BY_ID.get(key.slice(4))?.icon || null;
}

/** The probe binary for CLI-sourced skills, so the UI can badge relevance. */
export function skillCliBinary(skill) {
  const fromSkill = String(skill?.cliBinary || "").trim();
  if (fromSkill) return fromSkill;
  const icon = String(skill?.icon || "");
  if (!icon.startsWith("cli:")) return "";
  return CLI_BY_ID.get(icon.slice(4))?.binary || "";
}
