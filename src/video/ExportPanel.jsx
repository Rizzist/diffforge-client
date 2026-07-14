import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import AppSelect from "../app/AppSelect.jsx";
import { VIDEO_EXPORT_PROGRESS_EVENT } from "./videoPanelBridge.js";
import { formatTimecode, projectDurationMs } from "./videoEditorModel.js";
import {
  VideoErrorText,
  VideoHint,
  VideoInput,
  VideoLabel,
  VideoPaneButton,
  VideoProgressFill,
  VideoProgressTrack,
  VideoSecondaryButton,
} from "./videoStyles.js";

// Last custom export folder, remembered across sessions; empty = default
// media/exports inside the workspace.
const EXPORT_DIR_STORAGE_KEY = "diffforge.video.exportDir";

function readStoredExportDir() {
  try {
    return window.localStorage.getItem(EXPORT_DIR_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function isFfmpegInstallError(value) {
  return /ffmpeg|ffprobe|drawtext|video tools/i.test(String(value || ""));
}

// Hardware H.264 encoding (VideoToolbox / NVENC / QSV / VAAPI) for mp4
// exports; default ON — the backend retries with libx264 automatically.
const HW_ENCODE_STORAGE_KEY = "diffforge.video.hwEncode";

function readStoredHwEncode() {
  try {
    return window.localStorage.getItem(HW_ENCODE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

const SIZE_PRESETS = [
  { id: "project", label: "Project" },
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "720p", label: "720p", width: 1280, height: 720 },
  { id: "vertical", label: "9:16", width: 1080, height: 1920 },
  { id: "square", label: "1:1", width: 1080, height: 1080 },
];

const PanelRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  gap: 8px;
  padding: 10px;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 7px;
`;

const PresetRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const PresetChip = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  background: transparent;
  color: rgba(203, 213, 225, 0.88);
  font-size: 9.5px;
  font-weight: 750;
  padding: 2px 9px;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.55);
    background: rgba(37, 99, 235, 0.18);
    color: #dbeafe;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.16);
    color: #475569;
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(37, 99, 235, 0.45);
    background: rgba(37, 99, 235, 0.12);
    color: #1d4ed8;
  }
`;

const DoneRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 10.5px;
  font-weight: 700;
  color: #a7f3d0;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #047857;
  }
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

const ToggleRow = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 700;
  color: rgba(203, 213, 225, 0.88);
  cursor: pointer;
  user-select: none;

  html[data-forge-theme="light"] & {
    color: #334155;
  }
`;

const ToggleInput = styled.input`
  width: 12px;
  height: 12px;
  margin: 0;
  flex: none;
  accent-color: #10b981;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
  }

  html[data-forge-theme="light"] & {
    accent-color: #047857;
  }
`;

const WarningText = styled.div`
  font-size: 10.5px;
  font-weight: 650;
  color: #fcd34d;
  line-height: 1.4;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #b45309;
  }
`;

// Interchange exporters can drop many features — keep long warning lists
// contained and scrollable instead of stretching the panel.
const WarningsList = styled.div`
  display: grid;
  gap: 3px;
  max-height: 96px;
  overflow-y: auto;
`;

// Render the timeline through ffmpeg into media/exports with live progress.
export default function ExportPanel({
  ffmpegReady = false,
  ffmpegTextSupport = null,
  installBusy = false,
  // Flushes the pane's debounced project autosave. Exports read the saved
  // file, so this must run before any export command.
  onFlushProjectSave = null,
  onFfmpegInstallRequired = null,
  project,
  projectPath = "",
  repoPath = "",
  toolsInstallNonce = 0,
}) {
  const durationMs = useMemo(() => projectDurationMs(project), [project]);
  const [fileName, setFileName] = useState("");
  const [preset, setPreset] = useState("project");
  const [width, setWidth] = useState(project?.settings?.width || 1920);
  const [height, setHeight] = useState(project?.settings?.height || 1080);
  const [fps, setFps] = useState(project?.settings?.fps || 30);
  const [format, setFormat] = useState("mp4");
  const [crf, setCrf] = useState(20);
  const [speedPreset, setSpeedPreset] = useState("medium");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const ownJobIdRef = useRef("");
  const [agentJob, setAgentJob] = useState(null); // exports started by agents (MCP)
  const [outputDir, setOutputDir] = useState(readStoredExportDir);
  const [hwEncode, setHwEncode] = useState(readStoredHwEncode);
  const [interchangeBusy, setInterchangeBusy] = useState(""); // "fcpxml" | "premiere" | ""
  const [interchangeResult, setInterchangeResult] = useState(null); // { path, warnings }
  const [interchangeError, setInterchangeError] = useState("");
  // Hardware-encoder probe: null = unknown (old backend without the command,
  // or probe still in flight) — keep the historical optimistic behavior then.
  const [hwProbe, setHwProbe] = useState(null); // { hardwareAvailable, encoder } | null

  useEffect(() => {
    if (!installBusy && (
      (!ffmpegReady || ffmpegTextSupport === false)
      || isFfmpegInstallError(error)
      || isFfmpegInstallError(job?.error)
    )) {
      onFfmpegInstallRequired?.();
    }
  }, [error, ffmpegReady, ffmpegTextSupport, installBusy, job?.error, onFfmpegInstallRequired]);

  useEffect(() => {
    if (toolsInstallNonce <= 0) {
      return;
    }
    setError((current) => (isFfmpegInstallError(current) ? "" : current));
    setJob((current) => (isFfmpegInstallError(current?.error) ? null : current));
  }, [toolsInstallNonce]);

  useEffect(() => {
    let disposed = false;
    invoke("video_export_encoders")
      .then((result) => {
        if (disposed || !result || typeof result !== "object") {
          return;
        }
        const hardwareAvailable = result.hardwareAvailable ?? result.hardware_available;
        if (typeof hardwareAvailable === "boolean") {
          setHwProbe({ hardwareAvailable, encoder: String(result.encoder || "") });
        }
      })
      .catch(() => {
        // Command not landed yet — hardware availability stays unknown.
      });
    return () => {
      disposed = true;
    };
  }, []);

  const hwUnavailable = hwProbe?.hardwareAvailable === false;

  const applyHwEncode = useCallback((next) => {
    setHwEncode(next);
    try {
      window.localStorage.setItem(HW_ENCODE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, []);

  const applyOutputDir = useCallback((dir) => {
    setOutputDir(dir);
    try {
      if (dir) {
        window.localStorage.setItem(EXPORT_DIR_STORAGE_KEY, dir);
      } else {
        window.localStorage.removeItem(EXPORT_DIR_STORAGE_KEY);
      }
    } catch {
      /* best-effort */
    }
  }, []);

  const chooseOutputDir = useCallback(async () => {
    try {
      const picked = await openFolderDialog({
        directory: true,
        multiple: false,
        title: "Choose export folder",
      });
      if (typeof picked === "string" && picked.trim()) {
        applyOutputDir(picked);
      }
    } catch {
      /* user cancelled or dialog unavailable */
    }
  }, [applyOutputDir]);

  useEffect(() => {
    if (preset === "project") {
      setWidth(project?.settings?.width || 1920);
      setHeight(project?.settings?.height || 1080);
    }
    setFps(project?.settings?.fps || 30);
  }, [preset, project?.settings?.fps, project?.settings?.height, project?.settings?.width]);

  const applyPreset = useCallback((entry) => {
    setPreset(entry.id);
    if (entry.width) {
      setWidth(entry.width);
      setHeight(entry.height);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_EXPORT_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload;
      if (!payload?.jobId) {
        return;
      }
      if (payload.jobId === ownJobIdRef.current) {
        setJob(payload);
        return;
      }
      // Agent/MCP-started exports show as a read-only status row — never
      // adopted as our own job (that caused cross-adoption bugs before).
      // Only for this workspace (payload.repoPath added for MCP exports).
      const payloadRepo = String(payload.repoPath || "").replace(/[\\/]+$/, "");
      const ownRepo = String(repoPath || "").replace(/[\\/]+$/, "");
      if (payloadRepo && ownRepo && payloadRepo !== ownRepo) {
        return;
      }
      setAgentJob(payload);
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [repoPath]);

  // Settled agent-export rows clear themselves after a short beat.
  useEffect(() => {
    if (!agentJob?.done) {
      return undefined;
    }
    const timer = window.setTimeout(() => setAgentJob(null), 12000);
    return () => window.clearTimeout(timer);
  }, [agentJob]);

  const startExport = useCallback(async () => {
    setError("");
    if (!projectPath) {
      setError("Open a project first.");
      return;
    }
    if (durationMs <= 0) {
      setError("The timeline is empty — add clips before exporting.");
      return;
    }
    try {
      // The export renders the SAVED project file — flush the pane's
      // debounced autosave so edits from the last second are included.
      await onFlushProjectSave?.();
      const result = await invoke("video_export_start", {
        repoPath,
        projectPath,
        options: {
          fileName: fileName.trim() || null,
          width: Number(width) || 1920,
          height: Number(height) || 1080,
          fps: Number(fps) || 30,
          format,
          crf: Number(crf) || 20,
          preset: speedPreset,
          outputDir: outputDir || null,
          // mp4-only: the backend probes for a hw encoder and falls back to
          // libx264 automatically; webm always stays libvpx-vp9.
          hardwareEncode: format === "mp4" ? hwEncode && !hwUnavailable : null,
        },
      });
      ownJobIdRef.current = String(result?.jobId || "");
      setJob({ jobId: result?.jobId, state: "starting", percent: 0, done: false });
    } catch (err) {
      setError(String(err));
    }
  }, [crf, durationMs, fileName, format, fps, height, hwEncode, hwUnavailable, onFlushProjectSave, outputDir, projectPath, repoPath, speedPreset, width]);

  const cancelExport = useCallback(() => {
    if (job?.jobId && !job.done) {
      invoke("video_export_cancel", { jobId: job.jobId }).catch(() => {});
    }
  }, [job]);

  // Warnings surfaced by the export job (e.g. hardware-encoder fallback).
  // Defensive: the backend may report either a warnings array or a bare
  // hwFallback flag — normalize both into one list of strings.
  const jobWarnings = useMemo(() => {
    const list = Array.isArray(job?.warnings) ? job.warnings.filter(Boolean).map(String) : [];
    if (job?.hwFallback && list.length === 0) {
      list.push("Hardware encoder failed — fell back to software encoding.");
    }
    return list;
  }, [job]);

  const runInterchange = useCallback(
    async (kind) => {
      setInterchangeError("");
      setInterchangeResult(null);
      if (!projectPath) {
        setInterchangeError("Open a project first.");
        return;
      }
      const baseName = String(project?.name || "project").replace(/[\\/:]+/g, "-").trim() || "project";
      const outName = kind === "fcpxml" ? `${baseName}-fcpxml.fcpxml` : `${baseName}-premiere.xml`;
      // Same convention as video exports: the chosen custom folder when set,
      // otherwise the workspace's media/exports/ (repo-relative).
      const outDir = outputDir ? outputDir.replace(/[\\/]+$/, "") : "media/exports";
      const command = kind === "fcpxml" ? "video_export_fcpxml" : "video_export_premiere_xml";
      setInterchangeBusy(kind);
      try {
        // Interchange exporters read the saved project file too — flush the
        // pane's debounced autosave first.
        await onFlushProjectSave?.();
        const result = await invoke(command, {
          repoPath,
          projectRelPath: projectPath,
          outPath: `${outDir}/${outName}`,
        });
        setInterchangeResult({
          path: String(result?.path || `${outDir}/${outName}`),
          warnings: Array.isArray(result?.warnings) ? result.warnings.filter(Boolean).map(String) : [],
        });
      } catch (err) {
        // Also covers the command not existing yet (backend not landed) —
        // Tauri rejects with a plain string we can show as-is.
        setInterchangeError(String(err));
      } finally {
        setInterchangeBusy("");
      }
    },
    [onFlushProjectSave, outputDir, project?.name, projectPath, repoPath],
  );

  const exporting = Boolean(job && !job.done);

  return (
    <PanelRoot data-video-export="true">
      <VideoHint>
        Timeline: <strong>{formatTimecode(durationMs)}</strong> · renders to{" "}
        <code>{outputDir || "media/exports/"}</code>
      </VideoHint>
      {!installBusy && !ffmpegReady ? (
        <VideoErrorText>ffmpeg is not installed — use the Install chip in the top bar first.</VideoErrorText>
      ) : null}
      {!installBusy && ffmpegReady && ffmpegTextSupport === false ? (
        <VideoErrorText>
          Your ffmpeg build can’t render text or captions (Homebrew’s ffmpeg 8 removed the
          drawtext filter). Use the Install chip in the top bar to get the bundled build —
          exports with text clips will fail until then.
        </VideoErrorText>
      ) : null}
      {agentJob ? (
        <VideoHint>
          {agentJob.done && !agentJob.error
            ? `✨ Agent export finished${agentJob.outputPath ? `: ${agentJob.outputPath}` : ""}`
            : agentJob.error
              ? `✨ Agent export failed: ${agentJob.error}`
              : `✨ Agent export running… ${Math.round(agentJob.percent || 0)}%`}
        </VideoHint>
      ) : null}
      <PresetRow>
        {SIZE_PRESETS.map((entry) => (
          <PresetChip
            data-active={preset === entry.id ? "true" : "false"}
            key={entry.id}
            onClick={() => applyPreset(entry)}
            type="button"
          >
            {entry.label}
          </PresetChip>
        ))}
      </PresetRow>
      <FieldRow>
        <VideoLabel>
          Width
          <VideoInput
            min={16}
            onChange={(event) => {
              setPreset("custom");
              setWidth(event.target.value);
            }}
            type="number"
            value={width}
          />
        </VideoLabel>
        <VideoLabel>
          Height
          <VideoInput
            min={16}
            onChange={(event) => {
              setPreset("custom");
              setHeight(event.target.value);
            }}
            type="number"
            value={height}
          />
        </VideoLabel>
        <VideoLabel>
          FPS
          <VideoInput max={120} min={1} onChange={(event) => setFps(event.target.value)} type="number" value={fps} />
        </VideoLabel>
      </FieldRow>
      <FieldRow>
        <VideoLabel>
          Format
          <AppSelect
            onChange={setFormat}
            options={[
              { value: "mp4", label: "MP4 · H.264" },
              { value: "webm", label: "WebM · VP9" },
            ]}
            value={format}
          />
        </VideoLabel>
        <VideoLabel>
          Quality (CRF)
          <VideoInput max={51} min={0} onChange={(event) => setCrf(event.target.value)} type="number" value={crf} />
        </VideoLabel>
        <VideoLabel>
          Speed
          <AppSelect
            onChange={setSpeedPreset}
            options={["ultrafast", "fast", "medium", "slow", "veryslow"].map((entry) => ({
              value: entry,
              label: entry,
            }))}
            value={speedPreset}
          />
        </VideoLabel>
      </FieldRow>
      {format === "mp4" ? (
        <>
          <ToggleRow style={hwUnavailable ? { cursor: "not-allowed", opacity: 0.65 } : undefined}>
            <ToggleInput
              checked={hwEncode && !hwUnavailable}
              disabled={hwUnavailable}
              onChange={(event) => applyHwEncode(event.target.checked)}
              type="checkbox"
            />
            Hardware encoding
          </ToggleRow>
          <VideoHint>
            {hwUnavailable
              ? "No hardware encoder detected — software x264 will be used"
              : hwProbe?.hardwareAvailable && hwProbe.encoder
                ? `Hardware encoder: ${hwProbe.encoder} — falls back to software automatically if it fails.`
                : "Falls back to software automatically if the encoder fails."}
          </VideoHint>
        </>
      ) : null}
      <VideoLabel>
        File name (optional)
        <VideoInput
          onChange={(event) => setFileName(event.target.value)}
          placeholder={`${project?.name || "project"}-export.${format}`}
          value={fileName}
        />
      </VideoLabel>
      <VideoLabel as="div">
        Save to
        <PresetRow>
          <PresetChip
            data-active={outputDir ? "false" : "true"}
            onClick={() => applyOutputDir("")}
            title="Render into this workspace's media/exports/ folder"
            type="button"
          >
            Default · media/exports
          </PresetChip>
          <PresetChip
            data-active={outputDir ? "true" : "false"}
            onClick={chooseOutputDir}
            title={outputDir ? `Exports render to ${outputDir} — click to change` : "Pick any folder (e.g. Downloads)"}
            type="button"
          >
            {outputDir ? "Custom folder…" : "Choose folder…"}
          </PresetChip>
        </PresetRow>
        {outputDir ? (
          <VideoHint style={{ overflowWrap: "anywhere" }}>→ {outputDir}</VideoHint>
        ) : null}
      </VideoLabel>
      {error ? <VideoErrorText>{error}</VideoErrorText> : null}
      <InlineRow>
        <VideoPaneButton disabled={!ffmpegReady || exporting || !projectPath} onClick={startExport} type="button">
          {exporting ? "Exporting…" : "Export video"}
        </VideoPaneButton>
        {exporting ? (
          <VideoSecondaryButton onClick={cancelExport} type="button">
            Cancel
          </VideoSecondaryButton>
        ) : null}
      </InlineRow>
      {job ? (
        !job.done ? (
          <>
            <VideoProgressTrack>
              <VideoProgressFill style={{ width: `${Math.min(100, Math.max(2, job.percent || 2))}%` }} />
            </VideoProgressTrack>
            <VideoHint>
              {job.state || "rendering"} · {Math.round(job.percent || 0)}%
              {Number.isFinite(Number(job.outTimeMs)) ? ` · ${formatTimecode(job.outTimeMs)}` : ""}
            </VideoHint>
          </>
        ) : job.error ? (
          <VideoErrorText>{job.error}</VideoErrorText>
        ) : (
          <DoneRow>
            ✓ Exported
            {job.outputPath ? (
              <VideoSecondaryButton
                onClick={() => {
                  // outputPath may be repo-relative (shared job registry with
                  // agent/MCP exports) or absolute (legacy) — resolve both.
                  const raw = String(job.outputPath || "");
                  const abs = /^([A-Za-z]:[\\/]|\/)/.test(raw)
                    ? raw
                    : `${String(repoPath || "").replace(/[\\/]+$/, "")}/${raw}`;
                  revealItemInDir(abs).catch(() => {});
                }}
                type="button"
              >
                Show in folder
              </VideoSecondaryButton>
            ) : null}
          </DoneRow>
        )
      ) : null}
      {job && jobWarnings.length ? (
        <WarningsList>
          {jobWarnings.map((warning, index) => (
            <WarningText key={index}>⚠ {warning}</WarningText>
          ))}
        </WarningsList>
      ) : null}
      <VideoLabel as="div">
        Interchange
        <InlineRow>
          <VideoSecondaryButton
            disabled={!projectPath || Boolean(interchangeBusy)}
            onClick={() => runInterchange("fcpxml")}
            type="button"
          >
            {interchangeBusy === "fcpxml" ? "Writing…" : "Final Cut Pro XML"}
          </VideoSecondaryButton>
          <VideoSecondaryButton
            disabled={!projectPath || Boolean(interchangeBusy)}
            onClick={() => runInterchange("premiere")}
            type="button"
          >
            {interchangeBusy === "premiere" ? "Writing…" : "Premiere XML"}
          </VideoSecondaryButton>
        </InlineRow>
        {interchangeError ? (
          <VideoErrorText style={{ textTransform: "none", letterSpacing: "normal" }}>
            {interchangeError}
          </VideoErrorText>
        ) : null}
        {interchangeResult ? (
          <>
            <DoneRow style={{ textTransform: "none", letterSpacing: "normal" }}>
              ✓ Written to <code>{interchangeResult.path}</code>
            </DoneRow>
            {interchangeResult.warnings.length ? (
              <WarningsList>
                {interchangeResult.warnings.map((warning, index) => (
                  <WarningText key={index} style={{ textTransform: "none", letterSpacing: "normal" }}>
                    ⚠ {warning}
                  </WarningText>
                ))}
              </WarningsList>
            ) : null}
          </>
        ) : null}
      </VideoLabel>
    </PanelRoot>
  );
}
