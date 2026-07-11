// Pure unified-diff parsing for the transcript's reviewable file-change
// cards (turn_diff records). Dependency-free so it runs under `node --test`.
//
// The desktop emits one unified diff per file (---/+++ header + @@ hunks,
// via `git diff-tree -p`), so this parser only has to understand a single
// file's patch: git extended headers (rename / new / deleted / binary),
// multiple hunks, and `\ No newline at end of file` markers.

import { transcriptText } from "./builders.mjs";

/* ------------------------------------------------------------------ */
/* Unified patch parsing                                                */
/* ------------------------------------------------------------------ */

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/;

function stripDiffPathPrefix(raw = "") {
  const text = transcriptText(raw);
  if (!text || text === "/dev/null") return "";
  const unquoted = text.startsWith('"') && text.endsWith('"') && text.length > 1
    ? text.slice(1, -1)
    : text;
  return unquoted.replace(/^[ab]\//, "");
}

// Parses one file's unified diff into hunks with old/new line numbers.
// Returns { oldPath, newPath, binary, hunks } — never throws; malformed
// input degrades to whatever hunks parsed cleanly.
export function parseUnifiedPatch(patch = "") {
  const result = {
    old_path: "",
    new_path: "",
    binary: false,
    hunks: [],
  };
  if (typeof patch !== "string" || !patch) return result;
  const lines = patch.split(/\r?\n/);
  // Patches ending in a newline (every real emitter's output) split into a
  // trailing "" element that would render as a phantom context line
  // numbered one past EOF — drop that single trailing empty element.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;
  const closeHunk = () => {
    if (hunk && hunk.lines.length) {
      result.hunks.push(hunk);
    }
    hunk = null;
  };
  for (const line of lines) {
    const headerMatch = HUNK_HEADER_RE.exec(line);
    if (headerMatch) {
      closeHunk();
      oldLine = Number(headerMatch[1]);
      newLine = Number(headerMatch[3]);
      hunk = {
        oldStart: oldLine,
        oldLines: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
        newStart: newLine,
        newLines: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
        section: transcriptText(headerMatch[5] || ""),
        additions: 0,
        deletions: 0,
        lines: [],
      };
      continue;
    }
    if (!hunk) {
      // File header / extended header territory.
      if (line.startsWith("--- ")) {
        result.old_path = stripDiffPathPrefix(line.slice(4)) || result.old_path;
      } else if (line.startsWith("+++ ")) {
        result.new_path = stripDiffPathPrefix(line.slice(4)) || result.new_path;
      } else if (line.startsWith("rename from ")) {
        result.old_path = result.old_path || transcriptText(line.slice("rename from ".length));
      } else if (line.startsWith("rename to ")) {
        result.new_path = result.new_path || transcriptText(line.slice("rename to ".length));
      } else if (/^Binary files .* differ$/.test(line) || line.startsWith("GIT binary patch")) {
        result.binary = true;
      }
      continue;
    }
    const marker = line[0];
    if (marker === "+") {
      hunk.lines.push({ type: "add", text: line.slice(1), oldLine: null, newLine });
      hunk.additions += 1;
      newLine += 1;
    } else if (marker === "-") {
      hunk.lines.push({ type: "del", text: line.slice(1), oldLine, newLine: null });
      hunk.deletions += 1;
      oldLine += 1;
    } else if (marker === "\\") {
      // "\ No newline at end of file" annotates the previous line.
      const previous = hunk.lines[hunk.lines.length - 1];
      if (previous) previous.noNewline = true;
    } else if (marker === " " || line === "") {
      // Some emitters drop the leading space on empty context lines.
      hunk.lines.push({ type: "context", text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      // Unknown marker: the hunk body has ended (e.g. another file's
      // headers were concatenated). Close and fall back to header parsing.
      closeHunk();
      if (line.startsWith("--- ")) {
        result.old_path = stripDiffPathPrefix(line.slice(4)) || result.old_path;
      } else if (line.startsWith("+++ ")) {
        result.new_path = stripDiffPathPrefix(line.slice(4)) || result.new_path;
      } else if (/^Binary files .* differ$/.test(line)) {
        result.binary = true;
      }
    }
  }
  closeHunk();
  return result;
}

export function hunkHeaderLabel(hunk = {}) {
  const oldStart = Number(hunk.oldStart) || 0;
  const oldLines = Number(hunk.oldLines) || 0;
  const newStart = Number(hunk.newStart) || 0;
  const newLines = Number(hunk.newLines) || 0;
  const base = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
  const section = transcriptText(hunk.section);
  return section ? `${base} ${section}` : base;
}

// The text content of a hunk's displayed lines (one entry per rendered
// line, prefix stripped) — the unit handed to the syntax highlighter so
// grammar state flows across context/add/del lines.
export function hunkLinesText(hunk = {}) {
  return (Array.isArray(hunk.lines) ? hunk.lines : []).map((line) => line.text ?? "").join("\n");
}

/* ------------------------------------------------------------------ */
/* Language from file extension                                         */
/* ------------------------------------------------------------------ */

const EXTENSION_LANGUAGES = Object.freeze({
  js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
  json: "json", jsonc: "json",
  rs: "rust",
  py: "python",
  sh: "bash", bash: "bash", zsh: "bash",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  md: "md", markdown: "md", mdx: "md",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  xml: "xml", svg: "xml",
  vue: "vue", svelte: "svelte",
  lua: "lua",
  zig: "zig",
  dockerfile: "docker",
  graphql: "graphql", gql: "graphql",
  proto: "proto",
  tf: "hcl",
  ini: "ini", conf: "ini",
});

export function languageFromPath(path = "") {
  const text = transcriptText(path).toLowerCase();
  if (!text) return "";
  const base = text.split("/").pop() || "";
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "makefile";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  const extension = base.slice(dot + 1);
  return EXTENSION_LANGUAGES[extension] || "";
}
