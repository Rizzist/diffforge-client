import test from "node:test";
import assert from "node:assert/strict";

import {
  hunkHeaderLabel,
  hunkLinesText,
  languageFromPath,
  parseUnifiedPatch,
} from "./diffHunks.mjs";
import { normalizeTurnDiffFile } from "./builders.mjs";

/* ------------------------------------------------------------------ */
/* parseUnifiedPatch                                                    */
/* ------------------------------------------------------------------ */

const EDIT_PATCH = [
  "diff --git a/src/lib.rs b/src/lib.rs",
  "index 1111111..2222222 100644",
  "--- a/src/lib.rs",
  "+++ b/src/lib.rs",
  "@@ -1,4 +1,5 @@",
  " fn main() {",
  "-    println!(\"old\");",
  "+    println!(\"new\");",
  "+    println!(\"extra\");",
  " }",
  " // tail",
  "@@ -20,3 +21,3 @@ mod tests {",
  "     #[test]",
  "-    fn old_test() {}",
  "+    fn new_test() {}",
].join("\n");

test("parseUnifiedPatch parses multiple hunks with line numbers", () => {
  const parsed = parseUnifiedPatch(EDIT_PATCH);
  assert.equal(parsed.oldPath, "src/lib.rs");
  assert.equal(parsed.newPath, "src/lib.rs");
  assert.equal(parsed.binary, false);
  assert.equal(parsed.hunks.length, 2);

  const [first, second] = parsed.hunks;
  assert.equal(first.oldStart, 1);
  assert.equal(first.oldLines, 4);
  assert.equal(first.newStart, 1);
  assert.equal(first.newLines, 5);
  assert.equal(first.additions, 2);
  assert.equal(first.deletions, 1);
  assert.deepEqual(
    first.lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
      ["context", 4, 5],
    ],
  );

  assert.equal(second.section, "mod tests {");
  assert.equal(second.oldStart, 20);
  assert.equal(second.newStart, 21);
  assert.deepEqual(
    second.lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [
      ["context", 20, 21],
      ["del", 21, null],
      ["add", null, 22],
    ],
  );
});

test("parseUnifiedPatch handles no newline at end of file", () => {
  const patch = [
    "--- a/notes.txt",
    "+++ b/notes.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old tail",
    "\\ No newline at end of file",
    "+new tail",
    "\\ No newline at end of file",
  ].join("\n");
  const parsed = parseUnifiedPatch(patch);
  assert.equal(parsed.hunks.length, 1);
  const lines = parsed.hunks[0].lines;
  assert.equal(lines.length, 3);
  assert.equal(lines[1].type, "del");
  assert.equal(lines[1].noNewline, true);
  assert.equal(lines[2].type, "add");
  assert.equal(lines[2].noNewline, true);
  assert.equal(lines[0].noNewline, undefined);
});

test("parseUnifiedPatch reads rename headers", () => {
  const patch = [
    "diff --git a/old/name.js b/new/name.js",
    "similarity index 92%",
    "rename from old/name.js",
    "rename to new/name.js",
    "--- a/old/name.js",
    "+++ b/new/name.js",
    "@@ -3,2 +3,2 @@",
    "-const a = 1;",
    "+const a = 2;",
    " export default a;",
  ].join("\n");
  const parsed = parseUnifiedPatch(patch);
  assert.equal(parsed.oldPath, "old/name.js");
  assert.equal(parsed.newPath, "new/name.js");
  assert.equal(parsed.hunks.length, 1);
});

test("parseUnifiedPatch reads rename-only patches without ---/+++ lines", () => {
  const patch = [
    "diff --git a/a.txt b/b.txt",
    "similarity index 100%",
    "rename from a.txt",
    "rename to b.txt",
  ].join("\n");
  const parsed = parseUnifiedPatch(patch);
  assert.equal(parsed.oldPath, "a.txt");
  assert.equal(parsed.newPath, "b.txt");
  assert.equal(parsed.hunks.length, 0);
});

test("parseUnifiedPatch handles create and delete patches", () => {
  const create = parseUnifiedPatch([
    "--- /dev/null",
    "+++ b/fresh.py",
    "@@ -0,0 +1,2 @@",
    "+import os",
    "+print(os.name)",
  ].join("\n"));
  assert.equal(create.oldPath, "");
  assert.equal(create.newPath, "fresh.py");
  assert.deepEqual(
    create.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [["add", null, 1], ["add", null, 2]],
  );

  const remove = parseUnifiedPatch([
    "--- a/gone.py",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-import os",
    "-print(os.name)",
  ].join("\n"));
  assert.equal(remove.newPath, "");
  assert.deepEqual(
    remove.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [["del", 1, null], ["del", 2, null]],
  );
});

test("parseUnifiedPatch detects binary markers", () => {
  const parsed = parseUnifiedPatch([
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
  ].join("\n"));
  assert.equal(parsed.binary, true);
  assert.equal(parsed.hunks.length, 0);
});

test("parseUnifiedPatch tolerates empty context lines without a leading space", () => {
  const patch = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,3 +1,3 @@",
    " a",
    "",
    "-b",
    "+c",
  ].join("\n");
  const parsed = parseUnifiedPatch(patch);
  const lines = parsed.hunks[0].lines;
  assert.deepEqual(
    lines.map((line) => [line.type, line.text]),
    [["context", "a"], ["context", ""], ["del", "b"], ["add", "c"]],
  );
});

test("parseUnifiedPatch drops the trailing newline's phantom empty line", () => {
  // Real emitters (git diff-tree -p on the desktop) end every patch with a
  // newline; the split's trailing "" must not render as an extra context
  // line numbered one past EOF.
  const patch = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "",
  ].join("\n");
  const parsed = parseUnifiedPatch(patch);
  assert.equal(parsed.hunks.length, 1);
  assert.deepEqual(
    parsed.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [["context", 1, 1], ["del", 2, null], ["add", null, 2]],
  );
});

test("parseUnifiedPatch drops the phantom empty line on CRLF patches too", () => {
  const patch = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "",
  ].join("\r\n");
  const parsed = parseUnifiedPatch(patch);
  assert.equal(parsed.hunks.length, 1);
  assert.deepEqual(
    parsed.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine]),
    [["context", 1, 1], ["del", 2, null], ["add", null, 2]],
  );
  // Interior empty context lines (no leading space) still parse as context.
  const interior = parseUnifiedPatch([
    "--- a/y.txt",
    "+++ b/y.txt",
    "@@ -1,3 +1,3 @@",
    " a",
    "",
    " b",
    "",
  ].join("\n"));
  assert.deepEqual(
    interior.hunks[0].lines.map((line) => [line.type, line.text]),
    [["context", "a"], ["context", ""], ["context", "b"]],
  );
});

test("parseUnifiedPatch handles single-line hunks without a count", () => {
  const parsed = parseUnifiedPatch([
    "--- a/one.txt",
    "+++ b/one.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n"));
  const hunk = parsed.hunks[0];
  assert.equal(hunk.oldLines, 1);
  assert.equal(hunk.newLines, 1);
  assert.equal(hunk.additions, 1);
  assert.equal(hunk.deletions, 1);
});

test("parseUnifiedPatch never throws on malformed input", () => {
  assert.deepEqual(parseUnifiedPatch(null).hunks, []);
  assert.deepEqual(parseUnifiedPatch("").hunks, []);
  assert.deepEqual(parseUnifiedPatch("not a patch at all").hunks, []);
  const truncated = parseUnifiedPatch([
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,50 +1,50 @@",
    " context",
    "+added",
  ].join("\n"));
  assert.equal(truncated.hunks.length, 1);
  assert.equal(truncated.hunks[0].lines.length, 2);
});

test("parseUnifiedPatch strips quoted paths", () => {
  const parsed = parseUnifiedPatch([
    '--- "a/sp ace.txt"',
    '+++ "b/sp ace.txt"',
    "@@ -1 +1 @@",
    "-x",
    "+y",
  ].join("\n"));
  assert.equal(parsed.oldPath, "sp ace.txt");
  assert.equal(parsed.newPath, "sp ace.txt");
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

test("hunkHeaderLabel formats the @@ header", () => {
  assert.equal(
    hunkHeaderLabel({ oldStart: 3, oldLines: 4, newStart: 5, newLines: 6 }),
    "@@ -3,4 +5,6 @@",
  );
  assert.equal(
    hunkHeaderLabel({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, section: "fn main()" }),
    "@@ -1,1 +1,1 @@ fn main()",
  );
});

test("hunkLinesText joins displayed line contents", () => {
  const parsed = parseUnifiedPatch([
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
  ].join("\n"));
  assert.equal(hunkLinesText(parsed.hunks[0]), "keep\nold\nnew");
});

test("languageFromPath maps extensions to shiki languages", () => {
  assert.equal(languageFromPath("src/pages/dashboard.js"), "js");
  assert.equal(languageFromPath("src-tauri/src/main.rs"), "rust");
  assert.equal(languageFromPath("a/b/component.test.TSX"), "tsx");
  assert.equal(languageFromPath("Dockerfile"), "docker");
  assert.equal(languageFromPath("Makefile"), "makefile");
  assert.equal(languageFromPath("notes.unknownext"), "");
  assert.equal(languageFromPath("no-extension"), "");
  assert.equal(languageFromPath(""), "");
});

/* ------------------------------------------------------------------ */
/* normalizeTurnDiffFile (§1 file entries)                              */
/* ------------------------------------------------------------------ */

test("normalizeTurnDiffFile reads snake_case and camelCase aliases", () => {
  const snake = normalizeTurnDiffFile({
    path: "src/a.rs",
    old_path: "src/b.rs",
    kind: "rename",
    additions: 3,
    deletions: 1,
    patch: "--- a/src/b.rs\n+++ b/src/a.rs\n@@ -1 +1 @@\n-x\n+y",
    patch_truncated: true,
  });
  assert.equal(snake.path, "src/a.rs");
  assert.equal(snake.oldPath, "src/b.rs");
  assert.equal(snake.kind, "rename");
  assert.equal(snake.additions, 3);
  assert.equal(snake.deletions, 1);
  assert.equal(snake.patchTruncated, true);
  assert.equal(snake.binary, false);

  const camel = normalizeTurnDiffFile({
    path: "src/a.rs",
    oldPath: "src/b.rs",
    kind: "rename",
    patchTruncated: true,
  });
  assert.equal(camel.oldPath, "src/b.rs");
  assert.equal(camel.patchTruncated, true);
  assert.equal(camel.patch, null);
});

test("normalizeTurnDiffFile handles binary and invalid entries", () => {
  const binary = normalizeTurnDiffFile({ path: "logo.png", kind: "edit", binary: true });
  assert.equal(binary.binary, true);
  assert.equal(binary.patch, null);
  assert.equal(normalizeTurnDiffFile({}), null);
  assert.equal(normalizeTurnDiffFile("plain"), null);
  const unknownKind = normalizeTurnDiffFile({ path: "x", kind: "mystery" });
  assert.equal(unknownKind.kind, "edit");
});
