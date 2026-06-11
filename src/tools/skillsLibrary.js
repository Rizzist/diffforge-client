/**
 * The account skill library is stored in the existing cloud-synced SKILLS.md
 * blob (Rust owns the HTTP call, offline cache, and revision conflicts), so
 * no new sync plumbing is needed. Each skill is one `## Title` markdown
 * section with a meta comment carrying the structured fields:
 *
 *   ## Conventional Commits
 *   <!-- diffforge-skill {"id":"conventional-commits","tone":"amber",...} -->
 *   content…
 *
 * Agents and the drag panel keep reading the same markdown; this module just
 * gives the Tools tab a structured view of it.
 */

const SKILL_META_PATTERN = /^<!--\s*diffforge-skill\s+(\{.*\})\s*-->$/u;

export const SKILL_TONES = {
  amber: "#cca700",
  blue: "#3794ff",
  cyan: "#29b8db",
  green: "#3fb950",
  orange: "#ff8c00",
  purple: "#b180d7",
  red: "#f14c4c",
  slate: "#8ea0b8",
};

const TONE_KEYS = Object.keys(SKILL_TONES);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function skillToneColor(tone, seed = "") {
  if (SKILL_TONES[tone]) return SKILL_TONES[tone];
  const source = text(seed, "skill");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return SKILL_TONES[TONE_KEYS[hash % TONE_KEYS.length]];
}

export function skillSlug(title, existingIds = new Set()) {
  const base = text(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "skill";
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function isSkillMetaLine(line) {
  return SKILL_META_PATTERN.test(String(line || "").trim());
}

function parseMetaLine(line) {
  const match = String(line || "").trim().match(SKILL_META_PATTERN);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function firstContentLine(content) {
  return text(
    String(content || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("<!--")),
  ).slice(0, 160);
}

/**
 * Parses the cloud skills markdown into { preamble, skills }. Sections start
 * at `## ` headings; documents without any become a single custom skill so
 * legacy SKILLS.md content survives the migration untouched.
 */
export function parseSkillsLibrary(skillsMd) {
  const source = String(skillsMd || "");
  if (!source.trim()) {
    return { preamble: "", skills: [] };
  }
  const lines = source.split("\n");
  const sections = [];
  let preambleLines = [];
  let current = null;
  lines.forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/u);
    if (heading) {
      if (current) sections.push(current);
      current = { bodyLines: [], title: heading[1].trim() };
      return;
    }
    if (current) {
      current.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  });
  if (current) sections.push(current);

  if (!sections.length) {
    const titleMatch = source.match(/^#\s+(.+)$/mu);
    return {
      preamble: "",
      skills: [{
        content: source.trim(),
        description: firstContentLine(source.replace(/^#\s+.+$/mu, "")),
        icon: "",
        id: "my-skills",
        source: "custom",
        title: text(titleMatch?.[1], "My skills"),
        tone: "",
        updatedAt: "",
      }],
    };
  }

  const seenIds = new Set();
  const skills = sections.map((section) => {
    let meta = null;
    const contentLines = [];
    section.bodyLines.forEach((line) => {
      if (!meta) {
        const parsed = parseMetaLine(line);
        if (parsed) {
          meta = parsed;
          return;
        }
      }
      contentLines.push(line);
    });
    const content = contentLines.join("\n").trim();
    const id = skillSlug(text(meta?.id, section.title), seenIds);
    seenIds.add(id);
    return {
      content,
      description: text(meta?.description, firstContentLine(content)),
      icon: text(meta?.icon),
      id,
      source: text(meta?.source, "custom"),
      title: section.title,
      tone: text(meta?.tone),
      updatedAt: text(meta?.updatedAt),
    };
  });

  return { preamble: preambleLines.join("\n").trim(), skills };
}

export function serializeSkillsLibrary(skills, preamble = "") {
  const safePreamble = text(preamble, "# Skills");
  const sections = (Array.isArray(skills) ? skills : []).map((skill) => {
    const meta = {
      id: text(skill?.id),
      description: text(skill?.description),
      icon: text(skill?.icon),
      source: text(skill?.source, "custom"),
      tone: text(skill?.tone),
      updatedAt: text(skill?.updatedAt),
    };
    return [
      `## ${text(skill?.title, "Untitled skill")}`,
      `<!-- diffforge-skill ${JSON.stringify(meta)} -->`,
      "",
      String(skill?.content || "").trim(),
    ].join("\n").trimEnd();
  });
  return [safePreamble, ...sections].join("\n\n").trim() + "\n";
}
