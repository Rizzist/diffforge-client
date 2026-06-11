import { Airtable } from "@styled-icons/simple-icons/Airtable";
import { Asana } from "@styled-icons/simple-icons/Asana";
import { Atlassian } from "@styled-icons/simple-icons/Atlassian";
import { Auth0 } from "@styled-icons/simple-icons/Auth0";
import { Brave } from "@styled-icons/simple-icons/Brave";
import { Canva } from "@styled-icons/simple-icons/Canva";
import { Circleci } from "@styled-icons/simple-icons/Circleci";
import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Digitalocean } from "@styled-icons/simple-icons/Digitalocean";
import { Discord } from "@styled-icons/simple-icons/Discord";
import { Elasticsearch } from "@styled-icons/simple-icons/Elasticsearch";
import { Figma } from "@styled-icons/simple-icons/Figma";
import { Firebase } from "@styled-icons/simple-icons/Firebase";
import { Github } from "@styled-icons/simple-icons/Github";
import { Gitlab } from "@styled-icons/simple-icons/Gitlab";
import { Googlechrome } from "@styled-icons/simple-icons/Googlechrome";
import { Googlemaps } from "@styled-icons/simple-icons/Googlemaps";
import { Heroku } from "@styled-icons/simple-icons/Heroku";
import { Hubspot } from "@styled-icons/simple-icons/Hubspot";
import { Intercom } from "@styled-icons/simple-icons/Intercom";
import { Kubernetes } from "@styled-icons/simple-icons/Kubernetes";
import { Mapbox } from "@styled-icons/simple-icons/Mapbox";
import { Microsoftazure } from "@styled-icons/simple-icons/Microsoftazure";
import { Mongodb } from "@styled-icons/simple-icons/Mongodb";
import { Mysql } from "@styled-icons/simple-icons/Mysql";
import { Netlify } from "@styled-icons/simple-icons/Netlify";
import { Notion } from "@styled-icons/simple-icons/Notion";
import { Paypal } from "@styled-icons/simple-icons/Paypal";
import { Postman } from "@styled-icons/simple-icons/Postman";
import { Prisma } from "@styled-icons/simple-icons/Prisma";
import { Puppeteer } from "@styled-icons/simple-icons/Puppeteer";
import { Sentry } from "@styled-icons/simple-icons/Sentry";
import { Shopify } from "@styled-icons/simple-icons/Shopify";
import { Slack } from "@styled-icons/simple-icons/Slack";
import { Square } from "@styled-icons/simple-icons/Square";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";
import { Todoist } from "@styled-icons/simple-icons/Todoist";
import { Twilio } from "@styled-icons/simple-icons/Twilio";
import { Vercel } from "@styled-icons/simple-icons/Vercel";
import { Webflow } from "@styled-icons/simple-icons/Webflow";

function env(key, label, { required = true, secret = true, description = "" } = {}) {
  return { key, label, description, required, secret, source: "catalog" };
}

/** Remote MCP endpoints run through mcp-remote (OAuth happens on first use). */
function remote(url) {
  return ["-y", "mcp-remote", url];
}

/**
 * Curated catalog of popular MCP servers, installable in one click from the
 * MCPs tab. Every entry launches over stdio through the workspace gateway
 * (which serves both Claude Code and Codex); `args` is the full npx argv and
 * `env` describes the config the server needs before it can be enabled.
 * Entries without `env` work immediately after install.
 */
export const MCP_CATALOG = [
  // --- Core agent utilities ------------------------------------------------
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
    id: "desktop-commander",
    label: "Desktop Commander",
    description: "Terminal control, process management, and diff-based file edits.",
    args: ["-y", "@wonderwhy-er/desktop-commander"],
    packageRef: "@wonderwhy-er/desktop-commander",
    icon: null,
    env: [],
  },

  // --- Browsers & UI -------------------------------------------------------
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
    icon: Puppeteer,
    env: [],
  },
  {
    id: "chrome-devtools",
    label: "Chrome DevTools",
    description: "Debug live pages: console, network, performance traces.",
    args: ["-y", "chrome-devtools-mcp@latest"],
    packageRef: "chrome-devtools-mcp",
    icon: Googlechrome,
    env: [],
  },
  {
    id: "browserbase",
    label: "Browserbase",
    description: "Cloud headless browsers for agent automation at scale.",
    args: ["-y", "@browserbasehq/mcp"],
    packageRef: "@browserbasehq/mcp",
    icon: null,
    env: [
      env("BROWSERBASE_API_KEY", "API key"),
      env("BROWSERBASE_PROJECT_ID", "Project ID", { secret: false }),
    ],
  },
  {
    id: "shadcn",
    label: "shadcn/ui",
    description: "Browse and add shadcn/ui registry components to the project.",
    args: ["-y", "shadcn@latest", "mcp"],
    packageRef: "shadcn",
    icon: null,
    env: [],
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
    id: "canva",
    label: "Canva",
    description: "Generate and edit Canva designs (OAuth on first use).",
    args: remote("https://mcp.canva.com/mcp"),
    packageRef: "mcp-remote",
    icon: Canva,
    env: [],
  },

  // --- Docs, search & research ---------------------------------------------
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
    id: "deepwiki",
    label: "DeepWiki",
    description: "Ask questions about any public GitHub repo's architecture.",
    args: remote("https://mcp.deepwiki.com/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search with the Brave Search API.",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    packageRef: "@modelcontextprotocol/server-brave-search",
    icon: Brave,
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
    id: "tavily",
    label: "Tavily",
    description: "Search, extract, and crawl tuned for AI agents.",
    args: ["-y", "tavily-mcp"],
    packageRef: "tavily-mcp",
    icon: null,
    env: [env("TAVILY_API_KEY", "API key")],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Ask Perplexity Sonar for cited, up-to-date answers.",
    args: ["-y", "server-perplexity-ask"],
    packageRef: "server-perplexity-ask",
    icon: null,
    env: [env("PERPLEXITY_API_KEY", "API key")],
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
    id: "apify",
    label: "Apify",
    description: "Run 5000+ Apify scrapers and actors from the agent.",
    args: ["-y", "@apify/actors-mcp-server"],
    packageRef: "@apify/actors-mcp-server",
    icon: null,
    env: [env("APIFY_TOKEN", "API token")],
  },
  {
    id: "hugging-face",
    label: "Hugging Face",
    description: "Search models, datasets, papers, and Spaces on the Hub.",
    args: remote("https://huggingface.co/mcp"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "youtube-transcripts",
    label: "YouTube Transcripts",
    description: "Pull transcripts from YouTube videos for summarizing.",
    args: ["-y", "@kimtaeyoon83/mcp-server-youtube-transcript"],
    packageRef: "@kimtaeyoon83/mcp-server-youtube-transcript",
    icon: null,
    env: [],
  },

  // --- Code hosting & project tracking --------------------------------------
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
    id: "linear",
    label: "Linear",
    description: "Linear issues, projects, and cycles (OAuth on first use).",
    args: remote("https://mcp.linear.app/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "atlassian",
    label: "Jira & Confluence",
    description: "Atlassian issues, boards, and pages (OAuth on first use).",
    args: remote("https://mcp.atlassian.com/v1/sse"),
    packageRef: "mcp-remote",
    icon: Atlassian,
    env: [],
  },
  {
    id: "asana",
    label: "Asana",
    description: "Tasks, projects, and goals in Asana (OAuth on first use).",
    args: remote("https://mcp.asana.com/sse"),
    packageRef: "mcp-remote",
    icon: Asana,
    env: [],
  },
  {
    id: "todoist",
    label: "Todoist",
    description: "Manage Todoist tasks and projects in natural language.",
    args: ["-y", "@abhiz123/todoist-mcp-server"],
    packageRef: "@abhiz123/todoist-mcp-server",
    icon: Todoist,
    env: [env("TODOIST_API_TOKEN", "API token")],
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
    id: "monday",
    label: "monday.com",
    description: "Boards, items, and updates on monday.com (OAuth on first use).",
    args: remote("https://mcp.monday.com/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },

  // --- Communication & CRM --------------------------------------------------
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
    id: "discord",
    label: "Discord",
    description: "Read and send Discord messages through a bot account.",
    args: ["-y", "mcp-discord"],
    packageRef: "mcp-discord",
    icon: Discord,
    env: [env("DISCORD_TOKEN", "Bot token")],
  },
  {
    id: "intercom",
    label: "Intercom",
    description: "Customer conversations and tickets (OAuth on first use).",
    args: remote("https://mcp.intercom.com/sse"),
    packageRef: "mcp-remote",
    icon: Intercom,
    env: [],
  },
  {
    id: "hubspot",
    label: "HubSpot",
    description: "CRM contacts, companies, and deals in HubSpot.",
    args: ["-y", "@hubspot/mcp-server"],
    packageRef: "@hubspot/mcp-server",
    icon: Hubspot,
    env: [env("PRIVATE_APP_ACCESS_TOKEN", "Private app token")],
  },
  {
    id: "twilio",
    label: "Twilio",
    description: "Send SMS and manage Twilio resources.",
    args: ["-y", "@twilio-alpha/mcp"],
    packageRef: "@twilio-alpha/mcp",
    icon: Twilio,
    env: [
      env("TWILIO_ACCOUNT_SID", "Account SID", { secret: false }),
      env("TWILIO_API_KEY", "API key"),
      env("TWILIO_API_SECRET", "API secret"),
    ],
  },

  // --- Databases & storage ----------------------------------------------------
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
    id: "mongodb",
    label: "MongoDB",
    description: "Query and manage MongoDB clusters and Atlas projects.",
    args: ["-y", "mongodb-mcp-server"],
    packageRef: "mongodb-mcp-server",
    icon: Mongodb,
    env: [env("MDB_MCP_CONNECTION_STRING", "Connection string")],
  },
  {
    id: "mysql",
    label: "MySQL",
    description: "Inspect schemas and run queries against MySQL.",
    args: ["-y", "@benborla29/mcp-server-mysql"],
    packageRef: "@benborla29/mcp-server-mysql",
    icon: Mysql,
    env: [
      env("MYSQL_HOST", "Host", { secret: false }),
      env("MYSQL_USER", "User", { secret: false }),
      env("MYSQL_PASS", "Password"),
      env("MYSQL_DB", "Database", { secret: false }),
    ],
  },
  {
    id: "neon",
    label: "Neon",
    description: "Manage Neon serverless Postgres projects and branches.",
    args: ["-y", "@neondatabase/mcp-server-neon", "start"],
    packageRef: "@neondatabase/mcp-server-neon",
    icon: null,
    env: [env("NEON_API_KEY", "API key")],
  },
  {
    id: "convex",
    label: "Convex",
    description: "Inspect Convex deployments, run functions, and read data.",
    args: ["-y", "convex@latest", "mcp", "start"],
    packageRef: "convex",
    icon: null,
    env: [],
  },
  {
    id: "prisma",
    label: "Prisma",
    description: "Manage Prisma Postgres databases, schemas, and migrations.",
    args: ["-y", "prisma", "mcp"],
    packageRef: "prisma",
    icon: Prisma,
    env: [],
  },
  {
    id: "pinecone",
    label: "Pinecone",
    description: "Search and manage Pinecone vector indexes.",
    args: ["-y", "@pinecone-database/mcp"],
    packageRef: "@pinecone-database/mcp",
    icon: null,
    env: [env("PINECONE_API_KEY", "API key")],
  },
  {
    id: "elasticsearch",
    label: "Elasticsearch",
    description: "Query Elasticsearch indices with natural language.",
    args: ["-y", "@elastic/mcp-server-elasticsearch"],
    packageRef: "@elastic/mcp-server-elasticsearch",
    icon: Elasticsearch,
    env: [
      env("ES_URL", "Cluster URL", { secret: false }),
      env("ES_API_KEY", "API key"),
    ],
  },
  {
    id: "airtable",
    label: "Airtable",
    description: "Read and write Airtable bases, tables, and records.",
    args: ["-y", "airtable-mcp-server"],
    packageRef: "airtable-mcp-server",
    icon: Airtable,
    env: [env("AIRTABLE_API_KEY", "Personal access token")],
  },

  // --- Cloud, hosting & ops ---------------------------------------------------
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
    id: "vercel",
    label: "Vercel",
    description: "Deployments, projects, and logs on Vercel (OAuth on first use).",
    args: remote("https://mcp.vercel.com"),
    packageRef: "mcp-remote",
    icon: Vercel,
    env: [],
  },
  {
    id: "netlify",
    label: "Netlify",
    description: "Create, deploy, and manage Netlify sites and extensions.",
    args: ["-y", "@netlify/mcp"],
    packageRef: "@netlify/mcp",
    icon: Netlify,
    env: [],
  },
  {
    id: "firebase",
    label: "Firebase",
    description: "Firestore, Auth, and project tooling via the Firebase CLI.",
    args: ["-y", "firebase-tools@latest", "experimental:mcp"],
    packageRef: "firebase-tools",
    icon: Firebase,
    env: [],
  },
  {
    id: "azure",
    label: "Azure",
    description: "Query and manage Azure resources with the az login session.",
    args: ["-y", "@azure/mcp@latest", "server", "start"],
    packageRef: "@azure/mcp",
    icon: Microsoftazure,
    env: [],
  },
  {
    id: "heroku",
    label: "Heroku",
    description: "Apps, dynos, add-ons, and logs on Heroku.",
    args: ["-y", "@heroku/mcp-server"],
    packageRef: "@heroku/mcp-server",
    icon: Heroku,
    env: [env("HEROKU_API_KEY", "API key")],
  },
  {
    id: "digitalocean",
    label: "DigitalOcean",
    description: "Deploy and manage DigitalOcean apps and droplets.",
    args: ["-y", "@digitalocean/mcp"],
    packageRef: "@digitalocean/mcp",
    icon: Digitalocean,
    env: [env("DIGITALOCEAN_API_TOKEN", "API token")],
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    description: "Inspect and manage clusters using your local kubeconfig.",
    args: ["-y", "mcp-server-kubernetes"],
    packageRef: "mcp-server-kubernetes",
    icon: Kubernetes,
    env: [],
  },
  {
    id: "globalping",
    label: "Globalping",
    description: "Run ping, traceroute, and DNS checks from a global probe network.",
    args: remote("https://mcp.globalping.dev/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "circleci",
    label: "CircleCI",
    description: "Find failed builds and fix flaky tests from CI logs.",
    args: ["-y", "@circleci/mcp-server-circleci"],
    packageRef: "@circleci/mcp-server-circleci",
    icon: Circleci,
    env: [env("CIRCLECI_TOKEN", "Personal API token")],
  },
  {
    id: "e2b",
    label: "E2B Sandboxes",
    description: "Run agent code safely in cloud sandboxes.",
    args: ["-y", "@e2b/mcp-server"],
    packageRef: "@e2b/mcp-server",
    icon: null,
    env: [env("E2B_API_KEY", "API key")],
  },

  // --- Monitoring & quality -----------------------------------------------------
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
    id: "semgrep",
    label: "Semgrep",
    description: "Scan code for security vulnerabilities with Semgrep.",
    args: remote("https://mcp.semgrep.ai/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "postman",
    label: "Postman",
    description: "Run Postman collections and manage APIs.",
    args: ["-y", "@postman/postman-mcp-server"],
    packageRef: "@postman/postman-mcp-server",
    icon: Postman,
    env: [env("POSTMAN_API_KEY", "API key")],
  },

  // --- Payments & business ---------------------------------------------------
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
    id: "paypal",
    label: "PayPal",
    description: "Invoices, payments, and disputes (OAuth on first use).",
    args: remote("https://mcp.paypal.com/sse"),
    packageRef: "mcp-remote",
    icon: Paypal,
    env: [],
  },
  {
    id: "square",
    label: "Square",
    description: "Payments, customers, and catalog on Square (OAuth on first use).",
    args: remote("https://mcp.squareup.com/sse"),
    packageRef: "mcp-remote",
    icon: Square,
    env: [],
  },
  {
    id: "plaid",
    label: "Plaid",
    description: "Banking data and Plaid integrations (OAuth on first use).",
    args: remote("https://api.dashboard.plaid.com/mcp/sse"),
    packageRef: "mcp-remote",
    icon: null,
    env: [],
  },
  {
    id: "shopify",
    label: "Shopify Dev",
    description: "Search Shopify docs and explore Admin GraphQL schemas.",
    args: ["-y", "@shopify/dev-mcp"],
    packageRef: "@shopify/dev-mcp",
    icon: Shopify,
    env: [],
  },
  {
    id: "webflow",
    label: "Webflow",
    description: "Sites, CMS collections, and pages (OAuth on first use).",
    args: remote("https://mcp.webflow.com/sse"),
    packageRef: "mcp-remote",
    icon: Webflow,
    env: [],
  },
  {
    id: "auth0",
    label: "Auth0",
    description: "Manage Auth0 applications, APIs, and users (device login).",
    args: ["-y", "@auth0/auth0-mcp-server", "run"],
    packageRef: "@auth0/auth0-mcp-server",
    icon: Auth0,
    env: [],
  },

  // --- Maps & misc -------------------------------------------------------------
  {
    id: "google-maps",
    label: "Google Maps",
    description: "Geocoding, places, and directions via Google Maps.",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    packageRef: "@modelcontextprotocol/server-google-maps",
    icon: Googlemaps,
    env: [env("GOOGLE_MAPS_API_KEY", "API key")],
  },
  {
    id: "mapbox",
    label: "Mapbox",
    description: "Geocoding, directions, and isochrones via Mapbox.",
    args: ["-y", "@mapbox/mcp-server"],
    packageRef: "@mapbox/mcp-server",
    icon: Mapbox,
    env: [env("MAPBOX_ACCESS_TOKEN", "Access token")],
  },
  {
    id: "coingecko",
    label: "CoinGecko",
    description: "Crypto prices, market data, and coin metadata.",
    args: ["-y", "@coingecko/coingecko-mcp"],
    packageRef: "@coingecko/coingecko-mcp",
    icon: null,
    env: [],
  },
  {
    id: "n8n",
    label: "n8n",
    description: "Build n8n workflows with node docs; manage flows with an API key.",
    args: ["-y", "n8n-mcp"],
    packageRef: "n8n-mcp",
    icon: null,
    env: [
      env("N8N_API_URL", "Instance URL", { required: false, secret: false }),
      env("N8N_API_KEY", "API key", { required: false }),
    ],
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
