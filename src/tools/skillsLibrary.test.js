import assert from "node:assert/strict";
import test from "node:test";

import {
  accountDocumentHydrateRequestFromSkill,
  accountDocumentRequestFromSkill,
  accountDocumentUnitsFromPayload,
  documentExtensionForKind,
  documentMimeTypeForKind,
  mergeSkillUnits,
  normalizedDocumentKind,
  skillSlug,
  skillsFromUnits,
  skillsToSkillUnits,
  skillsToToolEntries,
} from "./skillsLibrary.js";
import {
  applyWorkspaceToolsDocumentDraftEventPayload,
  clearWorkspaceToolsDocumentDraft,
  getWorkspaceToolsDocumentDraft,
  getWorkspaceToolsDocumentDrafts,
  mergeWorkspaceToolsDocumentDraft,
  setWorkspaceToolsDocumentDraft,
  workspaceToolsDocumentDraftIdentityMatches,
} from "./workspaceToolsStore.js";

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
  assert.equal(skills[0].asset_id, "asset-review");
  assert.equal(skills[0].content, "Check the diff and tests.");
  assert.equal(skills[0].pending_push, true);
  assert.equal(skills[0].local_saved_at, "2026-06-20T12:00:00.000Z");
  assert.equal(skills[0].sync_status, "local_pending");
});

test("legacy instruction document metadata normalizes as document", () => {
  assert.equal(normalizedDocumentKind("instruction"), "document");
  assert.equal(normalizedDocumentKind("", "instructions"), "document");
  assert.equal(normalizedDocumentKind("markdown"), "document");

  const [unit] = skillsFromUnits([{
    content_md: "Legacy instructions",
    doc_id: "legacy_instruction",
    document_kind: "instruction",
    title: "Legacy Instruction",
  }]);

  assert.equal(unit.document_kind, "document");
  assert.equal(unit.source, "document");
});

test("html document metadata preserves html extension and mime type", () => {
  assert.equal(normalizedDocumentKind("html"), "html");
  assert.equal(normalizedDocumentKind("webpage"), "html");
  assert.equal(documentExtensionForKind("html"), "html");
  assert.equal(documentMimeTypeForKind("html"), "text/html");

  const [unit] = skillsFromUnits([{
    content_md: "<!doctype html><title>Preview</title>",
    doc_id: "preview",
    document_kind: "html",
    file_path: "previews/preview.html",
    mime_type: "text/html",
    title: "Preview",
  }]);

  assert.equal(unit.document_kind, "html");
  assert.equal(unit.source, "html");
  assert.equal(unit.extension, "html");
  assert.equal(unit.file_name, "preview.html");
  assert.equal(unit.mime_type, "text/html");

  const request = accountDocumentRequestFromSkill(unit);
  assert.equal(request.document.document_kind, "html");
  assert.equal(request.document.file_name, "preview.html");
  assert.equal(request.document.mime_type, "text/html");

  const extensionOnlyRequest = accountDocumentRequestFromSkill({
    content: "<!doctype html><title>Extension Only</title>",
    document_kind: "document",
    extension: "html",
    id: "extension-only",
    mime_type: "text/markdown",
    title: "Extension Only",
  });
  assert.equal(extensionOnlyRequest.document.document_kind, "html");
  assert.equal(extensionOnlyRequest.document.extension, "html");
  assert.equal(extensionOnlyRequest.document.mime_type, "text/html");
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

test("document save requests can explicitly allow local draft conflicts", () => {
  const defaultRequest = accountDocumentRequestFromSkill({
    content: "Draft",
    draft_path: "/tmp/Draft.md",
    id: "draft",
    title: "Draft",
  }, { local_only: true });
  const conflictRequest = accountDocumentRequestFromSkill({
    content: "Draft",
    draft_path: "/tmp/Draft.md",
    id: "draft",
    title: "Draft",
  }, { allow_conflict: true, local_only: true });

  assert.equal(defaultRequest.allow_conflict, undefined);
  assert.equal(defaultRequest.local_only, true);
  assert.equal(conflictRequest.allow_conflict, true);
  assert.equal(conflictRequest.local_only, true);
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
  assert.equal(skills[0].has_content, true);
  assert.equal(skills[0].has_content_payload, true);
  assert.equal(skills[0].content_hash, "empty-hash");
});

test("document hydrate requests never include editor content", () => {
  const request = accountDocumentHydrateRequestFromSkill({
    asset_id: "asset-blank",
    content: "",
    content_hash: "abc",
    id: "blank",
    local_path: "/tmp/blank.md",
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
  assert.equal(metadataOnly[0].content_hash, "new-hash");
  assert.equal(metadataOnly[0].content_stale, true);
  assert.equal(metadataOnly[0].has_content, true);
  assert.equal(metadataOnly[0].has_content_payload, false);

  const hydrated = mergeSkillUnits(metadataOnly, [{
    content_hash: "new-hash",
    content_md: "Fresh hydrated content.",
    doc_id: "review",
    title: "Review",
  }]);

  assert.equal(hydrated[0].content, "Fresh hydrated content.");
  assert.equal(hydrated[0].content_stale, false);
  assert.equal(hydrated[0].has_content_payload, true);
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
  assert.equal(merged[0].content_hash, "same-hash");
  assert.equal(merged[0].content_stale, false);
  assert.equal(merged[0].has_content, true);
  assert.equal(merged[0].has_content_payload, true);
});

test("workspace tools store tracks multiple account document drafts", () => {
  clearWorkspaceToolsDocumentDraft();
  try {
    setWorkspaceToolsDocumentDraft({
      content: "Feature draft",
      document_key: "Features.md",
      draft_path: "/tmp/drafts/draft-features/Features.md",
      path_key: "Features.md",
      title: "Features",
    });
    setWorkspaceToolsDocumentDraft({
      content: "Blog draft",
      document_key: "Blogs.md",
      draft_path: "/tmp/drafts/draft-blogs/Blogs.md",
      path_key: "Blogs.md",
      title: "Blogs",
    });

    const drafts = getWorkspaceToolsDocumentDrafts();
    assert.equal(drafts.length, 2);
    assert.deepEqual(drafts.map((draft) => draft.title).sort(), ["Blogs", "Features"]);
    assert.equal(getWorkspaceToolsDocumentDraft().title, "Blogs");

    clearWorkspaceToolsDocumentDraft("Features.md");
    const remaining = getWorkspaceToolsDocumentDrafts();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].title, "Blogs");
  } finally {
    clearWorkspaceToolsDocumentDraft();
  }
});

test("draft watcher payloads create visible drafts without an active editor draft", () => {
  clearWorkspaceToolsDocumentDraft();
  try {
    const applied = applyWorkspaceToolsDocumentDraftEventPayload({
      kind: "account_document_draft_updated",
      draft_path: "/tmp/drafts/draft-rust/RustClientFeatures.md",
      draft_id: "draft-rust",
      document: {
        content_md: "Agent wrote this live.",
        doc_id: "RustClientFeatures",
        draft: true,
        draft_id: "draft-rust",
        draft_path: "/tmp/drafts/draft-rust/RustClientFeatures.md",
        file_path: "RustClientFeatures.md",
        is_draft: true,
        path_key: "RustClientFeatures.md",
        sync_status: "draft",
        title: "RustClientFeatures",
      },
    });

    assert.equal(applied, true);
    const drafts = getWorkspaceToolsDocumentDrafts();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].title, "RustClientFeatures");
    assert.equal(drafts[0].content, "Agent wrote this live.");
  } finally {
    clearWorkspaceToolsDocumentDraft();
  }
});

test("draft titles normalize file-name fallbacks without markdown extensions", () => {
  clearWorkspaceToolsDocumentDraft();
  try {
    setWorkspaceToolsDocumentDraft({
      content: "Title should not flicker.",
      document_key: "draft:Docs/Rustfeatures.md",
      file_path: "Docs/Rustfeatures.md",
      id: "Docs/Rustfeatures.md",
      path_key: "Docs/Rustfeatures.md",
    });

    const draft = getWorkspaceToolsDocumentDraft();
    assert.equal(draft.title, "Rustfeatures");
  } finally {
    clearWorkspaceToolsDocumentDraft();
  }
});

test("draft discard events clear drafts stored under a different identity key", () => {
  clearWorkspaceToolsDocumentDraft();
  try {
    setWorkspaceToolsDocumentDraft({
      content: "Published content.",
      document_key: "draft:Rustfeatures.md",
      draft_id: "draft-rust",
      draft_path: "/tmp/drafts/draft-rust/Rustfeatures.md",
      path_key: "Rustfeatures.md",
      title: "Rustfeatures",
    });

    const applied = applyWorkspaceToolsDocumentDraftEventPayload({
      deleted: true,
      discarded: true,
      draft_id: "draft-rust",
      draft_path: "/tmp/drafts/draft-rust/Rustfeatures.md",
      event_kind: "doc.draft.discarded",
      file_path: "Rustfeatures.md",
      kind: "account_document_draft_discarded",
      path_key: "Rustfeatures.md",
    });

    assert.equal(applied, true);
    assert.equal(getWorkspaceToolsDocumentDrafts().length, 0);
  } finally {
    clearWorkspaceToolsDocumentDraft();
  }
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
  assert.equal(metadataOnly[0].pending_push, true);
  assert.equal(metadataOnly[0].sync_status, "local_pending");
  assert.equal(metadataOnly[0].local_saved_at, "2026-06-20T12:00:00.000Z");

  const synced = mergeSkillUnits(metadataOnly, [{
    content_hash: "new-hash",
    content_md: "Cloud accepted body.",
    doc_id: "review",
    pending_push: false,
    sync_status: "synced",
    title: "Review",
  }]);

  assert.equal(synced[0].content, "Cloud accepted body.");
  assert.equal(synced[0].pending_push, false);
  assert.equal(synced[0].sync_status, "synced");
});

test("metadata-only document draft updates preserve matching draft content", () => {
  const current = mergeWorkspaceToolsDocumentDraft(null, {
    content: "Unsaved editor body.",
    document_key: "draft:Docs/Review.md",
    draft_id: "draft-review",
    draft_path: "/tmp/drafts/draft-review/Review.md",
    path_key: "Docs/Review.md",
    title: "Review",
  });

  const metadataOnly = mergeWorkspaceToolsDocumentDraft(current, {
    base_content_hash: "fresh-base",
    content_hash: "fresh-draft-hash",
    document_key: "Docs/Review.md",
    draft_id: "draft-review",
    draft_path: "/tmp/drafts/draft-review/Review.md",
    path_key: "Docs/Review.md",
    title: "Review renamed",
  });

  assert.equal(metadataOnly.content, "Unsaved editor body.");
  assert.equal(metadataOnly.title, "Review renamed");
  assert.equal(metadataOnly.base_content_hash, "fresh-base");
  assert.equal(workspaceToolsDocumentDraftIdentityMatches(current, metadataOnly), true);

  const hydratedEmpty = mergeWorkspaceToolsDocumentDraft(metadataOnly, {
    content_md: "",
    document_key: "draft:Docs/Review.md",
    draft_id: "draft-review",
    draft_path: "/tmp/drafts/draft-review/Review.md",
    title: "Review renamed",
  });

  assert.equal(hydratedEmpty.content, "");
});

test("document draft events do not overwrite active drafts but track nonmatching drafts", () => {
  clearWorkspaceToolsDocumentDraft();
  try {
    setWorkspaceToolsDocumentDraft({
      content: "Keep this active draft.",
      document_key: "draft:Docs/Active.md",
      draft_id: "draft-active",
      draft_path: "/tmp/drafts/draft-active/Active.md",
      path_key: "Docs/Active.md",
      title: "Active",
    });

    assert.equal(applyWorkspaceToolsDocumentDraftEventPayload({
      document: {
        content_md: "Other draft body.",
        document_key: "draft:Docs/Other.md",
        draft_id: "draft-other",
        draft_path: "/tmp/drafts/draft-other/Other.md",
        title: "Other",
      },
    }), true);
    assert.equal(getWorkspaceToolsDocumentDraft().content, "Keep this active draft.");
    assert.equal(getWorkspaceToolsDocumentDrafts().length, 2);

    assert.equal(applyWorkspaceToolsDocumentDraftEventPayload({
      kind: "account_document_draft_prepared",
      document: {
        base_content_hash: "new-base",
        path_key: "Docs/Active.md",
        draft_id: "draft-active",
        draft_path: "/tmp/drafts/draft-active/Active.md",
        title: "Active updated",
      },
    }), true);

    const active = getWorkspaceToolsDocumentDraft();
    assert.equal(active.content, "Keep this active draft.");
    assert.equal(active.title, "Active updated");
    assert.equal(active.base_content_hash, "new-base");
  } finally {
    clearWorkspaceToolsDocumentDraft();
  }
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
  assert.equal(skills[0].has_content_payload, true);
  assert.equal(skills[0].pending_push, true);
  assert.equal(skills[0].sync_status, "local_pending");
  assert.equal(skills[0].local_path, "/tmp/local-draft.md");
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
  assert.equal(skills[0].has_content, true);
  assert.equal(skills[0].has_content_payload, false);
});

test("skills serialize to unit sync payloads", () => {
  const units = skillsToSkillUnits([{
    content: "Use `type(scope): summary`.",
    id: "conventional-commits",
    source: "catalog",
    title: "Conventional Commits",
    updated_at: "2026-06-10T00:00:00.000Z",
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
