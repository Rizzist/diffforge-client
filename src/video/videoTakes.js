// Multiple-take detection over a transcript, for the Polish flow: when a
// speaker flubs a line they repeat it, so consecutive transcript segments
// with strongly overlapping (and same-opening) text are grouped as takes of
// one line. The recommended take defaults to the LAST complete attempt —
// people re-record until they're happy — and the user can override per group.

const FILLER_TOKENS = new Set(["um", "uh", "uhm", "erm", "hmm", "mmm", "eh"]);
const MIN_TAKE_TOKENS = 2;
const MAX_TAKE_GAP_MS = 20_000;
const SIMILARITY_THRESHOLD = 0.5;

export function normalizeTakeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !FILLER_TOKENS.has(token));
}

// Similarity tuned for retakes: token containment (a false start is a prefix
// subset of the full take) matters more than symmetric Jaccard, and the two
// attempts must share their opening words — retakes restart from the top.
export function takeSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return 0;
  }
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      shared += 1;
    }
  }
  const jaccard = shared / (setA.size + setB.size - shared);
  const containment = shared / Math.min(setA.size, setB.size);
  const openerA = tokensA.slice(0, 3);
  const openerB = tokensB.slice(0, 3);
  const sharesOpening = openerA.some((token) => openerB.includes(token));
  if (!sharesOpening) {
    return jaccard * 0.5;
  }
  return Math.max(jaccard, containment * 0.9);
}

// segments: [{ startMs, endMs, text }] (transcript order). Returns
// [{ id, takes: [{ segmentIndex, startMs, endMs, text }], recommendedIndex }].
export function detectTakeGroups(segments) {
  const rows = (Array.isArray(segments) ? segments : []).map((segment, segmentIndex) => ({
    segmentIndex,
    startMs: Number(segment.startMs) || 0,
    endMs: Number(segment.endMs) || 0,
    text: String(segment.text || "").trim(),
    tokens: normalizeTakeTokens(segment.text),
  }));
  const groups = [];
  let index = 0;
  while (index < rows.length) {
    const first = rows[index];
    if (first.tokens.length < MIN_TAKE_TOKENS) {
      index += 1;
      continue;
    }
    const takes = [first];
    let cursor = index + 1;
    while (cursor < rows.length) {
      const candidate = rows[cursor];
      const previous = takes[takes.length - 1];
      if (candidate.startMs - previous.endMs > MAX_TAKE_GAP_MS) {
        break;
      }
      if (candidate.tokens.length < MIN_TAKE_TOKENS) {
        break;
      }
      const similarity = Math.max(
        takeSimilarity(previous.tokens, candidate.tokens),
        takeSimilarity(first.tokens, candidate.tokens),
      );
      if (similarity < SIMILARITY_THRESHOLD) {
        break;
      }
      takes.push(candidate);
      cursor += 1;
    }
    if (takes.length >= 2) {
      const maxTokens = Math.max(...takes.map((take) => take.tokens.length));
      let recommendedIndex = takes.length - 1;
      for (let position = takes.length - 1; position >= 0; position -= 1) {
        if (takes[position].tokens.length >= maxTokens * 0.75) {
          recommendedIndex = position;
          break;
        }
      }
      groups.push({
        id: `take-${first.segmentIndex}`,
        takes: takes.map(({ segmentIndex, startMs, endMs, text }) => ({
          segmentIndex,
          startMs,
          endMs,
          text,
        })),
        recommendedIndex,
      });
      index = cursor;
    } else {
      index += 1;
    }
  }
  return groups;
}

// selections: { [groupId]: takeIndex } — takeIndex -1 keeps every take.
// Returns { keepRanges: [{ startMs, endMs }], droppedMs, droppedCount }.
export function buildKeepRanges({ durationMs, groups, selections = {} }) {
  const totalMs = Math.max(0, Number(durationMs) || 0);
  const dropped = [];
  for (const group of groups || []) {
    const selection = selections[group.id];
    const selectedIndex = Number.isInteger(selection) ? selection : group.recommendedIndex;
    if (selectedIndex === -1) {
      continue;
    }
    group.takes.forEach((take, position) => {
      if (position !== selectedIndex) {
        dropped.push({ startMs: take.startMs, endMs: Math.min(take.endMs, totalMs || take.endMs) });
      }
    });
  }
  dropped.sort((a, b) => a.startMs - b.startMs);
  const mergedDropped = [];
  for (const range of dropped) {
    const last = mergedDropped[mergedDropped.length - 1];
    if (last && range.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, range.endMs);
    } else {
      mergedDropped.push({ ...range });
    }
  }
  const keepRanges = [];
  let cursor = 0;
  for (const range of mergedDropped) {
    if (range.startMs > cursor) {
      keepRanges.push({ startMs: cursor, endMs: range.startMs });
    }
    cursor = Math.max(cursor, range.endMs);
  }
  const end = totalMs || cursor;
  if (end > cursor) {
    keepRanges.push({ startMs: cursor, endMs: end });
  }
  const droppedMs = mergedDropped.reduce((sum, range) => sum + (range.endMs - range.startMs), 0);
  return { keepRanges, droppedMs, droppedCount: mergedDropped.length };
}
