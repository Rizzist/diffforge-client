import assert from "node:assert/strict";
import test from "node:test";

import {
  accountDocumentUnitsFromPayload,
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
    doc_id: "review",
    local_saved_at: "2026-06-20T12:00:00.000Z",
    pending_push: true,
    sha256: "abc",
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
    { doc_id: "review", title: "Review" },
    { doc_id: "ship", title: "Ship" },
  ]);
  const merged = mergeSkillUnits(current, [{ doc_id: "review", deleted: true }]);

  assert.deepEqual(merged.map((skill) => skill.id), ["ship"]);
});

test("metadata-only document updates preserve cached content until hydration lands", () => {
  const current = skillsFromUnits([{
    content_hash: "old-hash",
    content_md: "Previous content stays visible.",
    doc_id: "review",
    title: "Review",
  }]);

  const metadataOnly = mergeSkillUnits(current, [{
    asset_id: "asset-review",
    content_hash: "new-hash",
    doc_id: "review",
    has_content: true,
    title: "Review",
  }]);

  assert.equal(metadataOnly[0].content, "Previous content stays visible.");
  assert.equal(metadataOnly[0].contentHash, "new-hash");
  assert.equal(metadataOnly[0].contentStale, true);
  assert.equal(metadataOnly[0].hasContent, true);
  assert.equal(metadataOnly[0].hasContentPayload, false);

  const hydrated = mergeSkillUnits(metadataOnly, [{
    content_hash: "new-hash",
    content_md: "Fresh hydrated content.",
    doc_id: "review",
    title: "Review",
  }]);

  assert.equal(hydrated[0].content, "Fresh hydrated content.");
  assert.equal(hydrated[0].contentStale, false);
  assert.equal(hydrated[0].hasContentPayload, true);
});

test("hydrated metadata without inline bytes is not treated as materialized content", () => {
  const units = accountDocumentUnitsFromPayload({
    documents: [{
      asset_id: "asset-review",
      content_hash: "new-hash",
      doc_id: "review",
      hydrated: true,
      title: "Review",
    }],
  });
  const skills = skillsFromUnits(units);

  assert.equal(skills[0].content, "");
  assert.equal(skills[0].hasContent, true);
  assert.equal(skills[0].hasContentPayload, false);
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
  assert.equal(units[0].doc_id, "conventional-commits");
  assert.equal(units[0].content_md, "Use `type(scope): summary`.");
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
