import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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
`;

const InlineRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

// Render the timeline through ffmpeg into media/exports with live progress.
export default function ExportPanel({ ffmpegReady = false, project, projectPath = "", repoPath = "" }) {
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
      if (!payload?.jobId || payload.jobId !== ownJobIdRef.current) {
        return;
      }
      setJob(payload);
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
  }, []);

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
        },
      });
      ownJobIdRef.current = String(result?.jobId || "");
      setJob({ jobId: result?.jobId, state: "starting", percent: 0, done: false });
    } catch (err) {
      setError(String(err));
    }
  }, [crf, durationMs, fileName, format, fps, height, projectPath, repoPath, speedPreset, width]);

  const cancelExport = useCallback(() => {
    if (job?.jobId && !job.done) {
      invoke("video_export_cancel", { jobId: job.jobId }).catch(() => {});
    }
  }, [job]);

  const exporting = Boolean(job && !job.done);

  return (
    <PanelRoot data-video-export="true">
      <VideoHint>
        Timeline: <strong>{formatTimecode(durationMs)}</strong> · renders to <code>media/exports/</code>
      </VideoHint>
      {!ffmpegReady ? (
        <VideoErrorText>ffmpeg is not installed — use the Install chip in the top bar first.</VideoErrorText>
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
      <VideoLabel>
        File name (optional)
        <VideoInput
          onChange={(event) => setFileName(event.target.value)}
          placeholder={`${project?.name || "project"}-export.${format}`}
          value={fileName}
        />
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
              <VideoSecondaryButton onClick={() => revealItemInDir(job.outputPath).catch(() => {})} type="button">
                Show in folder
              </VideoSecondaryButton>
            ) : null}
          </DoneRow>
        )
      ) : null}
    </PanelRoot>
  );
}
