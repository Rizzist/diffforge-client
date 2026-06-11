import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Figma } from "@styled-icons/simple-icons/Figma";
import { Github } from "@styled-icons/simple-icons/Github";
import { Gitlab } from "@styled-icons/simple-icons/Gitlab";
import { Googlemaps } from "@styled-icons/simple-icons/Googlemaps";
import { Notion } from "@styled-icons/simple-icons/Notion";
import { Sentry } from "@styled-icons/simple-icons/Sentry";
import { Slack } from "@styled-icons/simple-icons/Slack";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";

function env(key, label, { required = true, secret = true, description = "" } = {}) {
  return { key, label, description, required, secret, source: "catalog" };
}

/**
 * Curated catalog of popular MCP servers, installable in one click from the
 * MCPs tab. Every entry launches over stdio through the workspace gateway
 * (which serves both Claude Code and Codex); `args` is the full npx argv and
 * `env` describes the config the server needs before it can be enabled.
 * Entries without `env` work immediately after install.
 */
export const MCP_CATALOG = [
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Read, write, and search files in the workspace directory.",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    packageRef: "@modelcontextprotocol/server-filesystem",
    icon: null,
    env: [],
  },
  {
    id: "memory",
    label: "Memory",
    description: "Persistent knowledge-graph memory across agent sessions.",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    packageRef: "@modelcontextprotocol/server-memory",
    icon: null,
    env: [],
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "Fetch web pages and convert them to agent-friendly markdown.",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    packageRef: "@modelcontextprotocol/server-fetch",
    icon: null,
    env: [],
  },
  {
    id: "sequential-thinking",
    label: "Sequential Thinking",
    description: "Structured step-by-step reasoning scratchpad for hard problems.",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    packageRef: "@modelcontextprotocol/server-sequential-thinking",
    icon: null,
    env: [],
  },
  {
    id: "playwright",
    label: "Playwright",
    description: "Drive a real browser: navigate, click, screenshot, and scrape.",
    args: ["-y", "@playwright/mcp"],
    packageRef: "@playwright/mcp",
    icon: null,
    env: [],
  },
  {
    id: "puppeteer",
    label: "Puppeteer",
    description: "Headless Chrome automation and page capture.",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    packageRef: "@modelcontextprotocol/server-puppeteer",
    icon: null,
    env: [],
  },
  {
    id: "context7",
    label: "Context7 Docs",
    description: "Up-to-date library documentation injected into agent context.",
    args: ["-y", "@upstash/context7-mcp"],
    packageRef: "@upstash/context7-mcp",
    icon: null,
    env: [],
  },
  {
    id: "github",
    label: "GitHub",
    description: "Issues, pull requests, repos, and code search on GitHub.",
    args: ["-y", "@modelcontextprotocol/server-github"],
    packageRef: "@modelcontextprotocol/server-github",
    icon: Github,
    env: [env("GITHUB_PERSONAL_ACCESS_TOKEN", "Personal access token")],
  },
  {
    id: "gitlab",
    label: "GitLab",
    description: "Projects, merge requests, and issues on GitLab.",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    packageRef: "@modelcontextprotocol/server-gitlab",
    icon: Gitlab,
    env: [
      env("GITLAB_PERSONAL_ACCESS_TOKEN", "Personal access token"),
      env("GITLAB_API_URL", "API URL", { required: false, secret: false }),
    ],
  },
  {
    id: "slack",
    label: "Slack",
    description: "Read channels and post messages in your Slack workspace.",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    packageRef: "@modelcontextprotocol/server-slack",
    icon: Slack,
    env: [
      env("SLACK_BOT_TOKEN", "Bot token"),
      env("SLACK_TEAM_ID", "Team ID", { secret: false }),
    ],
  },
  {
    id: "linear",
    label: "Linear",
    description: "Linear issues, projects, and cycles (OAuth on first use).",
    args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"],
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "notion",
    label: "Notion",
    description: "Search and edit Notion pages and databases.",
    args: ["-y", "@notionhq/notion-mcp-server"],
    packageRef: "@notionhq/notion-mcp-server",
    icon: Notion,
    env: [env("NOTION_TOKEN", "Internal integration token")],
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Inspect customers, payments, and products in Stripe.",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    packageRef: "@stripe/mcp",
    icon: Stripe,
    env: [env("STRIPE_SECRET_KEY", "Secret key")],
  },
  {
    id: "supabase",
    label: "Supabase",
    description: "Manage Supabase projects, database, and edge functions.",
    args: ["-y", "@supabase/mcp-server-supabase"],
    packageRef: "@supabase/mcp-server-supabase",
    icon: Supabase,
    env: [env("SUPABASE_ACCESS_TOKEN", "Access token")],
  },
  {
    id: "sentry",
    label: "Sentry",
    description: "Query Sentry issues, events, and releases.",
    args: ["-y", "@sentry/mcp-server"],
    packageRef: "@sentry/mcp-server",
    icon: Sentry,
    env: [env("SENTRY_AUTH_TOKEN", "Auth token")],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    description: "Workers, KV, R2, and DNS through Cloudflare's MCP.",
    args: ["-y", "@cloudflare/mcp-server-cloudflare"],
    packageRef: "@cloudflare/mcp-server-cloudflare",
    icon: Cloudflare,
    env: [
      env("CLOUDFLARE_API_TOKEN", "API token"),
      env("CLOUDFLARE_ACCOUNT_ID", "Account ID", { secret: false }),
    ],
  },
  {
    id: "figma",
    label: "Figma",
    description: "Read Figma files and design tokens for implementation.",
    args: ["-y", "figma-developer-mcp", "--stdio"],
    packageRef: "figma-developer-mcp",
    icon: Figma,
    env: [env("FIGMA_API_KEY", "Personal access token")],
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search with the Brave Search API.",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    packageRef: "@modelcontextprotocol/server-brave-search",
    icon: null,
    env: [env("BRAVE_API_KEY", "API key")],
  },
  {
    id: "exa",
    label: "Exa Search",
    description: "Semantic web search and research with Exa.",
    args: ["-y", "exa-mcp-server"],
    packageRef: "exa-mcp-server",
    icon: null,
    env: [env("EXA_API_KEY", "API key")],
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    description: "Crawl and scrape websites into clean markdown.",
    args: ["-y", "firecrawl-mcp"],
    packageRef: "firecrawl-mcp",
    icon: null,
    env: [env("FIRECRAWL_API_KEY", "API key")],
  },
  {
    id: "google-maps",
    label: "Google Maps",
    description: "Geocoding, places, and directions via Google Maps.",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    packageRef: "@modelcontextprotocol/server-google-maps",
    icon: Googlemaps,
    env: [env("GOOGLE_MAPS_API_KEY", "API key")],
  },
];

/** Builds the install input for coordination_install_workspace_mcp_server. */
export function mcpCatalogInstallInput(entry, workspaceName) {
  const envSchema = Array.isArray(entry?.env) ? entry.env : [];
  const requiresConfig = envSchema.some((item) => item?.required);
  return {
    workspace_name: workspaceName,
    name: entry.label,
    server_key: entry.id,
    source_kind: "catalog",
    source_label: "Popular",
    package_ref: entry.packageRef || "",
    version: "",
    transport: "stdio",
    command: "npx",
    args: entry.args || [],
    url: "",
    env_schema: envSchema,
    tools: [],
    // No-config servers are usable the moment they are installed; servers
    // that need keys stay disabled until the user fills in the config.
    workspace_enabled: !requiresConfig,
    approval_policy: "always_allow",
    exposure_mode: "lazy",
    agent_config_access_enabled: true,
    agent_secret_config_access_enabled: false,
    agent_env_file_write_enabled: true,
  };
}
