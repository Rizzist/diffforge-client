import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { Audiotrack } from "@styled-icons/material-rounded/Audiotrack";
import { Close } from "@styled-icons/material-rounded/Close";
import { Description } from "@styled-icons/material-rounded/Description";
import { GraphicEq } from "@styled-icons/material-rounded/GraphicEq";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { MusicNote } from "@styled-icons/material-rounded/MusicNote";
import { Notes } from "@styled-icons/material-rounded/Notes";
import { Replay } from "@styled-icons/material-rounded/Replay";
import { Subject } from "@styled-icons/material-rounded/Subject";
import { Translate } from "@styled-icons/material-rounded/Translate";

/* New Media deck: a media-processing workspace in the session view's visual
   language — the same 48.5rem centered column, but each "chat item" is a
   MEDIA OBJECT card (file → options → queue → outputs) instead of a message.

   The real pipeline (local ffmpeg + web conversions, API transcription /
   translation / summarization) lands with the media backend; THIS build is a
   scripted demo — processing is simulated with timers and outputs carry a
   "demo output" tag — but the interaction contract (options lock at queue
   time, one item processes at a time, outputs expand like tool-cluster
   drawers) is the production one. */

const AUDIO_EXTS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff", "wma"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg", "ts", "3gp"];

const LANGUAGES = ["English", "Arabic", "Urdu", "Chinese", "Spanish"];
const LANG_CODES = { English: "en", Arabic: "ar", Urdu: "ur", Chinese: "zh", Spanish: "es" };

const CONVERT_OPTIONS = [
  { value: "keep", label: "Keep original" },
  { value: "mp3", label: "mp3" },
  { value: "wav", label: "wav" },
  { value: "mp4", label: "mp4" },
  { value: "srt", label: "srt only" },
];

const STATUS_LABEL = {
  idle: "Ready",
  queued: "Queued",
  processing: "Processing",
  complete: "Complete",
};

/* Zero-file demo path: "Add sample clip" fabricates one of these so the whole
   flow is demoable without touching the dialog. */
const SAMPLE_CLIPS = [
  { name: "podcast-episode.mp3", kind: "audio", sizeLabel: "42 MB", durationLabel: "38:12" },
  { name: "interview-cut.mp4", kind: "video", sizeLabel: "184 MB", durationLabel: "12:47" },
  { name: "voicenote-arabic.m4a", kind: "audio", sizeLabel: "6.1 MB", durationLabel: "4:03" },
];

/* ---- demo output content ---------------------------------------------- */

const DEMO_CUES = [
  { idx: 1, from: "00:00:01,240", to: "00:00:04,980" },
  { idx: 2, from: "00:00:05,120", to: "00:00:09,400" },
  { idx: 3, from: "00:00:09,610", to: "00:00:13,020" },
];

const SOURCE_LINES = [
  "Welcome back — today we're digging into local-first media pipelines.",
  "Everything you'll hear was processed on-device, no upload step at all.",
  "Let's start with why ffmpeg is still the workhorse in 2026.",
];

const TRANSLATIONS = {
  English: SOURCE_LINES,
  Arabic: [
    "مرحباً بكم من جديد — اليوم نتعمق في معالجة الوسائط محلياً.",
    "كل ما ستسمعونه تمت معالجته على الجهاز، دون أي رفع للملفات.",
    "لنبدأ بسبب بقاء ffmpeg الأداة الأساسية في 2026.",
  ],
  Urdu: [
    "خوش آمدید — آج ہم لوکل میڈیا پائپ لائنز پر بات کریں گے۔",
    "جو کچھ آپ سنیں گے وہ اسی ڈیوائس پر پروسیس ہوا ہے، کوئی اپ لوڈ نہیں۔",
    "آئیے شروع کرتے ہیں کہ ffmpeg اب بھی سب سے اہم کیوں ہے۔",
  ],
  Chinese: [
    "欢迎回来——今天我们深入探讨本地优先的媒体处理流程。",
    "接下来的内容全部在设备本地处理，完全没有上传环节。",
    "先来说说为什么 ffmpeg 在 2026 年仍是主力工具。",
  ],
  Spanish: [
    "Bienvenidos de nuevo: hoy exploramos los flujos de medios locales.",
    "Todo lo que escucharán se procesó en el dispositivo, sin subir nada.",
    "Empecemos por qué ffmpeg sigue siendo el caballo de batalla en 2026.",
  ],
};

function srtBody(lines) {
  return DEMO_CUES.map((cue, index) => (
    `${cue.idx}\n${cue.from} --> ${cue.to}\n${lines[index] || ""}`
  )).join("\n\n");
}

function summaryBody(stem) {
  return [
    `## ${stem} — summary`,
    "",
    "A conversational deep-dive into local-first media pipelines: why on-device",
    "ffmpeg still anchors the workflow, where hosted APIs earn their keep",
    "(transcription, translation), and how a hybrid queue behaves in practice.",
    "",
    "- Originals never leave the machine; only extracted text goes to APIs.",
    "- Whisper-class models now hold up on accented, multi-speaker audio.",
    "- Next step: wire the srt → summary hand-off before the public beta.",
  ].join("\n");
}

function convertLog(item, stem) {
  const target = item.options.convert;
  const codec = target === "mp4"
    ? "-c:v libx264 -pix_fmt yuv420p -c:a aac"
    : target === "wav"
      ? "-vn -ar 48000 -c:a pcm_s16le"
      : "-vn -ar 44100 -b:a 192k";
  return [
    `$ ffmpeg -i "${item.name}" ${codec} "${stem}.${target}"`,
    `size=   42188kB time=${item.durationLabel} bitrate= 192.0kbits/s speed=41.2x`,
    `→ wrote ${stem}.${target}`,
  ].join("\n");
}

/* Complete-time output set, derived from the locked options. "srt only"
   conversion implies a transcript pass even with Transcribe toggled off. */
function outputsFor(item) {
  const { options } = item;
  const stem = item.name.replace(/\.[^.]+$/, "") || item.name;
  const outputs = [];
  if (options.transcribe || options.convert === "srt") {
    outputs.push({
      id: "transcript-srt",
      icon: "doc",
      label: "Transcript .srt",
      file: `${stem}.srt`,
      body: srtBody(SOURCE_LINES),
    });
  }
  if (options.transcribe) {
    outputs.push({
      id: "transcript-txt",
      icon: "doc",
      label: "Transcript .txt",
      file: `${stem}.txt`,
      body: `${SOURCE_LINES.join("\n")}\n\n… ${item.durationLabel} of dialogue in the full file.`,
    });
  }
  if (options.translate) {
    const lang = options.translateTo;
    outputs.push({
      id: "translation-srt",
      icon: "translate",
      label: "Translation .srt",
      file: `${stem}.${LANG_CODES[lang] || "xx"}.srt`,
      body: srtBody(TRANSLATIONS[lang] || SOURCE_LINES),
    });
  }
  if (options.summarize) {
    outputs.push({
      id: "summary-md",
      icon: "notes",
      label: "Summary .md",
      file: `${stem}.summary.md`,
      body: summaryBody(stem),
    });
  }
  if (options.convert !== "keep" && options.convert !== "srt") {
    outputs.push({
      id: "converted-media",
      icon: options.convert === "mp4" ? "video" : "audio",
      label: `Converted .${options.convert}`,
      file: `${stem}.${options.convert}`,
      body: convertLog(item, stem),
    });
  }
  return outputs;
}

/* ---- simulated pipeline ----------------------------------------------- */

function stagesFor(options) {
  const stages = [{ label: "extracting audio…", weight: 1.6 }];
  const needsTranscript = options.transcribe || options.translate
    || options.summarize || options.convert === "srt";
  if (needsTranscript) stages.push({ label: "transcribing…", weight: 3 });
  if (options.translate) {
    stages.push({ label: `translating to ${options.translateTo}…`, weight: 2.2 });
  }
  if (options.summarize) stages.push({ label: "summarizing…", weight: 1.8 });
  if (options.convert !== "keep" && options.convert !== "srt") {
    stages.push({ label: `converting to ${options.convert}…`, weight: 1.6 });
  }
  return stages;
}

function totalMsFor(options) {
  const weight = stagesFor(options).reduce((sum, stage) => sum + stage.weight, 0);
  return Math.max(6000, Math.min(10000, 3200 + weight * 1100));
}

/* Queue promotion is data-driven: an item entering the queue when nothing is
   processing (or the next queued item at completion time) flips straight to
   processing inside the state updater; the ticker effect only OBSERVES the
   processing item and drives its interval. */
function promoteToProcessing(item) {
  return {
    ...item,
    status: "processing",
    progress: 0,
    stages: stagesFor(item.options),
    totalMs: totalMsFor(item.options),
    outputs: [],
    completedAt: 0,
  };
}

function enqueueInto(current, id, fromStatus) {
  const busy = current.some((item) => item.status === "processing");
  return current.map((item) => {
    if (item.id !== id || item.status !== fromStatus) return item;
    if (busy) {
      return { ...item, status: "queued", progress: 0, outputs: [], completedAt: 0 };
    }
    return promoteToProcessing(item);
  });
}

function stageLabelFor(item) {
  const stages = item.stages || [];
  if (!stages.length) return "processing…";
  const total = stages.reduce((sum, stage) => sum + stage.weight, 0) || 1;
  let acc = 0;
  for (const stage of stages) {
    acc += stage.weight;
    if (item.progress <= acc / total) return stage.label;
  }
  return stages[stages.length - 1].label;
}

/* ---- file metadata ---------------------------------------------------- */

function kindOf(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return VIDEO_EXTS.includes(ext) ? "video" : "audio";
}

function isMediaName(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
}

function hashOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function durationLabelOf(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/* No probe backend yet — size/duration for picked paths are stable pseudo
   values derived from the name, honest-tagged at the output layer. */
function pseudoSizeLabel(name) {
  const mb = 3 + (hashOf(`${name}:size`) % 1170) / 10;
  return `${mb.toFixed(1)} MB`;
}

function pseudoDurationLabel(name) {
  return durationLabelOf(120 + (hashOf(`${name}:duration`) % 4080));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function timeShort(atMs) {
  if (!Number.isFinite(atMs) || atMs <= 0) return "";
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---- media card ------------------------------------------------------- */

function OutputIcon({ kind }) {
  if (kind === "translate") return <Translate aria-hidden="true" />;
  if (kind === "notes") return <Notes aria-hidden="true" />;
  if (kind === "video") return <Movie aria-hidden="true" />;
  if (kind === "audio") return <MusicNote aria-hidden="true" />;
  return <Description aria-hidden="true" />;
}

function MediaCard({ item, queueLabel, onQueue, onRemove, onRerun, onOptionChange }) {
  const [openOutput, setOpenOutput] = useState("");
  const { options, status } = item;
  const locked = status !== "idle";
  const percent = Math.round((item.progress || 0) * 100);
  const hasWork = options.transcribe || options.translate
    || options.summarize || options.convert !== "keep";

  return (
    <CardShell data-status={status}>
      <CardHead>
        <KindTile data-kind={item.kind} aria-hidden="true">
          {item.kind === "video" ? <Movie /> : <Audiotrack />}
        </KindTile>
        <NameBlock>
          <FileName title={item.path || item.name}>{item.name}</FileName>
          <FileMeta>
            {item.kind} · {item.sizeLabel} · {item.durationLabel}
          </FileMeta>
        </NameBlock>
        <StatusBadge data-status={status}>
          {status === "processing" && <PulseDot aria-hidden="true" />}
          {STATUS_LABEL[status]}
        </StatusBadge>
        {status === "idle" && (
          <RemoveButton aria-label={`Remove ${item.name}`} onClick={onRemove} type="button">
            <Close aria-hidden="true" />
          </RemoveButton>
        )}
      </CardHead>

      <OptionsRow>
        <ToggleChip
          data-on={options.transcribe ? "true" : undefined}
          disabled={locked}
          onClick={() => onOptionChange("transcribe", !options.transcribe)}
          type="button"
        >
          <Subject aria-hidden="true" />
          <span>Transcribe</span>
        </ToggleChip>
        <ToggleChip
          data-on={options.translate ? "true" : undefined}
          disabled={locked}
          onClick={() => onOptionChange("translate", !options.translate)}
          type="button"
        >
          <Translate aria-hidden="true" />
          <span>Translate</span>
        </ToggleChip>
        {options.translate && (
          <SelectPill data-locked={locked ? "true" : undefined}>
            <em>to</em>
            <select
              aria-label="Translation target language"
              disabled={locked}
              onChange={(event) => onOptionChange("translateTo", event.target.value)}
              value={options.translateTo}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <i aria-hidden="true">▾</i>
          </SelectPill>
        )}
        <ToggleChip
          data-on={options.summarize ? "true" : undefined}
          disabled={locked}
          onClick={() => onOptionChange("summarize", !options.summarize)}
          type="button"
        >
          <Notes aria-hidden="true" />
          <span>Summarize</span>
        </ToggleChip>
        <SelectPill data-locked={locked ? "true" : undefined}>
          <em>Convert</em>
          <select
            aria-label="Convert output format"
            disabled={locked}
            onChange={(event) => onOptionChange("convert", event.target.value)}
            value={options.convert}
          >
            {CONVERT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <i aria-hidden="true">▾</i>
        </SelectPill>
      </OptionsRow>

      {status === "idle" && (
        <ActionRow>
          <QueueButton disabled={!hasWork} onClick={onQueue} type="button">
            Queue
          </QueueButton>
          <ActionHint>
            {hasWork
              ? "runs locally · simulated in this preview"
              : "pick at least one option to queue"}
          </ActionHint>
        </ActionRow>
      )}

      {status === "queued" && (
        <ActionRow>
          <WaitNote>{queueLabel}</WaitNote>
        </ActionRow>
      )}

      {status === "processing" && (
        <ProgressBlock>
          <ProgressTrack>
            <ProgressFill style={{ width: `${Math.max(2, percent)}%` }} />
          </ProgressTrack>
          <ProgressCaption>
            <span>{stageLabelFor(item)}</span>
            <em>{percent}%</em>
          </ProgressCaption>
        </ProgressBlock>
      )}

      {status === "complete" && (
        <>
          <OutputsCard>
            <OutputsHead>
              <span>outputs</span>
              <DemoTag>demo output</DemoTag>
            </OutputsHead>
            {item.outputs.map((output) => {
              const open = openOutput === output.id;
              return (
                <OutputWrap key={output.id}>
                  <OutputRow
                    aria-expanded={open}
                    onClick={() => setOpenOutput(open ? "" : output.id)}
                    type="button"
                  >
                    <Chevron data-open={open ? "true" : undefined} aria-hidden="true" />
                    <OutputGlyph aria-hidden="true">
                      <OutputIcon kind={output.icon} />
                    </OutputGlyph>
                    <OutputLabel>{output.label}</OutputLabel>
                    <OutputFile>{output.file}</OutputFile>
                  </OutputRow>
                  {open && (
                    <>
                      <OutputPre>{output.body}</OutputPre>
                      <OutputNote>
                        demo output — the real pipeline lands with the media backend
                      </OutputNote>
                    </>
                  )}
                </OutputWrap>
              );
            })}
          </OutputsCard>
          <ActionRow>
            <GhostButton onClick={onRerun} type="button">
              <Replay aria-hidden="true" />
              <span>Re-run</span>
            </GhostButton>
            {item.completedAt ? (
              <ActionHint>finished {timeShort(item.completedAt)}</ActionHint>
            ) : null}
          </ActionRow>
        </>
      )}
    </CardShell>
  );
}

/* ---- deck ------------------------------------------------------------- */

export default function MediaDeck() {
  const [items, setItems] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const scrollerRef = useRef(null);
  const idRef = useRef(0);
  const sampleRef = useRef(0);
  const timerRef = useRef(null);

  const makeItem = useCallback((name, extra = {}) => {
    idRef.current += 1;
    return {
      id: `media-${Date.now()}-${idRef.current}`,
      name,
      path: extra.path || "",
      kind: extra.kind || kindOf(name),
      sizeLabel: extra.sizeLabel || pseudoSizeLabel(name),
      durationLabel: extra.durationLabel || pseudoDurationLabel(name),
      status: "idle",
      progress: 0,
      stages: [],
      totalMs: 0,
      completedAt: 0,
      outputs: [],
      options: {
        transcribe: true,
        translate: false,
        translateTo: "English",
        summarize: false,
        convert: "keep",
      },
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const node = scrollerRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  const appendItems = useCallback((next) => {
    if (!next.length) return;
    setItems((current) => [...current, ...next]);
    scrollToEnd();
  }, [scrollToEnd]);

  const pickFiles = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        title: "Add media",
        filters: [
          { name: "Media", extensions: [...AUDIO_EXTS, ...VIDEO_EXTS] },
          { name: "Audio", extensions: AUDIO_EXTS },
          { name: "Video", extensions: VIDEO_EXTS },
        ],
      });
      const paths = (Array.isArray(picked) ? picked : picked ? [picked] : [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.path))
        .filter(Boolean);
      appendItems(paths.map((path) => {
        const name = path.split(/[\\/]/).pop() || path;
        return makeItem(name, { path });
      }));
    } catch {
      // Dialog cancelled/unavailable — nothing to add.
    }
  }, [appendItems, makeItem]);

  /* DOM drop carries real File objects — real names and byte sizes; only the
     duration is pseudo until the probe backend lands. */
  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files || [])
      .filter((file) => isMediaName(file.name));
    appendItems(files.map((file) => makeItem(file.name, {
      sizeLabel: formatBytes(file.size) || pseudoSizeLabel(file.name),
    })));
  }, [appendItems, makeItem]);

  /* Repeat sample adds get a deterministic " (n)" suffix per cycle through
     the catalog — no need to read the current list. */
  const addSample = useCallback(() => {
    const index = sampleRef.current;
    sampleRef.current += 1;
    const sample = SAMPLE_CLIPS[index % SAMPLE_CLIPS.length];
    const round = Math.floor(index / SAMPLE_CLIPS.length);
    const name = round
      ? sample.name.replace(/\.([^.]+)$/, ` (${round + 1}).$1`)
      : sample.name;
    appendItems([makeItem(name, sample)]);
  }, [appendItems, makeItem]);

  /* Queue engine: ONE item processes at a time. The tick interval drives the
     active item's progress; when it finishes it clears itself and the SAME
     updater promotes the next queued card, so the ticker effect below never
     has to write state. Progress stays monotonic across a remount
     (StrictMode) via the elapsed offset. */
  const startRun = useCallback((entry) => {
    if (timerRef.current) return;
    const { id } = entry;
    const totalMs = entry.totalMs || 1;
    const startAt = Date.now() - entry.progress * totalMs;
    timerRef.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - startAt) / totalMs);
      if (t >= 1) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setItems((current) => {
        const done = t >= 1;
        const next = current.map((item) => {
          if (item.id !== id || item.status !== "processing") return item;
          if (done) {
            return {
              ...item,
              status: "complete",
              progress: 1,
              completedAt: Date.now(),
              outputs: outputsFor(item),
            };
          }
          return { ...item, progress: Math.max(item.progress, t) };
        });
        if (!done) return next;
        const queuedIndex = next.findIndex((item) => item.status === "queued");
        if (queuedIndex < 0) return next;
        return next.map((item, index) => (
          index === queuedIndex ? promoteToProcessing(item) : item
        ));
      });
    }, 120);
  }, []);

  useEffect(() => {
    if (timerRef.current) return;
    const active = items.find((item) => item.status === "processing");
    if (active) startRun(active);
  }, [items, startRun]);

  useEffect(() => () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setOption = useCallback((id, key, value) => {
    setItems((current) => current.map((item) => (
      item.id === id && item.status === "idle"
        ? { ...item, options: { ...item.options, [key]: value } }
        : item
    )));
  }, []);

  const queueItem = useCallback((id) => {
    setItems((current) => enqueueInto(current, id, "idle"));
  }, []);

  const removeItem = useCallback((id) => {
    setItems((current) => current.filter((item) => (
      item.id !== id || item.status !== "idle"
    )));
  }, []);

  const rerunItem = useCallback((id) => {
    setItems((current) => enqueueInto(current, id, "complete"));
  }, []);

  /* Queue captions: the processing card is #1; waiting cards count from #2. */
  const queuedIds = items
    .filter((item) => item.status === "queued")
    .map((item) => item.id);
  const hasProcessing = items.some((item) => item.status === "processing");
  const queueLabelFor = (id) => {
    const position = queuedIds.indexOf(id) + (hasProcessing ? 2 : 1);
    return `Waiting · #${position} in queue`;
  };

  return (
    <DeckRoot>
      <DeckScroller ref={scrollerRef}>
        {items.length === 0 && (
          <IntroBlock>
            <IntroBadge>New Media</IntroBadge>
            <IntroTitle>Drop audio or video, get text back.</IntroTitle>
            <IntroCopy>
              transcription · translation · summaries · conversions — processed
              locally with ffmpeg, plus API transcription where it earns its keep.
            </IntroCopy>
            <IntroDim>
              processing engine coming online soon — this deck simulates the full flow
            </IntroDim>
          </IntroBlock>
        )}
        {items.map((item) => (
          <CardLane key={item.id}>
            <MediaCard
              item={item}
              onOptionChange={(key, value) => setOption(item.id, key, value)}
              onQueue={() => queueItem(item.id)}
              onRemove={() => removeItem(item.id)}
              onRerun={() => rerunItem(item.id)}
              queueLabel={queueLabelFor(item.id)}
            />
          </CardLane>
        ))}
      </DeckScroller>

      <ComposerZone>
        <DropCard
          data-active={dragActive ? "true" : undefined}
          onClick={() => void pickFiles()}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void pickFiles();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <DropRing aria-hidden="true">
            <Add />
          </DropRing>
          <DropCopy>
            <strong>Add media</strong>
            <span>Drop audio or video here, or click to browse</span>
          </DropCopy>
          <SampleButton
            onClick={(event) => {
              event.stopPropagation();
              addSample();
            }}
            type="button"
          >
            <GraphicEq aria-hidden="true" />
            <span>Add sample clip</span>
          </SampleButton>
        </DropCard>
      </ComposerZone>
    </DeckRoot>
  );
}

/* ---- deck layout ------------------------------------------------------ */

const DeckRoot = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
`;

const DeckScroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Session Deck measure: scaling side gutters, then every lane caps itself
     at the 48.5rem column and centers — same rhythm as the transcript. */
  padding: 8px clamp(20px, 7%, 64px);
`;

const CardLane = styled.div`
  width: 100%;
  max-width: 48.5rem;
  margin: 0 auto;
  padding: 6px 0;
`;

/* ---- intro ------------------------------------------------------------ */

const IntroBlock = styled.div`
  width: 100%;
  max-width: 48.5rem;
  margin: 26px auto 0;
  padding: 22px 24px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 14px;
  background: rgba(var(--forge-tint-rgb), 0.04);
`;

const IntroBadge = styled.div`
  width: fit-content;
  margin-bottom: 10px;
  padding: 2px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.4);
  border-radius: 999px;
  color: var(--forge-accent-soft);
  background: rgba(var(--forge-tint-rgb), 0.12);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const IntroTitle = styled.div`
  margin-bottom: 6px;
  color: var(--forge-text);
  font-size: 15px;
  font-weight: 700;
`;

const IntroCopy = styled.div`
  max-width: 58ch;
  color: var(--forge-text-soft);
  font-size: 12.5px;
  line-height: 1.6;
`;

const IntroDim = styled.div`
  margin-top: 10px;
  color: var(--forge-text-disabled);
  font-size: 10.5px;
  font-style: italic;
`;

/* ---- card ------------------------------------------------------------- */

const CardShell = styled.div`
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background: var(--forge-surface);
  transition: border-color 200ms ease;

  &[data-status="processing"] {
    border-color: color-mix(in srgb, var(--forge-amber) 35%, var(--forge-border));
  }

  &[data-status="complete"] {
    border-color: color-mix(in srgb, var(--forge-green) 28%, var(--forge-border));
  }
`;

const CardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const KindTile = styled.div`
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  color: var(--forge-text-muted);
  background: var(--forge-surface-control);

  svg {
    width: 16px;
    height: 16px;
  }

  &[data-kind="video"] {
    color: var(--forge-accent-soft);
  }
`;

const NameBlock = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const FileName = styled.div`
  overflow: hidden;
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const FileMeta = styled.div`
  margin-top: 1px;
  color: var(--forge-text-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
`;

const StatusBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: var(--forge-surface-control);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;

  &[data-status="processing"] {
    border-color: color-mix(in srgb, var(--forge-amber) 45%, var(--forge-border));
    color: var(--forge-amber);
    background: color-mix(in srgb, var(--forge-amber) 8%, var(--forge-surface-control));
  }

  &[data-status="complete"] {
    border-color: color-mix(in srgb, var(--forge-green) 40%, var(--forge-border));
    color: var(--forge-green);
    background: color-mix(in srgb, var(--forge-green) 7%, var(--forge-surface-control));
  }
`;

const PulseDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--forge-amber);
  animation: media-deck-pulse 1.2s ease-in-out infinite;

  @keyframes media-deck-pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.8);
    }
  }
`;

const RemoveButton = styled.button`
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    color: var(--forge-text);
    background: rgba(255, 255, 255, 0.1);
  }
`;

/* ---- options ---------------------------------------------------------- */

const OptionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 11px;
`;

const ToggleChip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;

  svg {
    width: 12px;
    height: 12px;
    color: var(--forge-text-muted);
  }

  &:hover:not(:disabled) {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
  }

  &[data-on="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.45);
    color: var(--forge-accent-soft);
    background: rgba(var(--forge-tint-rgb), 0.14);

    svg {
      color: var(--forge-accent-soft);
    }
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const SelectPill = styled.label`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  background: var(--forge-surface-control);

  em {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-style: normal;
    font-weight: 760;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  select {
    padding: 0 12px 0 0;
    border: 0;
    color: var(--forge-text-soft);
    background: transparent;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 700;
    appearance: none;
    outline: none;
    cursor: pointer;
  }

  i {
    position: absolute;
    right: 9px;
    color: var(--forge-text-muted);
    font-size: 8px;
    font-style: normal;
    pointer-events: none;
  }

  &:hover:not([data-locked="true"]) {
    border-color: var(--forge-border-strong);

    select {
      color: var(--forge-text);
    }
  }

  &[data-locked="true"] {
    opacity: 0.55;

    select {
      cursor: default;
    }
  }
`;

/* ---- actions / progress ----------------------------------------------- */

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 11px;
`;

const QueueButton = styled.button`
  padding: 5px 18px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.45);
  border-radius: 999px;
  color: var(--forge-accent-soft);
  background: rgba(var(--forge-tint-rgb), 0.22);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;

  &:hover:not(:disabled) {
    color: #fff;
    border-color: var(--forge-accent);
    background: var(--forge-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const GhostButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 13px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
    background: var(--forge-surface-hover);
  }
`;

const ActionHint = styled.span`
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const WaitNote = styled.span`
  color: var(--forge-text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const ProgressBlock = styled.div`
  margin-top: 12px;
`;

const ProgressTrack = styled.div`
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--forge-surface-control);
`;

const ProgressFill = styled.div`
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--forge-amber) 70%, var(--forge-ember)),
    var(--forge-amber)
  );
  transition: width 160ms linear;
  animation: media-deck-fill-pulse 1.2s ease-in-out infinite;

  @keyframes media-deck-fill-pulse {
    50% {
      opacity: 0.65;
    }
  }
`;

const ProgressCaption = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
  color: var(--forge-amber);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  font-weight: 600;

  em {
    color: var(--forge-text-muted);
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }
`;

/* ---- outputs (tool-cluster family) ------------------------------------ */

const OutputsCard = styled.div`
  min-width: 0;
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface-raised);
`;

const OutputsHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--forge-border);
  color: var(--forge-text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;

const DemoTag = styled.span`
  padding: 1px 7px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 999px;
  color: var(--forge-text-disabled);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  text-transform: lowercase;
`;

const OutputWrap = styled.div`
  &:not(:last-child) {
    border-bottom: 1px solid var(--forge-border);
  }
`;

const OutputRow = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--forge-text-soft);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

const Chevron = styled.span`
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  opacity: 0.7;
  transition: transform 120ms ease;

  &[data-open="true"] {
    transform: rotate(90deg);
  }
`;

const OutputGlyph = styled.span`
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--forge-green);

  svg {
    width: 13px;
    height: 13px;
  }
`;

const OutputLabel = styled.span`
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--forge-text);
  font-weight: 640;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const OutputFile = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 10px;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const OutputPre = styled.pre`
  margin: 0;
  max-height: 220px;
  padding: 8px 12px 10px;
  overflow: auto;
  border-top: 1px dashed var(--forge-border);
  color: var(--forge-text-soft);
  background: var(--forge-bg-deep, transparent);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const OutputNote = styled.div`
  padding: 5px 12px 7px;
  border-top: 1px dashed var(--forge-border);
  color: var(--forge-text-disabled);
  background: var(--forge-bg-deep, transparent);
  font-size: 10px;
  font-style: italic;
`;

/* ---- composer-position drop zone -------------------------------------- */

const ComposerZone = styled.div`
  flex: 0 0 auto;
  /* Shares the transcript column measure, including its scaling gutter. */
  width: min(48.5rem, calc(100% - 2 * clamp(20px, 7%, 64px)));
  margin: 6px auto 12px;
`;

const DropCard = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 16px;
  background: var(--forge-surface-raised);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
  outline: none;

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.5);
  }

  &[data-active="true"] {
    border-color: var(--forge-accent);
    background: rgba(var(--forge-tint-rgb), 0.08);
  }
`;

const DropRing = styled.span`
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-muted);

  svg {
    width: 14px;
    height: 14px;
  }

  ${DropCard}:hover &,
  ${DropCard}[data-active="true"] & {
    color: var(--forge-accent-soft);
    border-color: rgba(var(--forge-tint-soft-rgb), 0.45);
  }
`;

const DropCopy = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  strong {
    display: block;
    color: var(--forge-text);
    font-size: 12.5px;
    font-weight: 650;
  }

  span {
    display: block;
    margin-top: 1px;
    color: var(--forge-text-muted);
    font-size: 10.5px;
  }
`;

const SampleButton = styled.button`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 4px 13px;
  border: 1px solid var(--forge-border);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
    color: var(--forge-text-muted);
  }

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
    background: var(--forge-surface-hover);
  }
`;
