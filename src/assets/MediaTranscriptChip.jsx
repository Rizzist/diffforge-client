import { useCallback, useEffect, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { ClosedCaption } from "@styled-icons/material-rounded/ClosedCaption";
import { ClosedCaptionOff } from "@styled-icons/material-rounded/ClosedCaptionOff";

import { readDeepgramApiKey } from "../audio/audioCapture";
import {
  getMediaTranscriptStatus,
  mediaPathIsTranscribable,
  transcribeMediaAsset,
  TRANSCRIPTION_STAGES,
} from "./videoTranscription";

const statusCache = new Map();

function cachedStatus(path, force = false) {
  if (force || !statusCache.has(path)) {
    statusCache.set(path, getMediaTranscriptStatus(path));
  }
  return statusCache.get(path);
}

const chipSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const ChipRoot = styled.span`
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  color: var(--forge-muted, #94a3b8);
  background: rgba(15, 23, 42, 0.4);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &[data-state="transcribed"] {
    border-color: rgba(60, 203, 127, 0.4);
    color: #86efac;
    background: rgba(60, 203, 127, 0.1);
  }

  &[data-state="working"] {
    border-color: rgba(94, 234, 212, 0.4);
    color: #5eead4;
  }

  &[data-state="error"] {
    border-color: rgba(239, 107, 107, 0.42);
    color: #fca5a5;
  }
`;

const ChipButton = styled.button`
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  color: var(--forge-text, #e2e8f0);
  background: rgba(15, 23, 42, 0.46);
  cursor: pointer;
  font-size: 0.66rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  white-space: nowrap;

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    border-color: rgba(94, 234, 212, 0.46);
    color: #5eead4;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const ChipSpinner = styled.i`
  display: inline-block;
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border: 2px solid rgba(94, 234, 212, 0.32);
  border-top-color: #5eead4;
  border-radius: 999px;
  animation: ${chipSpin} 720ms linear infinite;
`;

export default function MediaTranscriptChip({
  local_path: localPath = "",
  mediaName = "",
  onTranscribed = null,
}) {
  const transcribable = mediaPathIsTranscribable(localPath);
  const [status, setStatus] = useState(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!transcribable || !localPath) {
      setStatus(null);
      return;
    }
    let stale = false;
    cachedStatus(localPath).then((next) => {
      if (!stale && mountedRef.current) setStatus(next);
    });
    return () => {
      stale = true;
    };
  }, [localPath, transcribable]);

  const runTranscription = useCallback(async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!localPath || stage) return;
    setError("");
    const apiKey = readDeepgramApiKey().trim();
    const provider = apiKey ? "deepgram" : "whisper";
    try {
      const result = await transcribeMediaAsset({
        api_key: apiKey,
        mediaName,
        media_path: localPath,
        onStage: (nextStage) => {
          if (mountedRef.current) setStage(nextStage);
        },
        provider,
      });
      const nextStatus = await cachedStatus(localPath, true);
      if (mountedRef.current) {
        setStatus(nextStatus);
        setStage("");
      }
      onTranscribed?.({ local_path: localPath, ...result });
    } catch (transcriptionError) {
      if (mountedRef.current) {
        setStage("");
        setError(transcriptionError?.message || String(transcriptionError || "Transcription failed."));
      }
    }
  }, [localPath, mediaName, onTranscribed, stage]);

  if (!transcribable) return null;

  if (stage) {
    return (
      <ChipRoot data-state="working" title={TRANSCRIPTION_STAGES[stage] || stage}>
        <ChipSpinner aria-hidden="true" />
        <span>{TRANSCRIPTION_STAGES[stage] || stage}</span>
      </ChipRoot>
    );
  }

  if (error) {
    return (
      <ChipButton onClick={runTranscription} title={`${error}\nClick to retry.`} type="button">
        <ClosedCaptionOff aria-hidden="true" />
        <span>Retry transcript</span>
      </ChipButton>
    );
  }

  if (status?.exists) {
    return (
      <ChipRoot
        data-state="transcribed"
        title={`Transcript attached\n${status.srt_path}\n${status.json_path}`}
      >
        <ClosedCaption aria-hidden="true" />
        <span>Transcribed</span>
      </ChipRoot>
    );
  }

  return (
    <ChipButton
      onClick={runTranscription}
      title={readDeepgramApiKey().trim()
        ? "Generate a transcript with Deepgram (audio is extracted locally first)"
        : "Generate a transcript with local Whisper (add a Deepgram key in the Audio tab for cloud transcription)"}
      type="button"
    >
      <ClosedCaptionOff aria-hidden="true" />
      <span>Transcribe</span>
    </ChipButton>
  );
}
