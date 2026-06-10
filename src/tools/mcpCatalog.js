import { Amazonaws } from "@styled-icons/simple-icons/Amazonaws";
import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Github } from "@styled-icons/simple-icons/Github";
import { Gitlab } from "@styled-icons/simple-icons/Gitlab";
import { Googlecloud } from "@styled-icons/simple-icons/Googlecloud";
import { Notion } from "@styled-icons/simple-icons/Notion";
import { Postgresql } from "@styled-icons/simple-icons/Postgresql";
import { Redis } from "@styled-icons/simple-icons/Redis";
import { Sentry } from "@styled-icons/simple-icons/Sentry";
import { Slack } from "@styled-icons/simple-icons/Slack";
import { Sqlite } from "@styled-icons/simple-icons/Sqlite";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";

/**
 * Curated catalog of popular MCP servers. `command` is what the marketplace
 * box in the MCPs manager parses (npx-style stdio launch), so "Copy command"
 * → paste → add is the whole flow.
 */
export const MCP_CATALOG = [
  { id: "filesystem", label: "Filesystem", command: "npx -y @modelcontextprotocol/server-filesystem", icon: null },
  { id: "memory", label: "Memory", command: "npx -y @modelcontextprotocol/server-memory", icon: null },
  { id: "fetch", label: "Fetch", command: "npx -y @modelcontextprotocol/server-fetch", icon: null },
  { id: "sequential-thinking", label: "Sequential Thinking", command: "npx -y @modelcontextprotocol/server-sequential-thinking", icon: null },
  { id: "github", label: "GitHub", command: "npx -y @modelcontextprotocol/server-github", icon: Github },
  { id: "gitlab", label: "GitLab", command: "npx -y @modelcontextprotocol/server-gitlab", icon: Gitlab },
  { id: "postgres", label: "PostgreSQL", command: "npx -y @modelcontextprotocol/server-postgres", icon: Postgresql },
  { id: "sqlite", label: "SQLite", command: "npx -y mcp-server-sqlite-npx", icon: Sqlite },
  { id: "redis", label: "Redis", command: "npx -y @modelcontextprotocol/server-redis", icon: Redis },
  { id: "slack", label: "Slack", command: "npx -y @modelcontextprotocol/server-slack", icon: Slack },
  { id: "puppeteer", label: "Puppeteer", command: "npx -y @modelcontextprotocol/server-puppeteer", icon: null },
  { id: "playwright", label: "Playwright", command: "npx -y @playwright/mcp", icon: null },
  { id: "stripe", label: "Stripe", command: "npx -y @stripe/mcp", icon: Stripe },
  { id: "supabase", label: "Supabase", command: "npx -y @supabase/mcp-server-supabase", icon: Supabase },
  { id: "notion", label: "Notion", command: "npx -y @notionhq/notion-mcp-server", icon: Notion },
  { id: "sentry", label: "Sentry", command: "npx -y @sentry/mcp-server", icon: Sentry },
  { id: "cloudflare", label: "Cloudflare", command: "npx -y @cloudflare/mcp-server-cloudflare", icon: Cloudflare },
  { id: "aws", label: "AWS", command: "npx -y @aws/mcp-server-aws", icon: Amazonaws },
  { id: "gcloud", label: "Google Cloud", command: "npx -y @google-cloud/mcp", icon: Googlecloud },
  { id: "brave-search", label: "Brave Search", command: "npx -y @modelcontextprotocol/server-brave-search", icon: null },
  { id: "exa", label: "Exa Search", command: "npx -y exa-mcp-server", icon: null },
  { id: "firecrawl", label: "Firecrawl", command: "npx -y firecrawl-mcp", icon: null },
  { id: "context7", label: "Context7 Docs", command: "npx -y @upstash/context7-mcp", icon: null },
  { id: "linear", label: "Linear", command: "npx -y mcp-remote https://mcp.linear.app/sse", icon: null },
  { id: "figma", label: "Figma", command: "npx -y figma-developer-mcp", icon: null },
  { id: "everart", label: "EverArt", command: "npx -y @modelcontextprotocol/server-everart", icon: null },
  { id: "gdrive", label: "Google Drive", command: "npx -y @modelcontextprotocol/server-gdrive", icon: null },
  { id: "google-maps", label: "Google Maps", command: "npx -y @modelcontextprotocol/server-google-maps", icon: null },
];
