import { Algolia } from "@styled-icons/simple-icons/Algolia";
import { Amazonaws } from "@styled-icons/simple-icons/Amazonaws";
import { Ansible } from "@styled-icons/simple-icons/Ansible";
import { Apachekafka } from "@styled-icons/simple-icons/Apachekafka";
import { Appwrite } from "@styled-icons/simple-icons/Appwrite";
import { Auth0 } from "@styled-icons/simple-icons/Auth0";
import { Bitbucket } from "@styled-icons/simple-icons/Bitbucket";
import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Cockroachlabs } from "@styled-icons/simple-icons/Cockroachlabs";
import { Consul } from "@styled-icons/simple-icons/Consul";
import { Contentful } from "@styled-icons/simple-icons/Contentful";
import { Curl } from "@styled-icons/simple-icons/Curl";
import { Datadog } from "@styled-icons/simple-icons/Datadog";
import { Deno } from "@styled-icons/simple-icons/Deno";
import { Digitalocean } from "@styled-icons/simple-icons/Digitalocean";
import { Docker } from "@styled-icons/simple-icons/Docker";
import { Elastic } from "@styled-icons/simple-icons/Elastic";
import { Eslint } from "@styled-icons/simple-icons/Eslint";
import { Fastly } from "@styled-icons/simple-icons/Fastly";
import { Ffmpeg } from "@styled-icons/simple-icons/Ffmpeg";
import { Firebase } from "@styled-icons/simple-icons/Firebase";
import { Git } from "@styled-icons/simple-icons/Git";
import { Github } from "@styled-icons/simple-icons/Github";
import { Gitlab } from "@styled-icons/simple-icons/Gitlab";
import { Googlecloud } from "@styled-icons/simple-icons/Googlecloud";
import { Grafana } from "@styled-icons/simple-icons/Grafana";
import { Graphql } from "@styled-icons/simple-icons/Graphql";
import { Hasura } from "@styled-icons/simple-icons/Hasura";
import { Helm } from "@styled-icons/simple-icons/Helm";
import { Heroku } from "@styled-icons/simple-icons/Heroku";
import { Insomnia } from "@styled-icons/simple-icons/Insomnia";
import { Kubernetes } from "@styled-icons/simple-icons/Kubernetes";
import { Linode } from "@styled-icons/simple-icons/Linode";
import { Microsoftazure } from "@styled-icons/simple-icons/Microsoftazure";
import { Mongodb } from "@styled-icons/simple-icons/Mongodb";
import { Mysql } from "@styled-icons/simple-icons/Mysql";
import { Netlify } from "@styled-icons/simple-icons/Netlify";
import { Nginx } from "@styled-icons/simple-icons/Nginx";
import { Ngrok } from "@styled-icons/simple-icons/Ngrok";
import { Nodedotjs } from "@styled-icons/simple-icons/Nodedotjs";
import { Npm } from "@styled-icons/simple-icons/Npm";
import { Nx } from "@styled-icons/simple-icons/Nx";
import { Openai } from "@styled-icons/simple-icons/Openai";
import { Packer } from "@styled-icons/simple-icons/Packer";
import { Pnpm } from "@styled-icons/simple-icons/Pnpm";
import { Podman } from "@styled-icons/simple-icons/Podman";
import { Postgresql } from "@styled-icons/simple-icons/Postgresql";
import { Postman } from "@styled-icons/simple-icons/Postman";
import { Prettier } from "@styled-icons/simple-icons/Prettier";
import { Prisma } from "@styled-icons/simple-icons/Prisma";
import { Pulumi } from "@styled-icons/simple-icons/Pulumi";
import { Rabbitmq } from "@styled-icons/simple-icons/Rabbitmq";
import { Railway } from "@styled-icons/simple-icons/Railway";
import { Redis } from "@styled-icons/simple-icons/Redis";
import { Sentry } from "@styled-icons/simple-icons/Sentry";
import { Shopify } from "@styled-icons/simple-icons/Shopify";
import { Snyk } from "@styled-icons/simple-icons/Snyk";
import { Sqlite } from "@styled-icons/simple-icons/Sqlite";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";
import { Terraform } from "@styled-icons/simple-icons/Terraform";
import { Twilio } from "@styled-icons/simple-icons/Twilio";
import { Vault } from "@styled-icons/simple-icons/Vault";
import { Vercel } from "@styled-icons/simple-icons/Vercel";
import { Yarn } from "@styled-icons/simple-icons/Yarn";

/**
 * Curated catalog of common developer CLIs for the Tools tab. `binary` is the
 * executable probed on PATH; `brew`/`npm` are the packages used for
 * install/uninstall when available. Icons are tree-shaken SVG components
 * (a few hundred bytes each — smaller and sharper than raster logos).
 */
export const CLI_CATALOG = [
  { id: "gh", label: "GitHub CLI", binary: "gh", brew: "gh", icon: Github, winget: "GitHub.cli" },
  { id: "git", label: "Git", binary: "git", brew: "git", icon: Git, winget: "Git.Git" },
  { id: "glab", label: "GitLab CLI", binary: "glab", brew: "glab", icon: Gitlab },
  { id: "bitbucket", label: "Bitbucket CLI", binary: "bb", brew: null, icon: Bitbucket },
  { id: "stripe", label: "Stripe CLI", binary: "stripe", brew: "stripe/stripe-cli/stripe", icon: Stripe, winget: "Stripe.StripeCli" },
  { id: "appwrite", label: "Appwrite CLI", binary: "appwrite", npm: "appwrite-cli", icon: Appwrite },
  { id: "ccloud", label: "CockroachDB Cloud", binary: "ccloud", brew: "cockroachdb/tap/ccloud", icon: Cockroachlabs },
  { id: "cockroach", label: "CockroachDB", binary: "cockroach", brew: "cockroachdb/tap/cockroach", icon: Cockroachlabs },
  { id: "aws", label: "AWS CLI", binary: "aws", brew: "awscli", icon: Amazonaws, winget: "Amazon.AWSCLI" },
  { id: "b2", label: "Backblaze B2 CLI", binary: "b2", brew: "b2-tools", icon: null },
  { id: "gcloud", label: "Google Cloud CLI", binary: "gcloud", brew: "google-cloud-sdk", icon: Googlecloud, winget: "Google.CloudSDK" },
  { id: "az", label: "Azure CLI", binary: "az", brew: "azure-cli", icon: Microsoftazure, winget: "Microsoft.AzureCLI" },
  { id: "doctl", label: "DigitalOcean CLI", binary: "doctl", brew: "doctl", icon: Digitalocean, winget: "DigitalOcean.Doctl" },
  { id: "linode", label: "Linode CLI", binary: "linode-cli", brew: "linode-cli", icon: Linode },
  { id: "wrangler", label: "Cloudflare Wrangler", binary: "wrangler", npm: "wrangler", icon: Cloudflare },
  { id: "vercel", label: "Vercel CLI", binary: "vercel", npm: "vercel", icon: Vercel },
  { id: "netlify", label: "Netlify CLI", binary: "netlify", npm: "netlify-cli", icon: Netlify },
  { id: "railway", label: "Railway CLI", binary: "railway", brew: "railway", icon: Railway },
  { id: "heroku", label: "Heroku CLI", binary: "heroku", brew: "heroku/brew/heroku", icon: Heroku, winget: "Heroku.HerokuCLI" },
  { id: "firebase", label: "Firebase CLI", binary: "firebase", npm: "firebase-tools", icon: Firebase },
  { id: "supabase", label: "Supabase CLI", binary: "supabase", brew: "supabase/tap/supabase", icon: Supabase },
  { id: "docker", label: "Docker CLI", binary: "docker", brew: "docker", icon: Docker, winget: "Docker.DockerCLI" },
  { id: "podman", label: "Podman", binary: "podman", brew: "podman", icon: Podman },
  { id: "kubectl", label: "kubectl", binary: "kubectl", brew: "kubernetes-cli", icon: Kubernetes, winget: "Kubernetes.kubectl" },
  { id: "helm", label: "Helm", binary: "helm", brew: "helm", icon: Helm, winget: "Helm.Helm" },
  { id: "terraform", label: "Terraform", binary: "terraform", brew: "hashicorp/tap/terraform", icon: Terraform, winget: "Hashicorp.Terraform" },
  { id: "pulumi", label: "Pulumi", binary: "pulumi", brew: "pulumi/tap/pulumi", icon: Pulumi, winget: "Pulumi.Pulumi" },
  { id: "ansible", label: "Ansible", binary: "ansible", brew: "ansible", icon: Ansible },
  { id: "packer", label: "Packer", binary: "packer", brew: "hashicorp/tap/packer", icon: Packer, winget: "Hashicorp.Packer" },
  { id: "vault", label: "Vault", binary: "vault", brew: "hashicorp/tap/vault", icon: Vault, winget: "Hashicorp.Vault" },
  { id: "consul", label: "Consul", binary: "consul", brew: "hashicorp/tap/consul", icon: Consul, winget: "Hashicorp.Consul" },
  { id: "psql", label: "PostgreSQL (psql)", binary: "psql", brew: "libpq", icon: Postgresql },
  { id: "mysql", label: "MySQL client", binary: "mysql", brew: "mysql-client", icon: Mysql },
  { id: "sqlite3", label: "SQLite", binary: "sqlite3", brew: "sqlite", icon: Sqlite, winget: "SQLite.SQLite" },
  { id: "redis-cli", label: "Redis CLI", binary: "redis-cli", brew: "redis", icon: Redis },
  { id: "mongosh", label: "MongoDB Shell", binary: "mongosh", brew: "mongosh", icon: Mongodb },
  { id: "prisma", label: "Prisma CLI", binary: "prisma", npm: "prisma", icon: Prisma },
  { id: "hasura", label: "Hasura CLI", binary: "hasura", brew: "hasura-cli", icon: Hasura },
  { id: "graphql", label: "GraphQL Codegen", binary: "graphql-codegen", npm: "@graphql-codegen/cli", icon: Graphql },
  { id: "node", label: "Node.js", binary: "node", brew: "node", icon: Nodedotjs, winget: "OpenJS.NodeJS" },
  { id: "npm", label: "npm", binary: "npm", brew: "node", icon: Npm },
  { id: "pnpm", label: "pnpm", binary: "pnpm", npm: "pnpm", icon: Pnpm },
  { id: "yarn", label: "Yarn", binary: "yarn", npm: "yarn", icon: Yarn },
  { id: "deno", label: "Deno", binary: "deno", brew: "deno", icon: Deno, winget: "DenoLand.Deno" },
  { id: "nx", label: "Nx", binary: "nx", npm: "nx", icon: Nx },
  { id: "eslint", label: "ESLint", binary: "eslint", npm: "eslint", icon: Eslint },
  { id: "prettier", label: "Prettier", binary: "prettier", npm: "prettier", icon: Prettier },
  { id: "sentry", label: "Sentry CLI", binary: "sentry-cli", npm: "@sentry/cli", icon: Sentry },
  { id: "datadog", label: "Datadog CI", binary: "datadog-ci", npm: "@datadog/datadog-ci", icon: Datadog },
  { id: "snyk", label: "Snyk CLI", binary: "snyk", npm: "snyk", icon: Snyk },
  { id: "ngrok", label: "ngrok", binary: "ngrok", brew: "ngrok", icon: Ngrok, winget: "Ngrok.Ngrok" },
  { id: "twilio", label: "Twilio CLI", binary: "twilio", brew: "twilio/brew/twilio", icon: Twilio, winget: "Twilio.TwilioCLI" },
  { id: "algolia", label: "Algolia CLI", binary: "algolia", brew: "algolia/algolia-cli/algolia", icon: Algolia },
  { id: "elastic", label: "Elastic (ecctl)", binary: "ecctl", brew: "elastic/tap/ecctl", icon: Elastic },
  { id: "kafka", label: "Kafka tools", binary: "kafka-topics", brew: "kafka", icon: Apachekafka },
  { id: "rabbitmq", label: "RabbitMQ admin", binary: "rabbitmqadmin", brew: "rabbitmq", icon: Rabbitmq },
  { id: "grafana", label: "Grafana CLI", binary: "grafana", brew: "grafana", icon: Grafana },
  { id: "fastly", label: "Fastly CLI", binary: "fastly", brew: "fastly/tap/fastly", icon: Fastly },
  { id: "shopify", label: "Shopify CLI", binary: "shopify", npm: "@shopify/cli", icon: Shopify },
  { id: "contentful", label: "Contentful CLI", binary: "contentful", npm: "contentful-cli", icon: Contentful },
  { id: "auth0", label: "Auth0 CLI", binary: "auth0", brew: "auth0/auth0-cli/auth0", icon: Auth0 },
  { id: "okta", label: "Okta CLI", binary: "okta", brew: "okta/tap/okta", icon: null },
  { id: "openai", label: "OpenAI CLI", binary: "openai", npm: null, icon: Openai },
  { id: "curl", label: "curl", binary: "curl", brew: "curl", icon: Curl, winget: "cURL.cURL" },
  { id: "ffmpeg", label: "FFmpeg", binary: "ffmpeg", brew: "ffmpeg", icon: Ffmpeg, winget: "Gyan.FFmpeg" },
  { id: "nginx", label: "nginx", binary: "nginx", brew: "nginx", icon: Nginx },
  { id: "postman", label: "Postman (newman)", binary: "newman", npm: "newman", icon: Postman },
  { id: "insomnia", label: "Insomnia (inso)", binary: "inso", npm: "insomnia-inso", icon: Insomnia },
  { id: "jq", label: "jq", binary: "jq", brew: "jq", icon: null, winget: "jqlang.jq" },
  { id: "fly", label: "Fly.io CLI", binary: "flyctl", brew: "flyctl", icon: null, winget: "Fly-io.flyctl" },
];

function detectPlatform() {
  if (typeof navigator === "undefined") return "linux";
  const platform = String(navigator.platform || navigator.userAgent || "").toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
}

/**
 * Picks the package manager for this platform: macOS prefers Homebrew, then
 * npm; Windows prefers npm (no elevation), then winget; Linux prefers npm,
 * then Homebrew (Linuxbrew).
 */
export function cliInstallManager(entry, platform = detectPlatform()) {
  if (!entry) return null;
  const byManager = {
    brew: entry.brew ? { manager: "brew", package: entry.brew } : null,
    npm: entry.npm ? { manager: "npm", package: entry.npm } : null,
    winget: entry.winget ? { manager: "winget", package: entry.winget } : null,
  };
  const order = platform === "windows"
    ? ["npm", "winget"]
    : platform === "macos"
      ? ["brew", "npm"]
      : ["npm", "brew"];
  for (const manager of order) {
    if (byManager[manager]) return byManager[manager];
  }
  return null;
}
