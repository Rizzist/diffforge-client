import { useMemo } from "react";
import styled from "styled-components";

import { C } from "./styles";

const ANSI_BASE_COLORS = [
  "#1f2430", "#ff6b6b", "#5fd68b", "#ffb347",
  "#62a0ff", "#c792ea", "#59d3e0", "#d5dbe8",
];
const ANSI_BRIGHT_COLORS = [
  "#59627a", "#ff8b8b", "#7cf0a8", "#ffd08a",
  "#8ab8ff", "#dcb0ff", "#7fe8f5", "#ffffff",
];

function ansi256Color(index) {
  const value = Number(index);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 8) return ANSI_BASE_COLORS[value];
  if (value < 16) return ANSI_BRIGHT_COLORS[value - 8];
  if (value < 232) {
    const level = value - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(level / 36) % 6];
    const g = steps[Math.floor(level / 6) % 6];
    const b = steps[level % 6];
    return `rgb(${r},${g},${b})`;
  }
  const gray = 8 + (value - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

function applySgr(style, codes) {
  let next = { ...style };
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) { delete next.bold; delete next.dim; }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 29) delete next.strike;
    else if (code === 39) delete next.fg;
    else if (code === 49) delete next.bg;
    else if (code >= 30 && code <= 37) next.fg = ANSI_BASE_COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = ANSI_BRIGHT_COLORS[code - 90];
    else if (code >= 40 && code <= 47) next.bg = ANSI_BASE_COLORS[code - 40];
    else if (code >= 100 && code <= 107) next.bg = ANSI_BRIGHT_COLORS[code - 100];
    else if (code === 38 || code === 48) {
      const target = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5) {
        const color = ansi256Color(codes[i + 2]);
        if (color) next[target] = color;
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if ([r, g, b].every((v) => Number.isFinite(v))) next[target] = `rgb(${r},${g},${b})`;
        i += 4;
      }
    }
  }
  return next;
}

const ANSI_ESC = "\u001b";
const ANSI_BEL = "\u0007";

export function parseAnsiSegments(rawText) {
  const text = String(rawText ?? "");
  const segments = [];
  let style = {};
  let buffer = "";
  const flush = () => {
    if (buffer) segments.push({ text: buffer, style });
    buffer = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === ANSI_ESC) {
      const next = text[i + 1] || "";
      if (next === "[") {
        let j = i + 2;
        while (j < text.length && /[0-9;:?]/.test(text[j])) j += 1;
        const finalByte = text[j] || "";
        if (/[A-Za-z]/.test(finalByte)) {
          if (finalByte === "m") {
            flush();
            const params = text.slice(i + 2, j);
            const codes = params.length
              ? params.split(/[;:]/).map((part) => Number(part || "0"))
              : [0];
            style = applySgr(style, codes);
          }
          i = j;
        } else if (!finalByte) {
          i = text.length;
        } else {
          i = j;
        }
        continue;
      }
      if (next === "]") {
        let j = i + 2;
        while (j < text.length) {
          if (text[j] === ANSI_BEL) break;
          if (text[j] === ANSI_ESC && text[j + 1] === "\\") { j += 1; break; }
          j += 1;
        }
        i = j;
        continue;
      }
      if (next === "(" || next === ")" || next === "#") { i += 2; continue; }
      if (next) { i += 1; continue; }
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] !== "\n") buffer += "\n";
      continue;
    }
    if (char === "\u0000" || char === ANSI_BEL) continue;
    buffer += char;
  }
  flush();
  return segments;
}

export function ansiToPlainText(rawText) {
  return parseAnsiSegments(rawText).map((segment) => segment.text).join("");
}

const AnsiPre = styled.pre`
  margin: 0;
  padding: 0;
  min-width: 0;
  max-width: 100%;
  background: transparent;
  color: ${C.text};
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
`;

export function AnsiText({ text = "", maxChars = 0 }) {
  const segments = useMemo(() => {
    const raw = maxChars > 0 && text.length > maxChars ? text.slice(-maxChars) : text;
    return parseAnsiSegments(raw);
  }, [text, maxChars]);
  return (
    <AnsiPre>
      {segments.map((segment, index) => {
        const style = {};
        if (segment.style.fg) style.color = segment.style.fg;
        if (segment.style.bg) style.backgroundColor = segment.style.bg;
        if (segment.style.bold) style.fontWeight = 700;
        if (segment.style.dim) style.opacity = 0.62;
        if (segment.style.italic) style.fontStyle = "italic";
        const decorations = [
          segment.style.underline ? "underline" : "",
          segment.style.strike ? "line-through" : "",
        ].filter(Boolean).join(" ");
        if (decorations) style.textDecoration = decorations;
        return (
          <span key={index} style={style}>{segment.text}</span>
        );
      })}
    </AnsiPre>
  );
}

const CommandRowShell = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 4px 2px;
  color: ${C.textDim};
  font-size: 11.5px;
`;

const CommandChip = styled.span`
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid ${C.lineBlue};
  background: ${C.blueSoft};
  color: ${C.blueBright};
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 11px;
  overflow-wrap: anywhere;
`;

const CommandRowNote = styled.span`
  color: ${C.textMuted};
  font-size: 10.5px;
`;

export function CommandItemRow({ command = "", note = "", source = "" }) {
  return (
    <CommandRowShell>
      <CommandChip>{command}</CommandChip>
      {note ? <span>{note}</span> : null}
      {source ? <CommandRowNote>from {source}</CommandRowNote> : null}
    </CommandRowShell>
  );
}
