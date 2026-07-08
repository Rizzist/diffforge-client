// Assistant markdown rendering for the transcript: react-markdown +
// remark-gfm + rehype-sanitize (GitHub schema), with shiki-highlighted code
// blocks. The hand-rolled dashboard markdown parser remains untouched for the
// panels that still use it — the transcript body uses this pipeline only.

import { Children, Component, cloneElement, isValidElement, memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ContentCopy as ContentCopyIcon } from "@styled-icons/material-rounded/ContentCopy";
import { Check as CheckIcon } from "@styled-icons/material-rounded/Check";
import { CallMade as ExternalIcon } from "@styled-icons/material-rounded/CallMade";

import { codeLanguageToken } from "./builders.mjs";
import { cachedHighlightHtml, highlightCodeHtml } from "./shikiHighlight";
import {
  CodeBlockFrame,
  CodeBlockHeader,
  CodeBlockScroll,
  GhostActionButton,
  InlineCode,
  MarkdownBody,
  PathChip,
  SafeLink,
  TableScroll,
} from "./styles";

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code || []),
      ["className", /^language-[\w+#-]*$/],
    ],
  },
};

export async function copyTranscriptText(value = "") {
  const text = String(value ?? "");
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "true");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      return true;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text = "", label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!text) return null;
  return (
    <GhostActionButton
      aria-label={label}
      onClick={() => {
        void copyTranscriptText(text).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
      type="button"
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <ContentCopyIcon aria-hidden="true" />}
      {copied ? "Copied" : label}
    </GhostActionButton>
  );
}

/* ------------------------------------------------------------------ */
/* Code block                                                          */
/* ------------------------------------------------------------------ */

class CodeBlockBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.failed) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

function PlainCode({ code = "" }) {
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

function HighlightedCode({ code = "", language = "", live = false }) {
  // Bypass highlighting entirely while the message is still updating: plain
  // text is cheaper and avoids re-tokenizing every streamed delta.
  const bypass = live || !language;
  // html: string = highlighted, null = unknown yet, false = unavailable.
  const [state, setState] = useState(() => ({
    bypass,
    code,
    language,
    html: bypass ? false : cachedHighlightHtml(code, language),
  }));
  if (state.code !== code || state.language !== language || state.bypass !== bypass) {
    // Render-time reset keyed by content + live mode: probe the LRU
    // synchronously so already-highlighted blocks never flash plain, and so
    // settling turns (live -> false) pick up highlighting.
    setState({
      bypass,
      code,
      language,
      html: bypass ? false : cachedHighlightHtml(code, language),
    });
  }
  const pending = !bypass && state.html === null;
  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    void highlightCodeHtml(code, language).then((result) => {
      if (cancelled) return;
      setState((current) => (
        current.code === code && current.language === language
          ? { ...current, html: result ?? false }
          : current
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, pending]);
  if (bypass || typeof state.html !== "string" || !state.html) {
    return <PlainCode code={code} />;
  }
  // shiki output is trusted generated markup (it HTML-escapes all content).
  return <div dangerouslySetInnerHTML={{ __html: state.html }} />;
}

// Renders one shiki-highlighted line (diff hunk rows). The html is shiki
// output (trusted generated markup — shiki HTML-escapes all content); this
// component keeps every raw-html injection scoped to this file.
export function ShikiLineCode({ html = "" }) {
  return <code className="shiki" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const TranscriptCodeBlock = memo(function TranscriptCodeBlock({
  code = "",
  language = "",
  live = false,
}) {
  const lang = codeLanguageToken(language);
  return (
    <CodeBlockFrame>
      <CodeBlockHeader>
        <span>{lang || "text"}</span>
        <CopyButton text={code} />
      </CodeBlockHeader>
      <CodeBlockScroll>
        <CodeBlockBoundary fallback={<PlainCode code={code} />}>
          <HighlightedCode code={code} language={lang} live={live} />
        </CodeBlockBoundary>
      </CodeBlockScroll>
    </CodeBlockFrame>
  );
});

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

function nodeToText(children) {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeToText).join("");
  if (typeof children === "object" && children.props) return nodeToText(children.props.children);
  return "";
}

// Mirrors the legacy agentThreadMarkdownLinkTargetKind: http(s) targets open
// as links, path-like targets render as inert chips, anything else stays
// plain text.
function markdownLinkTargetKind(target = "") {
  const cleaned = String(target ?? "").trim().replace(/^<|>$/g, "");
  if (/^https?:\/\//i.test(cleaned)) {
    return "url";
  }
  if (
    /^~?\//.test(cleaned)
    || /^\.{1,2}\//.test(cleaned)
    || /^[A-Za-z0-9_.-]+\/[^\s]+/.test(cleaned)
    || /^[A-Za-z0-9_.-]+\.(?:[A-Za-z0-9]{1,8})(?::\d+)?$/.test(cleaned)
  ) {
    return "path";
  }
  return "";
}

function buildComponents(live) {
  return {
    a({ href = "", children, node, ...props }) {
      const targetKind = markdownLinkTargetKind(href);
      if (targetKind === "url") {
        return (
          <SafeLink
            {...props}
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {children}
            <ExternalIcon aria-hidden="true" />
          </SafeLink>
        );
      }
      if (targetKind === "path") {
        return <PathChip title={href}>{children}</PathChip>;
      }
      return <span>{children}</span>;
    },
    pre({ children }) {
      // The code component renders the full block frame; unwrap <pre> and mark
      // its children so single-line no-language fences still render as blocks.
      return (
        <>
          {Children.map(children, (child) => (
            isValidElement(child) ? cloneElement(child, { "data-block-code": true }) : child
          ))}
        </>
      );
    },
    code({ className = "", children, node, "data-block-code": blockCode, ...props }) {
      const text = nodeToText(children);
      const languageMatch = /language-([\w+#-]+)/.exec(className || "");
      const isBlock = Boolean(blockCode) || Boolean(languageMatch) || text.includes("\n");
      if (!isBlock) {
        return <InlineCode {...props}>{children}</InlineCode>;
      }
      return (
        <TranscriptCodeBlock
          code={text.replace(/\n$/, "")}
          language={languageMatch?.[1] || ""}
          live={live}
        />
      );
    },
    table({ children, node, ...props }) {
      return (
        <TableScroll>
          <table {...props}>{children}</table>
        </TableScroll>
      );
    },
  };
}

export const TranscriptMarkdown = memo(function TranscriptMarkdown({
  content = "",
  live = false,
}) {
  const components = useMemo(() => buildComponents(live), [live]);
  if (!content) return null;
  return (
    <MarkdownBody>
      <ReactMarkdown
        components={components}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </MarkdownBody>
  );
});
