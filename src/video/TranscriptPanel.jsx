import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { VIDEO_TRANSCRIBE_PROGRESS_EVENT } from "./videoPanelBridge.js";
import { formatTimecode } from "./videoEditorModel.js";
import {
  VideoDangerButton,
  VideoErrorText,
  VideoHint,
  VideoPaneButton,
  VideoProgressFill,
  VideoProgressTrack,
  VideoSecondaryButton,
} from "./videoStyles.js";

const PanelRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
`;

const HeaderBlock = styled.div`
  display: grid;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  flex: 0 0 auto;
`;

const AssetName = styled.div`
  font-size: 11.5px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
`;

const ModeChip = styled.button`
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(148, 163, 184, 0.88);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(37, 99, 235, 0.18);
    color: #dbeafe;
  }
`;

const SegmentList = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 5px;
  padding: 8px 10px;
  align-content: start;
`;

// HappySRT-style numbered segment row: index + editable timecodes on the
// left, editable text on the right, hover actions.
const SegmentRow = styled.div`
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(6, 10, 17, 0.72);
  position: relative;

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.5);
  }

  &:hover {
    border-color: rgba(148, 163, 184, 0.3);
  }
`;

const SegmentMeta = styled.div`
  display: grid;
  gap: 2px;
  align-content: start;
`;

const SegmentIndex = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  font-size: 9px;
  font-weight: 850;
  color: #7d8ca3;
  cursor: pointer;

  &:hover {
    color: #a7f3d0;
  }
`;

const TimeField = styled.input`
  width: 100%;
  min-height: 18px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #93c5fd;
  font-size: 9px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  outline: 0;

  &:hover,
  &:focus {
    border-color: rgba(148, 163, 184, 0.3);
    background: rgba(2, 6, 12, 0.8);
  }
`;

// Auto-grows to fit its content (JS-sized) — a caption row must show ALL of
// its text at a glance, never hide it behind an inner scroll.
const SegmentText = styled.textarea`
  width: 100%;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: rgba(226, 232, 240, 0.94);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.45;
  resize: none;
  outline: 0;
  padding: 3px 5px;
  overflow: hidden;

  &:hover,
  &:focus {
    border-color: rgba(148, 163, 184, 0.3);
    background: rgba(2, 6, 12, 0.8);
  }
`;

function autosizeTextarea(element) {
  if (element) {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }
}

// Client-side progress ceilings per phase: local extraction owns 0-33%, the
// upload 33-62%, the cloud round-trip 62-94% — the bar keeps crawling toward
// the ceiling while a phase runs so long waits still read as alive.
const PHASE_CEILING = { starting: 12, extracting: 33, uploading: 62, transcribing: 94 };

const RowActions = styled.div`
  position: absolute;
  top: -8px;
  right: 6px;
  display: none;
  gap: 2px;
  z-index: 2;

  ${SegmentRow}:hover & {
    display: inline-flex;
  }
`;

const RowActionButton = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 5px;
  background: rgba(7, 12, 22, 0.96);
  color: rgba(203, 213, 225, 0.9);
  font-size: 8.5px;
  font-weight: 800;
  padding: 1px 6px;
  cursor: pointer;

  &:hover {
    border-color: rgba(16, 185, 129, 0.5);
    color: #a7f3d0;
  }

  &[data-danger="true"]:hover {
    border-color: rgba(248, 113, 113, 0.6);
    color: #fca5a5;
  }
`;

const WordFlow = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  line-height: 2;
`;

const WordChip = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(226, 232, 240, 0.9);
  font-size: 11.5px;
  font-weight: 600;
  padding: 1px 3px;
  margin: 0 1px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
  }

  &[data-struck="true"] {
    text-decoration: line-through;
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.25);
  }
`;

const FooterBar = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
  flex: 0 0 auto;
`;

const EmptyState = styled.div`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
`;

function parseTimecode(text) {
  // Accept "m:ss", "m:ss.mmm", "h:mm:ss.mmm", or raw ms.
  const clean = String(text || "").trim();
  if (/^\d+$/.test(clean)) {
    return Number(clean);
  }
  const match = clean.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function segmentsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// HappySRT-inspired transcript editor for one media asset: numbered segment
// rows with editable timecodes/text (add/delete/merge), a word view where
// striking words removes them FROM THE CUT (ripple), captions generation,
// and SRT/VTT export. Edits persist through video_transcript_update; the
// transcript describes the SOURCE media, so text edits never touch the
// timeline and cut edits never touch the transcript.
export default function TranscriptPanel({
  asset,
  onGenerateCaptions,
  onRemoveWordsFromCut,
  onSeekSource,
  repoPath = "",
}) {
  const [transcript, setTranscript] = useState(null); // { language, segments }
  const [savedSegments, setSavedSegments] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("segments"); // segments | words
  const [struckWords, setStruckWords] = useState([]); // [{segIndex, wordIndex}]
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [crawlPercent, setCrawlPercent] = useState(0);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const segmentListRef = useRef(null);

  // Two-step delete: first click arms for 3s, second click deletes.
  useEffect(() => {
    if (!deleteArmed) {
      return undefined;
    }
    const timer = window.setTimeout(() => setDeleteArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [deleteArmed]);

  const deleteTranscript = useCallback(() => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    if (!repoPath || !asset?.path) {
      return;
    }
    invoke("video_transcript_delete", { repoPath, path: asset.path })
      .then(() => {
        setTranscript(null);
        setSavedSegments(null);
        setStruckWords([]);
        setMode("segments");
        setError("");
      })
      .catch((err) => setError(String(err)));
  }, [asset?.path, deleteArmed, repoPath]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [savedNote, setSavedNote] = useState("");
  const assetPathRef = useRef("");
  assetPathRef.current = asset?.path || "";

  const loadTranscript = useCallback(() => {
    if (!repoPath || !asset?.path) {
      return;
    }
    setLoading(true);
    invoke("video_transcript_get", { repoPath, path: asset.path })
      .then((result) => {
        if (assetPathRef.current !== asset.path) {
          return;
        }
        if (result?.available) {
          const segments = (Array.isArray(result.segments) ? result.segments : []).map((segment) => ({
            startMs: Number(segment.startMs) || 0,
            endMs: Number(segment.endMs) || 0,
            text: String(segment.text || ""),
            words: Array.isArray(segment.words)
              ? segment.words.map((word) => ({
                  startMs: Number(word.startMs) || 0,
                  endMs: Number(word.endMs) || 0,
                  text: String(word.text || ""),
                }))
              : [],
          }));
          setTranscript({ language: String(result.language || ""), segments });
          setSavedSegments(JSON.parse(JSON.stringify(segments)));
        } else {
          setTranscript(null);
          setSavedSegments(null);
        }
        setError("");
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [asset?.path, repoPath]);

  useEffect(() => {
    // Clear synchronously so a Save clicked mid-load can never write the
    // previous asset's segments to this asset's transcript.
    setTranscript(null);
    setSavedSegments(null);
    setStruckWords([]);
    setMode("segments");
    setError("");
    loadTranscript();
  }, [loadTranscript]);

  // Live transcribe progress for this asset.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_TRANSCRIBE_PROGRESS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (String(payload.path || "") !== assetPathRef.current) {
        return;
      }
      setProgress(payload);
      if (payload.done || payload.error) {
        setTranscribing(false);
        if (!payload.error) {
          loadTranscript();
        } else {
          setError(String(payload.error));
        }
      } else {
        setTranscribing(true);
      }
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
  }, [loadTranscript]);

  const startTranscribe = useCallback(() => {
    if (!repoPath || !asset?.path || transcribing) {
      return;
    }
    setTranscribing(true);
    setProgress({ state: "starting" });
    setError("");
    // force bypasses the cache so Re-transcribe actually re-transcribes.
    invoke("video_transcribe_start", { repoPath, path: asset.path, force: Boolean(transcript) }).catch((err) => {
      setTranscribing(false);
      setError(String(err));
    });
  }, [asset?.path, repoPath, transcribing, transcript]);

  // Crawl the bar toward the current phase's ceiling while waiting.
  useEffect(() => {
    if (!transcribing) {
      setCrawlPercent(0);
      return undefined;
    }
    const base = Number(progress?.percent) || 0;
    setCrawlPercent((current) => Math.max(current, base));
    const ceiling = PHASE_CEILING[progress?.state] ?? 94;
    const timer = window.setInterval(() => {
      setCrawlPercent((current) => Math.min(ceiling, Math.max(current, base) + 0.6));
    }, 350);
    return () => window.clearInterval(timer);
  }, [progress?.percent, progress?.state, transcribing]);

  const displayedPercent = Math.max(Number(progress?.percent) || 0, crawlPercent);

  // Size every segment textarea to its content whenever the list changes.
  useEffect(() => {
    if (mode !== "segments") {
      return;
    }
    window.requestAnimationFrame(() => {
      segmentListRef.current
        ?.querySelectorAll?.("textarea")
        ?.forEach?.((element) => autosizeTextarea(element));
    });
  }, [mode, transcript]);

  const dirty = useMemo(
    () => transcript && savedSegments && !segmentsEqual(transcript.segments, savedSegments),
    [savedSegments, transcript],
  );

  const updateSegment = useCallback((index, patch) => {
    setTranscript((current) => {
      if (!current) {
        return current;
      }
      const segments = current.segments.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, ...patch } : segment,
      );
      return { ...current, segments };
    });
  }, []);

  // Structural edits invalidate word-strike indexes — clear them.
  const deleteSegment = useCallback((index) => {
    setStruckWords([]);
    setTranscript((current) =>
      current ? { ...current, segments: current.segments.filter((_, i) => i !== index) } : current,
    );
  }, []);

  const addSegmentBelow = useCallback((index) => {
    setStruckWords([]);
    setTranscript((current) => {
      if (!current) {
        return current;
      }
      const anchor = current.segments[index];
      const next = current.segments[index + 1];
      const startMs = anchor ? anchor.endMs : 0;
      const endMs = next ? Math.max(startMs + 500, Math.min(next.startMs, startMs + 2000)) : startMs + 2000;
      const segments = [...current.segments];
      segments.splice(index + 1, 0, { startMs, endMs, text: "", words: [] });
      return { ...current, segments };
    });
  }, []);

  const mergeWithNext = useCallback((index) => {
    setStruckWords([]);
    setTranscript((current) => {
      if (!current || index >= current.segments.length - 1) {
        return current;
      }
      const segments = [...current.segments];
      const a = segments[index];
      const b = segments[index + 1];
      segments.splice(index, 2, {
        startMs: a.startMs,
        endMs: b.endMs,
        text: `${a.text} ${b.text}`.trim(),
        words: [...(a.words || []), ...(b.words || [])],
      });
      return { ...current, segments };
    });
  }, []);

  const saveTranscript = useCallback(() => {
    if (!repoPath || !asset?.path || !transcript) {
      return;
    }
    invoke("video_transcript_update", {
      repoPath,
      path: asset.path,
      transcript: { language: transcript.language, segments: transcript.segments },
    })
      .then(() => {
        setSavedSegments(JSON.parse(JSON.stringify(transcript.segments)));
        setSavedNote("Saved");
        window.setTimeout(() => setSavedNote(""), 1600);
      })
      .catch((err) => setError(String(err)));
  }, [asset?.path, repoPath, transcript]);

  const resetTranscript = useCallback(() => {
    if (savedSegments) {
      setTranscript((current) =>
        current ? { ...current, segments: JSON.parse(JSON.stringify(savedSegments)) } : current,
      );
    }
  }, [savedSegments]);

  // Export is instant: write the file and show WHERE it went inline — the
  // old auto-reveal spawned a Finder activation on every click, which is
  // what froze the machine for a beat. Revealing is now opt-in.
  const [exportedFile, setExportedFile] = useState(null); // { outputPath, name }
  const exportAs = useCallback(
    (format) => {
      if (!repoPath || !asset?.path) {
        return;
      }
      invoke("video_transcript_export", { repoPath, path: asset.path, format })
        .then((result) => {
          const outputPath = String(result?.outputPath || "");
          if (outputPath) {
            const segments = outputPath.split(/[\\/]/);
            setExportedFile({ outputPath, name: segments[segments.length - 1] || outputPath });
          }
        })
        .catch((err) => setError(String(err)));
    },
    [asset?.path, repoPath],
  );

  useEffect(() => {
    setExportedFile(null);
  }, [asset?.path]);

  const toggleWord = useCallback((segIndex, wordIndex) => {
    setStruckWords((current) => {
      const exists = current.some((entry) => entry.segIndex === segIndex && entry.wordIndex === wordIndex);
      return exists
        ? current.filter((entry) => !(entry.segIndex === segIndex && entry.wordIndex === wordIndex))
        : [...current, { segIndex, wordIndex }];
    });
  }, []);

  const removeStruckFromCut = useCallback(() => {
    if (!struckWords.length || !transcript) {
      return;
    }
    const words = struckWords
      .map(({ segIndex, wordIndex }) => transcript.segments[segIndex]?.words?.[wordIndex])
      .filter(Boolean);
    onRemoveWordsFromCut?.(asset, words);
    setStruckWords([]);
  }, [asset, onRemoveWordsFromCut, struckWords, transcript]);

  const hasWords = useMemo(
    () => Boolean(transcript?.segments?.some((segment) => segment.words?.length)),
    [transcript],
  );

  if (!asset) {
    return (
      <PanelRoot>
        <EmptyState>
          <VideoHint>Select a media item in the Library to open its transcript.</VideoHint>
        </EmptyState>
      </PanelRoot>
    );
  }

  return (
    <PanelRoot data-video-transcript="true">
      <HeaderBlock>
        <AssetName title={asset.name}>{asset.name}</AssetName>
        <ActionRow>
          <VideoPaneButton disabled={transcribing || !repoPath} onClick={startTranscribe} type="button">
            {transcribing ? "Transcribing…" : transcript ? "Re-transcribe" : "Transcribe"}
          </VideoPaneButton>
          {transcript ? (
            <>
              <VideoSecondaryButton
                onClick={() => {
                  try {
                    navigator.clipboard?.writeText(
                      transcript.segments.map((segment) => segment.text).join("\n"),
                    );
                  } catch {
                    /* clipboard denied */
                  }
                }}
                type="button"
              >
                Copy
              </VideoSecondaryButton>
              <VideoDangerButton
                onClick={deleteTranscript}
                title="Remove this media's transcript entirely (the media file is untouched)"
                type="button"
              >
                {deleteArmed ? "Really delete?" : "Delete"}
              </VideoDangerButton>
            </>
          ) : null}
        </ActionRow>
        {transcript ? (
          <ActionRow>
            <ModeChip data-active={mode === "segments" ? "true" : "false"} onClick={() => setMode("segments")} type="button">
              Segments
            </ModeChip>
            <ModeChip
              data-active={mode === "words" ? "true" : "false"}
              disabled={!hasWords}
              onClick={() => hasWords && setMode("words")}
              title={hasWords ? "Strike words to cut them from the timeline" : "Re-transcribe to get word timings"}
              type="button"
            >
              Words
            </ModeChip>
            <span style={{ flex: 1 }} />
            {savedNote ? <VideoHint>{savedNote}</VideoHint> : null}
            {dirty ? (
              <>
                <VideoPaneButton onClick={saveTranscript} type="button">
                  Save
                </VideoPaneButton>
                <VideoSecondaryButton onClick={resetTranscript} type="button">
                  Reset
                </VideoSecondaryButton>
              </>
            ) : null}
          </ActionRow>
        ) : null}
        {transcribing && progress ? (
          <div style={{ display: "grid", gap: 3 }}>
            <VideoProgressTrack>
              <VideoProgressFill style={{ width: `${Math.min(100, Math.max(5, displayedPercent))}%` }} />
            </VideoProgressTrack>
            <VideoHint>
              {Math.round(displayedPercent)}% ·{" "}
              {progress.state === "extracting" || progress.state === "starting"
                ? "extracting audio locally (ffmpeg → compact MP3)"
                : progress.state === "uploading"
                  ? "sending to your cloud over the app websocket"
                  : "transcribing on the server (Whisper via Deepgram, billed by MB)"}
            </VideoHint>
          </div>
        ) : null}
        {error ? <VideoErrorText>{error}</VideoErrorText> : null}
      </HeaderBlock>
      {!transcript && !transcribing ? (
        <EmptyState>
          <VideoHint>
            No transcript yet. Transcription extracts the audio locally (ffmpeg → compact MP3), sends
            it to your Diff Forge cloud, and returns timestamped segments — then you can edit it here,
            caption clips with it, and cut filler words straight out of the timeline.
          </VideoHint>
        </EmptyState>
      ) : null}
      {transcript && mode === "segments" ? (
        <SegmentList ref={segmentListRef}>
          {transcript.segments.map((segment, index) => (
            <SegmentRow data-active={activeIndex === index ? "true" : "false"} key={index}>
              <RowActions>
                <RowActionButton onClick={() => addSegmentBelow(index)} title="Add segment below" type="button">
                  + Add
                </RowActionButton>
                {index < transcript.segments.length - 1 ? (
                  <RowActionButton onClick={() => mergeWithNext(index)} title="Merge with next" type="button">
                    Merge
                  </RowActionButton>
                ) : null}
                <RowActionButton data-danger="true" onClick={() => deleteSegment(index)} title="Delete segment" type="button">
                  Delete
                </RowActionButton>
              </RowActions>
              <SegmentMeta>
                <SegmentIndex
                  onClick={() => {
                    setActiveIndex(index);
                    onSeekSource?.(asset, segment.startMs);
                  }}
                  title="Jump the preview here"
                  type="button"
                >
                  {String(index + 1).padStart(3, "0")} ▸
                </SegmentIndex>
                <TimeField
                  defaultValue={formatTimecode(segment.startMs, { withMs: true })}
                  key={`s-${index}-${segment.startMs}`}
                  onBlur={(event) => {
                    const ms = parseTimecode(event.target.value);
                    if (ms != null) {
                      updateSegment(index, { startMs: ms });
                    }
                  }}
                />
                <TimeField
                  defaultValue={formatTimecode(segment.endMs, { withMs: true })}
                  key={`e-${index}-${segment.endMs}`}
                  onBlur={(event) => {
                    const ms = parseTimecode(event.target.value);
                    if (ms != null) {
                      updateSegment(index, { endMs: ms });
                    }
                  }}
                />
              </SegmentMeta>
              <SegmentText
                onChange={(event) => {
                  autosizeTextarea(event.target);
                  updateSegment(index, { text: event.target.value });
                }}
                onFocus={() => setActiveIndex(index)}
                ref={autosizeTextarea}
                value={segment.text}
              />
            </SegmentRow>
          ))}
          {!transcript.segments.length ? <VideoHint>Empty transcript.</VideoHint> : null}
        </SegmentList>
      ) : null}
      {transcript && mode === "words" ? (
        <WordFlow>
          <VideoHint style={{ marginBottom: 8 }}>
            Strike the words you want gone — then remove them from the cut. The video ripples closed;
            the transcript itself stays intact.
          </VideoHint>
          {transcript.segments.map((segment, segIndex) => (
            <span key={segIndex}>
              {(segment.words || []).map((word, wordIndex) => (
                <WordChip
                  data-struck={
                    struckWords.some((entry) => entry.segIndex === segIndex && entry.wordIndex === wordIndex)
                      ? "true"
                      : "false"
                  }
                  key={`${segIndex}-${wordIndex}`}
                  onClick={() => toggleWord(segIndex, wordIndex)}
                  type="button"
                >
                  {word.text}
                </WordChip>
              ))}{" "}
            </span>
          ))}
        </WordFlow>
      ) : null}
      {transcript ? (
        <FooterBar>
          <VideoPaneButton
            onClick={() => onGenerateCaptions?.(asset, transcript.segments)}
            title="Create styled caption clips on a Captions track for the timeline clips using this media"
            type="button"
          >
            Generate captions
          </VideoPaneButton>
          <VideoSecondaryButton onClick={() => exportAs("srt")} title="Save as .srt into media/exports" type="button">
            SRT
          </VideoSecondaryButton>
          <VideoSecondaryButton onClick={() => exportAs("vtt")} title="Save as .vtt into media/exports" type="button">
            VTT
          </VideoSecondaryButton>
          {exportedFile ? (
            <VideoHint style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              ✓ {exportedFile.name}
              <button
                onClick={() => revealItemInDir(exportedFile.outputPath).catch(() => {})}
                style={{
                  appearance: "none",
                  border: "none",
                  background: "transparent",
                  color: "#93c5fd",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                  textDecoration: "underline",
                }}
                type="button"
              >
                Show
              </button>
            </VideoHint>
          ) : null}
          {mode === "words" && struckWords.length ? (
            <VideoPaneButton onClick={removeStruckFromCut} type="button">
              ✂ Remove {struckWords.length} word{struckWords.length === 1 ? "" : "s"} from cut
            </VideoPaneButton>
          ) : null}
          {loading ? <VideoHint>Loading…</VideoHint> : null}
        </FooterBar>
      ) : null}
    </PanelRoot>
  );
}
