#!/usr/bin/env node
// Headless tscircuit DRC for AI agents.
//
// Compiles a board source file to Circuit JSON via @tscircuit/eval (no browser)
// and prints a terse JSON summary of design-rule errors/warnings to stdout, so a
// coding agent gets compact feedback without ever reading the verbose Circuit
// JSON. Resolves @tscircuit/eval from this repo's node_modules (the script lives
// under the app tree). Usage: node pcb-drc.mjs <absolute-board-file>
import { readFileSync } from "node:fs";

// tscircuit's solvers log progress to stdout; keep stdout pure JSON for the
// caller by routing all console noise to stderr.
for (const key of ["log", "info", "debug", "warn"]) {
  console[key] = (...args) => {
    try {
      process.stderr.write(args.map(String).join(" ") + "\n");
    } catch {
      /* ignore */
    }
  };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  if (obj?.ok === false) {
    process.exitCode = 1;
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    emit({ ok: false, errorCount: 1, errors: [{ type: "usage_error", message: "no board file given" }], warnings: [] });
    return;
  }

  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (err) {
    emit({ ok: false, errorCount: 1, errors: [{ type: "read_error", message: String(err?.message || err) }], warnings: [] });
    return;
  }

  let CircuitRunner;
  try {
    ({ CircuitRunner } = await import("@tscircuit/eval"));
  } catch (err) {
    emit({ ok: false, errorCount: 1, errors: [{ type: "toolchain_error", message: "tscircuit eval unavailable: " + String(err?.message || err) }], warnings: [] });
    return;
  }

  try {
    const runner = new CircuitRunner();
    await runner.executeWithFsMap({ fsMap: { "main.tsx": source }, mainComponentPath: "main.tsx" });
    await runner.renderUntilSettled();
    const circuitJson = await runner.getCircuitJson();

    const errors = [];
    const warnings = [];
    let componentCount = 0;
    let traceCount = 0;
    for (const el of circuitJson) {
      const type = (el && el.type) || "";
      if (type === "source_component") componentCount += 1;
      else if (type === "source_trace") traceCount += 1;
      if (/_error$/.test(type)) {
        errors.push({ type, message: el.message || el.error || "" });
      } else if (/_warning$/.test(type)) {
        warnings.push({ type, message: el.message || "" });
      }
    }

    emit({
      ok: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      components: componentCount,
      traces: traceCount,
      elementCount: circuitJson.length,
      errors,
      warnings,
    });
  } catch (err) {
    // A throw is a hard compile failure (syntax error, no root component, …).
    emit({
      ok: false,
      errorCount: 1,
      warningCount: 0,
      errors: [{ type: "compile_error", message: String(err?.message || err).split("\n")[0] }],
      warnings: [],
    });
  }
}

main();
