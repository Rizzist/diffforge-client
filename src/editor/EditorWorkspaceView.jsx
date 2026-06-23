import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { Add } from "@styled-icons/material-rounded/Add";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Description } from "@styled-icons/material-rounded/Description";
import { DriveFileRenameOutline } from "@styled-icons/material-rounded/DriveFileRenameOutline";
import { FolderOpen } from "@styled-icons/material-rounded/FolderOpen";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { GraphicEq } from "@styled-icons/material-rounded/GraphicEq";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { OpenInFull } from "@styled-icons/material-rounded/OpenInFull";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { Videocam } from "@styled-icons/material-rounded/Videocam";

import { PanelHeading, PanelKicker, PrimaryButton, PrimaryDangerButton, SecondaryButton } from "../app/appStyles";

const PROJECTS_STORAGE_KEY = "diffforge.editor.projects.v1";
const OPEN_PROJECT_STORAGE_KEY = "diffforge.editor.open-project.v1";

// The local-only editor root is purely cosmetic for the frontend shell — the
// Rust backend will own the real on-disk path later. We surface it so cards and
// the folder viewer read like real, locally-rooted projects.
const DEFAULT_EDITOR_ROOT = "~/Diff Forge/Editor";

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || "untitled-project";
}

function generateProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `proj-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function loadProjects() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.id && entry.name) : [];
  } catch {
    return [];
  }
}

function persistProjects(projects) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Persistence is best-effort in the shell; ignore quota/availability errors.
  }
}

// The currently open project is persisted at the device (localStorage) level so
// switching to another tab and back — or relaunching the app — reopens exactly
// what the user was working on.
function loadOpenProjectId() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(OPEN_PROJECT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persistOpenProjectId(openProjectId) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (openProjectId) {
      window.localStorage.setItem(OPEN_PROJECT_STORAGE_KEY, openProjectId);
    } else {
      window.localStorage.removeItem(OPEN_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Best-effort; the gallery is a safe fallback if this can't be read back.
  }
}

function formatCreatedAt(value) {
  if (!value) {
    return "Unknown date";
  }
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Unknown date";
  }
}

// A static scaffold mirroring the project folder layout from the proposal. The
// real tree will be read from disk by the backend; for now it documents intent.
function projectScaffold(project) {
  return [
    { kind: "dir", name: "assets", depth: 0 },
    { kind: "dir", name: "clips", depth: 1 },
    { kind: "dir", name: "audio", depth: 1 },
    { kind: "dir", name: "exports", depth: 0 },
    { kind: "file", name: "project.dft", depth: 0, hint: "timeline" },
  ];
}

function FileTreeIcon({ entry }) {
  if (entry.kind === "dir") {
    return <TreeFolderIcon aria-hidden="true" />;
  }
  if (entry.hint === "timeline") {
    return <TreeTimelineIcon aria-hidden="true" />;
  }
  return <TreeFileIcon aria-hidden="true" />;
}

const TIMELINE_RULER_MARKS = ["0:00", "0:05", "0:10", "0:15", "0:20", "0:25", "0:30"];

function EditorWorkspaceView({ defaultWorkingDirectory = "" }) {
  const [projects, setProjects] = useState(() => loadProjects());
  const [openProjectId, setOpenProjectId] = useState(() => loadOpenProjectId());

  // null = closed; { mode: "create" } | { mode: "rename", project } | { mode: "delete", project }
  const [dialog, setDialog] = useState(null);
  const [draftName, setDraftName] = useState("");
  const draftInputRef = useRef(null);

  useEffect(() => {
    persistProjects(projects);
  }, [projects]);

  useEffect(() => {
    persistOpenProjectId(openProjectId);
  }, [openProjectId]);

  // If the persisted open project no longer exists (deleted, or storage cleared),
  // fall back to the gallery so we never restore a dangling reference.
  useEffect(() => {
    if (openProjectId && !projects.some((entry) => entry.id === openProjectId)) {
      setOpenProjectId(null);
    }
  }, [openProjectId, projects]);

  useEffect(() => {
    if (dialog?.mode === "create" || dialog?.mode === "rename") {
      const id = window.requestAnimationFrame(() => {
        draftInputRef.current?.focus();
        draftInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [dialog]);

  const openProject = useMemo(
    () => projects.find((entry) => entry.id === openProjectId) || null,
    [projects, openProjectId],
  );

  const editorRoot = useMemo(() => {
    const base = String(defaultWorkingDirectory || "").trim();
    return base ? `${base.replace(/\/$/, "")}/.diffforge/editor` : DEFAULT_EDITOR_ROOT;
  }, [defaultWorkingDirectory]);

  const projectPath = useCallback(
    (project) => `${editorRoot}/${slugify(project?.name)}`,
    [editorRoot],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDraftName("");
  }, []);

  const startCreate = useCallback(() => {
    setDraftName("");
    setDialog({ mode: "create" });
  }, []);

  const startRename = useCallback((project) => {
    setDraftName(project.name);
    setDialog({ mode: "rename", project });
  }, []);

  const startDelete = useCallback((project) => {
    setDialog({ mode: "delete", project });
  }, []);

  const submitDialog = useCallback(
    (event) => {
      event?.preventDefault?.();
      const trimmed = draftName.trim();
      if (dialog?.mode === "create") {
        if (!trimmed) {
          return;
        }
        const project = {
          id: generateProjectId(),
          name: trimmed,
          createdAt: new Date().toISOString(),
        };
        setProjects((current) => [project, ...current]);
        closeDialog();
        return;
      }
      if (dialog?.mode === "rename") {
        if (!trimmed) {
          return;
        }
        setProjects((current) =>
          current.map((entry) => (entry.id === dialog.project.id ? { ...entry, name: trimmed } : entry)),
        );
        closeDialog();
      }
    },
    [closeDialog, dialog, draftName],
  );

  const confirmDelete = useCallback(() => {
    if (dialog?.mode !== "delete") {
      return;
    }
    const targetId = dialog.project.id;
    setProjects((current) => current.filter((entry) => entry.id !== targetId));
    setOpenProjectId((current) => (current === targetId ? null : current));
    closeDialog();
  }, [closeDialog, dialog]);

  if (openProject) {
    return (
      <EditorRoot>
        <ProjectWorkbench
          editorRoot={projectPath(openProject)}
          onBack={() => setOpenProjectId(null)}
          project={openProject}
        />
        {dialog && (
          <EditorDialogs
            dialog={dialog}
            draftInputRef={draftInputRef}
            draftName={draftName}
            onClose={closeDialog}
            onConfirmDelete={confirmDelete}
            onDraftChange={setDraftName}
            onSubmit={submitDialog}
          />
        )}
      </EditorRoot>
    );
  }

  return (
    <EditorRoot>
      <GalleryScroll>
        <GalleryHeader>
          <div>
            <PanelKicker>Editor · Local only</PanelKicker>
            <PanelHeading>Projects</PanelHeading>
            <GallerySubhead>
              Lightweight WebM media timelines stored on this device. Nothing here syncs to the cloud.
            </GallerySubhead>
          </div>
          <PrimaryButton onClick={startCreate} type="button">
            <ButtonIcon as={Add} aria-hidden="true" />
            <span>New project</span>
          </PrimaryButton>
        </GalleryHeader>

        {projects.length === 0 ? (
          <EmptyState>
            <EmptyGlyph aria-hidden="true">
              <Movie />
            </EmptyGlyph>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDetail>
              Create your first project to start arranging clips and audio on a local timeline.
            </EmptyDetail>
            <PrimaryButton onClick={startCreate} type="button">
              <ButtonIcon as={Add} aria-hidden="true" />
              <span>Create your first project</span>
            </PrimaryButton>
          </EmptyState>
        ) : (
          <ProjectGrid>
            {projects.map((project) => (
              <ProjectCard key={project.id}>
                <CardThumb aria-hidden="true">
                  <Movie />
                </CardThumb>
                <CardBody>
                  <CardName title={project.name}>{project.name}</CardName>
                  <CardMeta>{formatCreatedAt(project.createdAt)}</CardMeta>
                  <CardPath title={projectPath(project)}>{projectPath(project)}</CardPath>
                </CardBody>
                <CardHoverLayer>
                  <CardPrimaryAction onClick={() => setOpenProjectId(project.id)} type="button">
                    <ButtonIcon as={OpenInFull} aria-hidden="true" />
                    <span>Open</span>
                  </CardPrimaryAction>
                  <CardSecondaryActions>
                    <CardIconButton
                      aria-label={`Rename ${project.name}`}
                      onClick={() => startRename(project)}
                      title="Rename"
                      type="button"
                    >
                      <DriveFileRenameOutline aria-hidden="true" />
                    </CardIconButton>
                    <CardIconButton
                      aria-label={`Delete ${project.name}`}
                      data-variant="danger"
                      onClick={() => startDelete(project)}
                      title="Delete"
                      type="button"
                    >
                      <DeleteOutline aria-hidden="true" />
                    </CardIconButton>
                  </CardSecondaryActions>
                </CardHoverLayer>
              </ProjectCard>
            ))}
          </ProjectGrid>
        )}
      </GalleryScroll>

      {dialog && (
        <EditorDialogs
          dialog={dialog}
          draftInputRef={draftInputRef}
          draftName={draftName}
          onClose={closeDialog}
          onConfirmDelete={confirmDelete}
          onDraftChange={setDraftName}
          onSubmit={submitDialog}
        />
      )}
    </EditorRoot>
  );
}

function ProjectWorkbench({ project, editorRoot, onBack }) {
  const scaffold = useMemo(() => projectScaffold(project), [project]);

  return (
    <Workbench>
      <WorkbenchHeader>
        <BackButton onClick={onBack} type="button">
          <ButtonIcon as={ArrowBack} aria-hidden="true" />
          <span>Projects</span>
        </BackButton>
        <WorkbenchTitleGroup>
          <WorkbenchTitle title={project.name}>{project.name}</WorkbenchTitle>
          <WorkbenchPath title={editorRoot}>{editorRoot}</WorkbenchPath>
        </WorkbenchTitleGroup>
      </WorkbenchHeader>

      <WorkbenchBody>
        <FolderPane aria-label="Project files">
          <PaneHeader>
            <PaneHeaderIcon as={FolderOpen} aria-hidden="true" />
            <PaneHeaderText>Project files</PaneHeaderText>
          </PaneHeader>
          <FolderPath title={editorRoot}>{editorRoot}</FolderPath>
          <FileTree>
            {scaffold.map((entry, index) => (
              <FileTreeRow key={`${entry.name}-${index}`} style={{ paddingLeft: `${12 + entry.depth * 16}px` }}>
                <FileTreeIcon entry={entry} />
                <FileTreeName data-kind={entry.kind}>{entry.name}</FileTreeName>
              </FileTreeRow>
            ))}
          </FileTree>
          <FolderHint>Imported clips and generated assets will appear here.</FolderHint>
        </FolderPane>

        <StagePane>
          <ViewerPane aria-label="WebM viewer">
            <ViewerFrame>
              <ViewerEmpty>
                <ViewerGlyph aria-hidden="true">
                  <Videocam />
                </ViewerGlyph>
                <ViewerEmptyText>No clip selected</ViewerEmptyText>
                <ViewerEmptyHint>The WebM preview renders here.</ViewerEmptyHint>
              </ViewerEmpty>
            </ViewerFrame>
            <TransportBar>
              <TransportButton aria-label="Play" disabled title="Play" type="button">
                <PlayArrow aria-hidden="true" />
              </TransportButton>
              <TransportTime>0:00 / 0:00</TransportTime>
            </TransportBar>
          </ViewerPane>

          <TimelinePane aria-label="Timeline">
            <TimelineHeader>
              <PaneHeaderText>Timeline</PaneHeaderText>
              <TimelineZoomHint>WebM · VP9 + Opus</TimelineZoomHint>
            </TimelineHeader>
            <TimelineScroll>
              <TimelineRuler>
                <TimelineTrackGutter />
                <TimelineRulerTrack>
                  {TIMELINE_RULER_MARKS.map((mark) => (
                    <TimelineTick key={mark}>{mark}</TimelineTick>
                  ))}
                </TimelineRulerTrack>
              </TimelineRuler>

              <TimelineTrack>
                <TimelineTrackLabel>
                  <TrackIcon as={Movie} aria-hidden="true" />
                  <span>Video</span>
                </TimelineTrackLabel>
                <TimelineLane data-track="video">
                  <TimelineLanePlaceholder>Drop or generate video clips</TimelineLanePlaceholder>
                </TimelineLane>
              </TimelineTrack>

              <TimelineTrack>
                <TimelineTrackLabel>
                  <TrackIcon as={GraphicEq} aria-hidden="true" />
                  <span>Audio</span>
                </TimelineTrackLabel>
                <TimelineLane data-track="audio">
                  <TimelineLanePlaceholder>Drop or generate audio</TimelineLanePlaceholder>
                </TimelineLane>
              </TimelineTrack>

              <TimelinePlayhead aria-hidden="true" />
            </TimelineScroll>
          </TimelinePane>
        </StagePane>
      </WorkbenchBody>
    </Workbench>
  );
}

function EditorDialogs({ dialog, draftInputRef, draftName, onClose, onConfirmDelete, onDraftChange, onSubmit }) {
  const isDelete = dialog.mode === "delete";

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <DialogScrim onMouseDown={onClose}>
      <DialogCard onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <DialogHeader>
          <div>
            <PanelKicker>{isDelete ? "Delete project" : dialog.mode === "create" ? "New project" : "Rename project"}</PanelKicker>
            <PanelHeading>
              {isDelete ? dialog.project.name : dialog.mode === "create" ? "Create a project" : "Rename project"}
            </PanelHeading>
          </div>
          <DialogClose aria-label="Close" onClick={onClose} type="button">
            <Close aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        {isDelete ? (
          <>
            <DialogBody>
              This permanently removes <strong>{dialog.project.name}</strong> and its timeline from this device. This
              can&apos;t be undone.
            </DialogBody>
            <DialogActions>
              <SecondaryButton onClick={onClose} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton onClick={onConfirmDelete} type="button">
                <ButtonIcon as={DeleteOutline} aria-hidden="true" />
                <span>Delete project</span>
              </PrimaryDangerButton>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogLabel htmlFor="editor-project-name">Project name</DialogLabel>
            <DialogInput
              autoComplete="off"
              id="editor-project-name"
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Untitled project"
              ref={draftInputRef}
              spellCheck={false}
              value={draftName}
            />
            <DialogActions>
              <SecondaryButton onClick={onClose} type="button">
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryButton disabled={!draftName.trim()} type="submit">
                <ButtonIcon as={dialog.mode === "create" ? Add : DriveFileRenameOutline} aria-hidden="true" />
                <span>{dialog.mode === "create" ? "Create project" : "Save name"}</span>
              </PrimaryButton>
            </DialogActions>
          </form>
        )}
      </DialogCard>
    </DialogScrim>
  );
}

/* ------------------------------------------------------------------ styles */

const GOLDEN_RATIO = 1.618;

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const EditorRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  color: var(--forge-text);
`;

const GalleryScroll = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 26px 30px 36px;
  overflow-y: auto;
`;

const GalleryHeader = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
`;

const GallerySubhead = styled.p`
  margin: 8px 0 0;
  max-width: 56ch;
  color: var(--forge-text-muted);
  font-size: 13px;
  line-height: 1.5;
`;

const ProjectGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 18px;
`;

const ProjectCard = styled.article`
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: ${GOLDEN_RATIO} / 1;
  border: 1px solid var(--forge-border);
  border-radius: 14px;
  background: var(--forge-surface-raised);
  overflow: hidden;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 14px 32px rgba(2, 6, 23, 0.5);
    transform: translateY(-2px);
  }
`;

const CardThumb = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 30% 25%, rgba(var(--forge-accent-rgb), 0.22), transparent 60%),
    linear-gradient(135deg, rgba(13, 17, 23, 0.4), rgba(2, 4, 8, 0.6));
  border-bottom: 1px solid var(--forge-border);

  svg {
    width: 34px;
    height: 34px;
    color: rgba(var(--forge-accent-soft-rgb), 0.85);
  }
`;

const CardBody = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px 14px;
`;

const CardName = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardMeta = styled.span`
  font-size: 11.5px;
  color: var(--forge-text-muted);
`;

const CardPath = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
  font-family: var(--forge-mono-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardHoverLayer = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(2, 4, 8, 0.72), rgba(2, 4, 8, 0.86));
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;

  ${ProjectCard}:hover &,
  ${ProjectCard}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const CardPrimaryAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border: 1px solid rgba(125, 160, 205, 0.3);
  border-radius: 999px;
  background: var(--forge-blue);
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
  transition: background 150ms ease, transform 150ms ease;

  &:hover {
    background: var(--forge-blue-soft);
    transform: translateY(-1px);
  }
`;

const CardSecondaryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CardIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.85);
  color: var(--forge-text-soft);
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
    background: var(--forge-surface-control);
  }

  &[data-variant="danger"]:hover {
    border-color: rgba(239, 107, 107, 0.6);
    color: var(--forge-red);
  }
`;

const ButtonIcon = styled.span`
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;

  svg {
    width: 100%;
    height: 100%;
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 60px 20px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 18px;
  background: rgba(13, 17, 23, 0.3);
`;

const EmptyGlyph = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: rgba(var(--forge-accent-rgb), 0.12);
  color: var(--forge-accent-soft);

  svg {
    width: 30px;
    height: 30px;
  }
`;

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 17px;
  color: var(--forge-text);
`;

const EmptyDetail = styled.p`
  margin: 0;
  max-width: 42ch;
  color: var(--forge-text-muted);
  font-size: 13px;
  line-height: 1.5;
`;

/* ------------------------------------------------------------- workbench */

const Workbench = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
`;

const WorkbenchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--forge-border);
  background: var(--forge-shell-right-bg);
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: rgba(21, 27, 35, 0.7);
  color: var(--forge-text-soft);
  font-weight: 600;
  font-size: 12.5px;
  transition: border-color 150ms ease, color 150ms ease;

  &:hover {
    border-color: var(--forge-accent-selected-border);
    color: var(--forge-text);
  }
`;

const WorkbenchTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const WorkbenchTitle = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--forge-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchPath = styled.span`
  font-size: 11px;
  color: var(--forge-text-muted);
  font-family: var(--forge-mono-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchBody = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
`;

const FolderPane = styled.aside`
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--forge-border);
  background: var(--forge-shell-right-muted-bg);
`;

const PaneHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--forge-border);
`;

const PaneHeaderIcon = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);

  svg {
    width: 100%;
    height: 100%;
  }
`;

const PaneHeaderText = styled.span`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-soft);
`;

const FolderPath = styled.div`
  padding: 8px 14px;
  font-size: 11px;
  color: var(--forge-text-muted);
  font-family: var(--forge-mono-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  border-bottom: 1px solid var(--forge-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileTree = styled.div`
  display: flex;
  flex-direction: column;
  padding: 8px 6px;
  gap: 1px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
`;

const FileTreeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: default;

  &:hover {
    background: var(--forge-surface-hover);
  }

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }
`;

const TreeFolderIcon = styled(Folder)`
  color: var(--forge-accent-soft);
`;

const TreeFileIcon = styled(Description)`
  color: var(--forge-text-muted);
`;

const TreeTimelineIcon = styled(Movie)`
  color: var(--forge-amber);
`;

const FileTreeName = styled.span`
  font-size: 13px;
  color: var(--forge-text-soft);

  &[data-kind="dir"] {
    color: var(--forge-text);
    font-weight: 600;
  }
`;

const FolderHint = styled.p`
  margin: 0;
  padding: 12px 14px;
  font-size: 11.5px;
  color: var(--forge-text-disabled);
  border-top: 1px solid var(--forge-border);
`;

const StagePane = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(180px, 38%);
  min-width: 0;
  min-height: 0;
`;

const ViewerPane = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 18px;
  gap: 12px;
  border-bottom: 1px solid var(--forge-border);
`;

const ViewerFrame = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 40%, rgba(13, 17, 23, 0.5), rgba(2, 3, 4, 0.92));
  overflow: hidden;
`;

const ViewerEmpty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
`;

const ViewerGlyph = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--forge-text-muted);

  svg {
    width: 28px;
    height: 28px;
  }
`;

const ViewerEmptyText = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--forge-text-soft);
`;

const ViewerEmptyHint = styled.span`
  font-size: 12px;
  color: var(--forge-text-disabled);
`;

const TransportBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
`;

const TransportButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--forge-border);
  border-radius: 9px;
  background: var(--forge-surface-control);
  color: var(--forge-text-soft);

  svg {
    width: 20px;
    height: 20px;
  }

  &:disabled {
    opacity: 0.5;
  }
`;

const TransportTime = styled.span`
  font-size: 12px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
`;

const TimelinePane = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--forge-shell-right-muted-bg);
`;

const TimelineHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--forge-border);
`;

const TimelineZoomHint = styled.span`
  font-size: 11px;
  color: var(--forge-text-disabled);
  letter-spacing: 0.02em;
`;

const TimelineScroll = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 8px;
`;

const TRACK_GUTTER_WIDTH = "120px";

const TimelineRuler = styled.div`
  display: grid;
  grid-template-columns: ${TRACK_GUTTER_WIDTH} minmax(0, 1fr);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--forge-shell-right-muted-bg);
  border-bottom: 1px solid var(--forge-border);
`;

const TimelineTrackGutter = styled.div`
  border-right: 1px solid var(--forge-border);
`;

const TimelineRulerTrack = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  padding: 6px 0;

  > * {
    flex: 1 1 0;
  }
`;

const TimelineTick = styled.span`
  font-size: 10.5px;
  color: var(--forge-text-disabled);
  padding-left: 8px;
  border-left: 1px solid var(--forge-border);
  font-variant-numeric: tabular-nums;

  &:first-child {
    border-left: none;
  }
`;

const TimelineTrack = styled.div`
  display: grid;
  grid-template-columns: ${TRACK_GUTTER_WIDTH} minmax(0, 1fr);
  border-bottom: 1px solid var(--forge-border);
  min-height: 64px;
`;

const TimelineTrackLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-right: 1px solid var(--forge-border);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--forge-text-soft);
  background: rgba(13, 17, 23, 0.4);
`;

const TrackIcon = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);

  svg {
    width: 100%;
    height: 100%;
  }
`;

const TimelineLane = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 10px;
  background-image: repeating-linear-gradient(
    90deg,
    transparent,
    transparent calc(100% / 6 - 1px),
    var(--forge-border) calc(100% / 6 - 1px),
    var(--forge-border) calc(100% / 6)
  );

  &[data-track="audio"] {
    background-color: rgba(60, 203, 127, 0.03);
  }
`;

const TimelineLanePlaceholder = styled.span`
  font-size: 11.5px;
  color: var(--forge-text-disabled);
  font-style: italic;
`;

const TimelinePlayhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${TRACK_GUTTER_WIDTH};
  width: 2px;
  background: var(--forge-accent);
  box-shadow: 0 0 8px rgba(var(--forge-accent-rgb), 0.6);
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: -4px;
    width: 10px;
    height: 8px;
    background: var(--forge-accent);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
`;

/* ---------------------------------------------------------------- dialogs */

const DialogScrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 4, 8, 0.62);
  backdrop-filter: blur(2px);
  animation: ${fadeIn} 140ms ease both;
`;

const DialogCard = styled.div`
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px 22px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 16px;
  background: var(--forge-surface-raised);
  box-shadow: 0 30px 60px rgba(2, 6, 23, 0.6);
  animation: ${popIn} 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
`;

const DialogHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const DialogClose = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--forge-text-muted);

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    border-color: var(--forge-border);
    color: var(--forge-text);
  }
`;

const DialogBody = styled.p`
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--forge-text-soft);

  strong {
    color: var(--forge-text);
  }
`;

const DialogLabel = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: var(--forge-text-soft);
`;

const DialogInput = styled.input`
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 10px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 14px;
  transition: border-color 150ms ease, box-shadow 150ms ease;

  &:focus {
    outline: none;
    border-color: var(--forge-accent-selected-border);
    box-shadow: 0 0 0 3px var(--forge-accent-selected-ring);
  }

  &::placeholder {
    color: var(--forge-text-disabled);
  }
`;

const DialogActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
`;

export default EditorWorkspaceView;
