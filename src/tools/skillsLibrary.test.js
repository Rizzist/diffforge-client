import assert from "node:assert/strict";
import test from "node:test";

import {
  accountDocumentHydrateRequestFromSkill,
  accountDocumentRequestFromSkill,
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

test("document save requests mark inline content as intentional", () => {
  const request = accountDocumentRequestFromSkill({
    content: "",
    id: "blank",
    title: "Blank",
  });

  assert.equal(request.document.has_content_payload, true);
  assert.equal(request.document.content_md, "");
});

test("document payload parsing preserves empty local content when projection follows", () => {
  const units = accountDocumentUnitsFromPayload({
    document: {
      content: "",
      content_hash: "empty-hash",
      content_md: "",
      doc_id: "blank",
      has_content_payload: true,
      title: "Blank",
    },
    documents: [{
      content: "",
      content_hash: "empty-hash",
      content_md: "",
      doc_id: "blank",
      has_content_payload: true,
      title: "Blank",
    }],
    projection: {
      documents: [{
        content_hash: "empty-hash",
        doc_id: "blank",
        has_content: true,
        title: "Blank",
      }],
    },
  });
  const skills = skillsFromUnits(units);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "blank");
  assert.equal(skills[0].content, "");
  assert.equal(skills[0].hasContent, true);
  assert.equal(skills[0].hasContentPayload, true);
  assert.equal(skills[0].contentHash, "empty-hash");
});

test("document hydrate requests never include editor content", () => {
  const request = accountDocumentHydrateRequestFromSkill({
    assetId: "asset-blank",
    content: "",
    contentHash: "abc",
    id: "blank",
    localPath: "/tmp/blank.md",
    title: "Blank",
  });

  assert.equal(request.document.asset_id, "asset-blank");
  assert.equal(request.document.content_hash, "abc");
  assert.equal(request.document.local_path, "/tmp/blank.md");
  assert.equal(Object.prototype.hasOwnProperty.call(request.document, "content"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.document, "content_md"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.document, "body"), false);
});

test("skill unit merge removes tombstoned rows", () => {
  const current = skillsFromUnits([
    { doc_id: "review", title: "Review" },
    { doc_id: "ship", title: "Ship" },
  ]);
  const merged = mergeSkillUnits(current, [{ doc_id: "review", deleted: true }]);

  assert.deepEqual(merged.map((skill) => skill.id), ["ship"]);
});

test("backend deleted payloads prune folder descendants from the live document list", () => {
  const current = skillsFromUnits([
    {
      entry_kind: "folder",
      folder_id: "Starter",
      folder_path: "Starter",
      path_key: "Starter",
      title: "Starter",
    },
    {
      content_hash: "hash-basic",
      doc_id: "Basic2",
      file_path: "Starter/Basic2.md",
      parent_path_key: "Starter",
      path_key: "Starter/Basic2.md",
      title: "Basic2",
    },
    {
      content_hash: "hash-sample",
      doc_id: "Sampledraft",
      file_path: "Sampledraft.md",
      path_key: "Sampledraft.md",
      title: "Sampledraft",
    },
  ]);
  const units = accountDocumentUnitsFromPayload({
    kind: "account_documents_apply_result",
    deleted: [{
      current: false,
      deleted: true,
      entry_kind: "folder",
      folder_id: "Starter",
      folder_path: "Starter",
      path_key: "Starter",
      row_type: "folder",
      title: "Starter",
    }],
  });
  const merged = mergeSkillUnits(current, units);

  assert.deepEqual(merged.map((skill) => skill.id), ["Sampledraft"]);
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

test("metadata-only same-hash document updates keep local content materialized", () => {
  const current = skillsFromUnits([{
    content_hash: "same-hash",
    content_md: "",
    doc_id: "blank",
    has_content_payload: true,
    title: "Blank",
  }]);

  const merged = mergeSkillUnits(current, [{
    asset_id: "asset-blank",
    content_hash: "same-hash",
    doc_id: "blank",
    has_content: true,
    title: "Blank",
  }]);

  assert.equal(merged[0].content, "");
  assert.equal(merged[0].contentHash, "same-hash");
  assert.equal(merged[0].contentStale, false);
  assert.equal(merged[0].hasContent, true);
  assert.equal(merged[0].hasContentPayload, true);
});

test("metadata-only document updates preserve pending local saves", () => {
  const current = skillsFromUnits([{
    content_hash: "old-hash",
    content_md: "Unsynced local body.",
    doc_id: "review",
    local_saved_at: "2026-06-20T12:00:00.000Z",
    pending_push: true,
    sync_status: "local_pending",
    title: "Review",
  }]);

  const metadataOnly = mergeSkillUnits(current, [{
    content_hash: "new-hash",
    doc_id: "review",
    has_content: true,
    title: "Review",
  }]);

  assert.equal(metadataOnly[0].content, "Unsynced local body.");
  assert.equal(metadataOnly[0].pendingPush, true);
  assert.equal(metadataOnly[0].syncStatus, "local_pending");
  assert.equal(metadataOnly[0].localSavedAt, "2026-06-20T12:00:00.000Z");

  const synced = mergeSkillUnits(metadataOnly, [{
    content_hash: "new-hash",
    content_md: "Cloud accepted body.",
    doc_id: "review",
    pending_push: false,
    sync_status: "synced",
    title: "Review",
  }]);

  assert.equal(synced[0].content, "Cloud accepted body.");
  assert.equal(synced[0].pendingPush, false);
  assert.equal(synced[0].syncStatus, "synced");
});

test("local save payload projection does not erase materialized document content", () => {
  const units = accountDocumentUnitsFromPayload({
    kind: "account_documents_snapshot",
    payload: {
      kind: "account_document_saved",
      document: {
        content_hash: "empty-hash",
        content_md: "",
        doc_id: "local-draft",
        document_id: "local-draft",
        has_content_payload: true,
        local_saved_at: "2026-06-20T12:00:00.000Z",
        path_key: "local-draft.md",
        pending_push: true,
        sync_status: "local_pending",
        title: "Local Draft",
      },
      documents: [{
        content_hash: "empty-hash",
        content_md: "",
        doc_id: "local-draft",
        document_id: "local-draft",
        has_content_payload: true,
        local_saved_at: "2026-06-20T12:00:00.000Z",
        path_key: "local-draft.md",
        pending_push: true,
        sync_status: "local_pending",
        title: "Local Draft",
      }],
      projection: {
        documents: [{
          content_hash: "empty-hash",
          doc_id: "local-draft",
          document_id: "local-draft",
          local_path: "/tmp/local-draft.md",
          path_key: "local-draft.md",
          pending_push: true,
          sync_status: "local_pending",
          title: "Local Draft",
        }],
      },
    },
  });
  const skills = skillsFromUnits(units);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].content, "");
  assert.equal(skills[0].hasContentPayload, true);
  assert.equal(skills[0].pendingPush, true);
  assert.equal(skills[0].syncStatus, "local_pending");
  assert.equal(skills[0].localPath, "/tmp/local-draft.md");
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
