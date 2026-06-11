import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSkillsLibrary,
  serializeSkillsLibrary,
  skillSlug,
} from "./skillsLibrary.js";

test("skills library round-trips structured skills through markdown", () => {
  const skills = [
    {
      content: "Use `type(scope): summary`.\n\n- One change per commit.",
      description: "Structured commit messages.",
      icon: "codicon:git-commit",
      id: "conventional-commits",
      source: "catalog",
      title: "Conventional Commits",
      tone: "amber",
      updatedAt: "2026-06-10T00:00:00.000Z",
    },
    {
      content: "My own workflow notes.",
      description: "Personal notes.",
      icon: "",
      id: "my-workflow",
      source: "custom",
      title: "My Workflow",
      tone: "",
      updatedAt: "",
    },
  ];
  const markdown = serializeSkillsLibrary(skills, "# Skills");
  const parsed = parseSkillsLibrary(markdown);

  assert.equal(parsed.preamble, "# Skills");
  assert.equal(parsed.skills.length, 2);
  assert.deepEqual(parsed.skills[0], skills[0]);
  assert.equal(parsed.skills[1].title, "My Workflow");
  assert.equal(parsed.skills[1].source, "custom");
  assert.equal(parsed.skills[1].content, "My own workflow notes.");
});

test("legacy SKILLS.md without sections becomes a single custom skill", () => {
  const parsed = parseSkillsLibrary("# Team playbook\n\nAlways run the linter before pushing.");
  assert.equal(parsed.skills.length, 1);
  assert.equal(parsed.skills[0].title, "Team playbook");
  assert.equal(parsed.skills[0].source, "custom");
  assert.match(parsed.skills[0].content, /linter before pushing/);
});

test("legacy heading sections parse without meta comments", () => {
  const parsed = parseSkillsLibrary("# Skills\n\n## Deploys\nUse the deploy script.\n\n## Reviews\nBe kind.");
  assert.equal(parsed.skills.length, 2);
  assert.equal(parsed.skills[0].id, "deploys");
  assert.equal(parsed.skills[0].description, "Use the deploy script.");
  assert.equal(parsed.skills[1].title, "Reviews");
});

test("skill slugs dedupe against existing ids", () => {
  const existing = new Set(["my-skill"]);
  assert.equal(skillSlug("My Skill!", existing), "my-skill-2");
  assert.equal(skillSlug("", new Set()), "skill");
});
