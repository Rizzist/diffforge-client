# Video Agent Guide

Use `video_context` first. Clip ids are stable only until the next edit; re-fetch context after every successful `video_edit`.

## File vs Tools

- Prefer MCP tools for timeline edits, transcript-aware edits, media search/import, visual checks, generation, and export.
- Edit `.video.pipe` directly only for broad mechanical changes you can validate with the file header grammar and `video_context`.
- The pipe DSL header is authoritative for syntax; media assets live under `media/assets/` and generated media under `media/generated/`.
- Use `include:["timeline"]` when you need the pipe, `include:["selection"]` for ranges/playhead/selected clips, `include:["transcripts"]` for transcript readiness, and `include:["jobs"]` for generation jobs.

## removeWords Workflow

1. Call `video_context` with `include:["selection","transcripts"]`.
2. If needed, call `video_transcribe` with `scope:"selection"` or explicit `paths`.
3. Use transcript word indexes/times to call `video_edit` with `op:"removeWords"`, `assetPath`, and `words`.
4. Call `video_look` around the edit boundaries to verify timing.

## moments to addClip

1. Call `video_media` with `action:"search"` and a query.
2. Use `moments[].path` as `assetPath`.
3. Use `momentSourceMs[0]` as `sourceInMs` and the moment span as `durationMs`.
4. Call `video_edit` with `op:"addClip"`, `atMs`, optional `trackHint`, then re-fetch `video_context`.

## Generate

- Call `video_generate` with `action:"models"` and optional `kind`.
- Start with `action:"start"`, `kind`, `model` from the catalog id/jobType, `prompt`, optional `mode`, `inputAssetPaths`, `audioAssetPaths`, and `params`.
- Start uses Diff Forge Cloud (`providerId:"cloud"`) and returns `jobId` plus `plannedPaths`.
- Poll with `video_generate {action:"status", jobId}`; omit `jobId` for active jobs plus recent completed jobs.
- Cancel with `video_generate {action:"cancel", jobId}`.

## Export

- Full export: `video_export {action:"export", projectPath?, resolution?}`. Default resolution is `source`.
- Draft export: `video_export {action:"draft", range:{startMs,endMs}}`. Drafts are forced to 480p and write to `media/exports/draft-<ts>.mp4`.
- Export start returns `jobId`; poll with `video_export {action:"status", jobId}`.

## Id Stability

- Clip ids survive one context/edit exchange.
- After any edit, generated split/add ids can be reparsed; always use returned `changedClipIds` and then re-fetch context.
- Do not cache clip ids across separate agent turns.
