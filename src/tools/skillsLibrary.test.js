import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSkillUnits,
  skillSlug,
  skillsFromUnits,
  skillsToSkillUnits,
  skillsToToolEntries,
} from "./skillsLibrary.js";

test("skills normalize from unit metadata", () => {
  const skills = skillsFromUnits([{
    asset_id: "asset-review",
    content_md: "Check the diff and tests.",
    local_saved_at: "2026-06-20T12:00:00.000Z",
    pending_push: true,
    sha256: "abc",
    skill_id: "review",
    sync_status: "local_pending",
    title: "Review",
  }]);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "review");
  assert.equal(skills[0].assetId, "asset-review");
  assert.equal(skills[0].content, "Check the diff and tests.");
  assert.equal(skills[0].pendingPush, true);
  assert.equal(skills[0].localSavedAt, "2026-06-20T12:00:00.000Z");
  assert.equal(skills[0].syncStatus, "local_pending");
});

test("skill unit merge removes tombstoned rows", () => {
  const current = skillsFromUnits([
    { skillId: "review", title: "Review" },
    { skillId: "ship", title: "Ship" },
  ]);
  const merged = mergeSkillUnits(current, [{ skill_id: "review", deleted: true }]);

  assert.deepEqual(merged.map((skill) => skill.id), ["ship"]);
});

test("skills serialize to unit sync payloads", () => {
  const units = skillsToSkillUnits([{
    content: "Use `type(scope): summary`.",
    id: "conventional-commits",
    source: "catalog",
    title: "Conventional Commits",
    updatedAt: "2026-06-10T00:00:00.000Z",
  }]);

  assert.equal(units.length, 1);
  assert.equal(units[0].skillId, "conventional-commits");
  assert.equal(units[0].contentMd, "Use `type(scope): summary`.");
  assert.equal(Object.prototype.hasOwnProperty.call(units[0], "description"), false);
});

test("skills expose drag-panel entries", () => {
  const entries = skillsToToolEntries([{ id: "review", title: "Review", content: "Read carefully." }]);
  assert.deepEqual(entries, [{ title: "Review", body: "Read carefully." }]);
});

test("skill slugs dedupe against existing ids", () => {
  const existing = new Set(["My_Skill"]);
  assert.equal(skillSlug("My Skill!", existing), "My_Skill_2");
  assert.equal(skillSlug("", new Set()), "skill");
});
