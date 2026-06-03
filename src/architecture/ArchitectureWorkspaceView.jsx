import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge as addReactFlowEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styled, { keyframes } from "styled-components";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { AllInbox } from "@styled-icons/material-rounded/AllInbox";
import { Api } from "@styled-icons/material-rounded/Api";
import { Cached } from "@styled-icons/material-rounded/Cached";
import { Cloud } from "@styled-icons/material-rounded/Cloud";
import { Computer } from "@styled-icons/material-rounded/Computer";
import { Dns } from "@styled-icons/material-rounded/Dns";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { Groups } from "@styled-icons/material-rounded/Groups";
import { Http } from "@styled-icons/material-rounded/Http";
import { InsertDriveFile } from "@styled-icons/material-rounded/InsertDriveFile";
import { Hub } from "@styled-icons/material-rounded/Hub";
import { Lock } from "@styled-icons/material-rounded/Lock";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { Person } from "@styled-icons/material-rounded/Person";
import { Public } from "@styled-icons/material-rounded/Public";
import { Route } from "@styled-icons/material-rounded/Route";
import { Schema } from "@styled-icons/material-rounded/Schema";
import { Security } from "@styled-icons/material-rounded/Security";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { Storage } from "@styled-icons/material-rounded/Storage";
import { Sync } from "@styled-icons/material-rounded/Sync";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { VpnKey } from "@styled-icons/material-rounded/VpnKey";
import { Webhook } from "@styled-icons/material-rounded/Webhook";
import { Work } from "@styled-icons/material-rounded/Work";
import { Auth0 } from "@styled-icons/simple-icons/Auth0";
import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Cockroachlabs } from "@styled-icons/simple-icons/Cockroachlabs";
import { Docker } from "@styled-icons/simple-icons/Docker";
import { Github } from "@styled-icons/simple-icons/Github";
import { Githubactions } from "@styled-icons/simple-icons/Githubactions";
import { Kubernetes } from "@styled-icons/simple-icons/Kubernetes";
import { Mongodb } from "@styled-icons/simple-icons/Mongodb";
import { Nginx } from "@styled-icons/simple-icons/Nginx";
import { Postgresql } from "@styled-icons/simple-icons/Postgresql";
import { Redis } from "@styled-icons/simple-icons/Redis";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return jsonObject(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeTaskHistory(value) {
  const object = jsonObject(value);
  if (!object) return null;
  if (Array.isArray(object.tasks)) return object;
  if (Array.isArray(object.recent_tasks)) {
    return {
      ...object,
      tasks: object.recent_tasks,
    };
  }
  return null;
}

function taskHistoryFromSnapshot(snapshot) {
  const candidates = [
    snapshot?.taskHistory,
    snapshot?.task_history,
    snapshot?.raw?.task_history,
    snapshot,
  ].map(normalizeTaskHistory).filter(Boolean);

  return candidates.find((candidate) => jsonArray(candidate.tasks).length)
    || candidates[0]
    || { kind: "task_history", version: 1, tasks: [] };
}

function taskStatus(task) {
  if (task?.rollback_state === "rolled_back") return "rolled back";
  return text(task?.status, "unknown");
}

function taskTerminalPlan(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return jsonObject(task?.terminal_task_plan)
    || jsonObject(task?.terminalTaskPlan)
    || jsonObject(metadata?.terminal_task_plan)
    || jsonObject(metadata?.terminalTaskPlan);
}

function taskPlanTaskId(task, fallback = "") {
  const terminalPlan = taskTerminalPlan(task);
  return text(
    terminalPlan?.task_id
      || terminalPlan?.taskId
      || task?.task_id
      || task?.taskId
      || task?.id,
    fallback,
  );
}

function completedTerminalTaskPlan(plan) {
  if (!plan) return null;
  const steps = jsonArray(plan.steps).map((step, index) => {
    if (typeof step === "string") {
      return {
        status: "completed",
        step_index: index,
        title: step,
      };
    }
    return {
      ...step,
      status: "completed",
    };
  });
  return {
    ...plan,
    current_step_index: steps.length ? steps.length - 1 : plan.current_step_index,
    currentStepIndex: steps.length ? steps.length - 1 : plan.currentStepIndex,
    status: "completed",
    steps,
  };
}

function taskWithCompletedTerminalPlan(task) {
  const terminalPlan = taskTerminalPlan(task);
  const completedPlan = completedTerminalTaskPlan(terminalPlan);
  if (!completedPlan) return task;
  return {
    ...task,
    terminal_task_plan: completedPlan,
  };
}

function formatTime(value) {
  const ms = parseTimeMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const raw = text(value);
  if (!raw) return 0;
  const numeric = raw.match(/^-?\d+(?:\.\d+)?Z?$/u);
  if (numeric) {
    const number = Number(raw.replace(/Z$/u, ""));
    if (Number.isFinite(number)) return number < 10_000_000_000 ? number * 1000 : number;
  }
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pathName(value, fallback = "workspace") {
  const raw = text(value, fallback);
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || fallback;
}

function shortLabel(value, maxLength = 30) {
  const raw = text(value);
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 3) return raw.slice(0, maxLength);
  return `${raw.slice(0, maxLength - 3)}...`;
}

const ARCHITECTURE_KIND_OPTIONS = [
  { label: "Deployment", value: "deployment" },
  { label: "Flow", value: "flow" },
  { label: "Subsystem", value: "subsystem" },
  { label: "Data", value: "data" },
];

const ARCHITECTURE_NODE_KIND_OPTIONS = [
  { label: "Service", value: "service" },
  { label: "Client", value: "client" },
  { label: "API", value: "api" },
  { label: "Worker", value: "worker" },
  { label: "Database", value: "database" },
  { label: "External", value: "external" },
  { label: "Queue", value: "queue" },
];

const ARCHITECTURE_EDGE_KIND_OPTIONS = [
  { label: "Calls", value: "calls" },
  { label: "Reads", value: "reads" },
  { label: "Writes", value: "writes" },
  { label: "Publishes", value: "publishes" },
  { label: "Subscribes", value: "subscribes" },
  { label: "Depends on", value: "depends" },
];

const ARCHITECTURE_LIKEC4_ICON_MODULES = import.meta.glob("/node_modules/@likec4/icons/{aws,azure,gcp,tech,bootstrap}/*.js");
const ARCHITECTURE_LIKEC4_ICON_CACHE = new Map();
const ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES = import.meta.glob([
  "/node_modules/@styled-icons/simple-icons/*/*.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Auth0/Auth0.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Cloudflare/Cloudflare.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Cockroachlabs/Cockroachlabs.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Docker/Docker.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Github/Github.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Githubactions/Githubactions.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Kubernetes/Kubernetes.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Mongodb/Mongodb.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Nginx/Nginx.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Postgresql/Postgresql.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Redis/Redis.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Stripe/Stripe.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Supabase/Supabase.esm.js",
]);
const ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE = new Map();
let architectureStyledSimpleIconIndex = null;

const ARCHITECTURE_ICON_NAMESPACE_ALIASES = {
  amazon: "aws",
  "amazon-web-services": "aws",
  awslabs: "aws",
  bi: "bootstrap",
  bs: "bootstrap",
  "bootstrap-icons": "bootstrap",
  google: "gcp",
  "google-cloud": "gcp",
  gcloud: "gcp",
  microsoft: "azure",
  "microsoft-azure": "azure",
  simple: "styled",
  "simple-icons": "styled",
  "styled-icons": "styled",
  brand: "tech",
  company: "tech",
  logo: "tech",
};

const ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES = {
  "adobe-creative-cloud": "adobecreativecloud",
  "adobe-photoshop": "adobephotoshop",
  amazon: "amazon",
  "amazon-web-services": "amazonaws",
  amazonaws: "amazonaws",
  aws: "amazonaws",
  "aws-dynamodb": "amazondynamodb",
  "aws-s3": "amazons3",
  "c-plus-plus": "cplusplus",
  "c-sharp": "csharp",
  cockroach: "cockroachlabs",
  "cockroach-db": "cockroachlabs",
  cockroachdb: "cockroachlabs",
  "cockroach-labs": "cockroachlabs",
  cockraoch: "cockroachlabs",
  "cockraoch-db": "cockroachlabs",
  cockraochdb: "cockroachlabs",
  cockraochlabs: "cockroachlabs",
  "dot-net": "dotnet",
  dynamodb: "amazondynamodb",
  node: "nodedotjs",
  "node-dot-js": "nodedotjs",
  "node-js": "nodedotjs",
  nodejs: "nodedotjs",
  nuxt: "nuxtdotjs",
  "nuxt-js": "nuxtdotjs",
  nuxtjs: "nuxtdotjs",
  react: "reactlogo",
  "react-js": "reactlogo",
  s3: "amazons3",
  vue: "vuedotjs",
  "vue-js": "vuedotjs",
  vuejs: "vuedotjs",
};

const ARCHITECTURE_ICON_ALIASES = {
  "aws:api": "aws:api-gateway",
  "aws:apigateway": "aws:api-gateway",
  "aws:api-gateway": "aws:api-gateway",
  "aws:cloudfront": "aws:cloud-front",
  "aws:cloudwatch": "aws:cloud-watch",
  "aws:dynamodb": "aws:dynamo-db",
  "aws:ebs": "aws:elastic-block-store",
  "aws:ec2": "aws:ec2",
  "aws:ecr": "aws:elastic-container-registry",
  "aws:ecs": "aws:elastic-container-service",
  "aws:eks": "aws:elastic-kubernetes-service",
  "aws:elasticache": "aws:elasti-cache",
  "aws:elb": "aws:elastic-load-balancing",
  "aws:eventbridge": "aws:event-bridge",
  "aws:iam": "aws:identity-and-access-management",
  "aws:kms": "aws:key-management-service",
  "aws:opensearch": "aws:open-search-service",
  "aws:route53": "aws:route-53",
  "aws:s3": "aws:simple-storage-service",
  "aws:secrets": "aws:secrets-manager",
  "aws:secret-manager": "aws:secrets-manager",
  "aws:sns": "aws:simple-notification-service",
  "aws:sqs": "aws:simple-queue-service",
  "aws:vpc": "aws:virtual-private-cloud",
  "api-gateway": "generic:api",
  "aws-api-gateway": "aws:api-gateway",
  "aws-cloudfront": "aws:cloud-front",
  "aws-cloudwatch": "aws:cloud-watch",
  "aws-dynamodb": "aws:dynamo-db",
  "aws-ec2": "aws:ec2",
  "aws-ecr": "aws:elastic-container-registry",
  "aws-ecs": "aws:elastic-container-service",
  "aws-eks": "aws:elastic-kubernetes-service",
  "aws-elasticache": "aws:elasti-cache",
  "aws-elb": "aws:elastic-load-balancing",
  "aws-eventbridge": "aws:event-bridge",
  "aws-iam": "aws:identity-and-access-management",
  "aws-kms": "aws:key-management-service",
  "aws-lambda": "aws:lambda",
  "aws-opensearch": "aws:open-search-service",
  "aws-rds": "aws:rds",
  "aws-route53": "aws:route-53",
  "aws-s3": "aws:simple-storage-service",
  "aws-secrets": "aws:secrets-manager",
  "aws-sns": "aws:simple-notification-service",
  "aws-sqs": "aws:simple-queue-service",
  "aws-vpc": "aws:virtual-private-cloud",
  bucket: "aws:simple-storage-service",
  buckets: "aws:simple-storage-service",
  cloudfront: "aws:cloud-front",
  cloudwatch: "aws:cloud-watch",
  dynamodb: "aws:dynamo-db",
  ec2: "aws:ec2",
  ecr: "aws:elastic-container-registry",
  ecs: "aws:elastic-container-service",
  eks: "aws:elastic-kubernetes-service",
  elasticache: "aws:elasti-cache",
  elb: "aws:elastic-load-balancing",
  eventbridge: "aws:event-bridge",
  iam: "aws:identity-and-access-management",
  kinesis: "aws:kinesis",
  kms: "aws:key-management-service",
  lambda: "aws:lambda",
  opensearch: "aws:open-search-service",
  rds: "aws:rds",
  route53: "aws:route-53",
  s3: "aws:simple-storage-service",
  sns: "aws:simple-notification-service",
  sqs: "aws:simple-queue-service",
  vpc: "aws:virtual-private-cloud",
  "gcp:gcs": "gcp:cloud-storage",
  "gcp:pubsub": "gcp:pub-sub",
  "gcp:sql": "gcp:cloud-sql",
  "google-cloud-run": "gcp:cloud-run",
  "google-cloud-storage": "gcp:cloud-storage",
  bigquery: "gcp:big-query",
  "big-query": "gcp:big-query",
  "cloud-run": "gcp:cloud-run",
  "cloud-sql": "gcp:cloud-sql",
  "cloud-storage": "gcp:cloud-storage",
  gcs: "gcp:cloud-storage",
  gke: "gcp:google-kubernetes-engine",
  pubsub: "gcp:pub-sub",
  "pub-sub": "gcp:pub-sub",
  "azure:aks": "azure:kubernetes-services",
  "azure:blob": "azure:storage-accounts",
  "azure:blob-storage": "azure:storage-accounts",
  "azure:cosmosdb": "azure:azure-cosmos-db",
  "azure:function": "azure:function-apps",
  "azure:functions": "azure:function-apps",
  "azure:postgres": "azure:azure-database-postgre-sql-server",
  "azure:postgresql": "azure:azure-database-postgre-sql-server",
  "azure:redis": "azure:azure-managed-redis",
  "azure:service-bus": "azure:azure-service-bus",
  "azure:sql": "azure:azure-sql",
  "azure:storage": "azure:storage-accounts",
  aks: "azure:kubernetes-services",
  "azure-blob-storage": "azure:storage-accounts",
  "azure-cosmos": "azure:azure-cosmos-db",
  "azure-cosmosdb": "azure:azure-cosmos-db",
  "azure-functions": "azure:function-apps",
  "blob-storage": "azure:storage-accounts",
  cosmos: "azure:azure-cosmos-db",
  cosmosdb: "azure:azure-cosmos-db",
  cockroach: "styled:cockroachlabs",
  "cockroach-db": "styled:cockroachlabs",
  cockroachdb: "styled:cockroachlabs",
  cockroachlabs: "styled:cockroachlabs",
  "cockroach-labs": "styled:cockroachlabs",
  cockraoch: "styled:cockroachlabs",
  "cockraoch-db": "styled:cockroachlabs",
  cockraochdb: "styled:cockroachlabs",
  cockraochlabs: "styled:cockroachlabs",
  postgres: "tech:postgresql",
  pg: "tech:postgresql",
  mongo: "tech:mongodb-icon",
  mongodb: "tech:mongodb-icon",
  "mongo-db": "tech:mongodb-icon",
  github: "tech:github-icon",
  gh: "tech:github-icon",
  "github-actions": "tech:github-actions",
  cloudflare: "tech:cloudflare-icon",
  "cloudflare-workers": "tech:cloudflare-workers-icon",
  docker: "tech:docker-icon",
  supabase: "tech:supabase-icon",
  auth0: "tech:auth0-icon",
  node: "tech:nodejs-icon",
  nodejs: "tech:nodejs-icon",
  "node-js": "tech:nodejs-icon",
  next: "tech:nextjs-icon",
  "next-js": "tech:nextjs-icon",
  nextjs: "tech:nextjs-icon",
  typescript: "tech:typescript-icon",
  ts: "tech:typescript-icon",
  vue: "styled:vuedotjs",
  "vue-js": "styled:vuedotjs",
  vuejs: "styled:vuedotjs",
  openai: "tech:openai-icon",
  anthropic: "tech:anthropic-icon",
  ai: "generic:ai",
  api: "generic:api",
  auth: "generic:auth",
  authentication: "generic:auth",
  authorization: "generic:auth",
  browser: "generic:client",
  box: "generic:group",
  boxes: "generic:group",
  cache: "generic:cache",
  cli: "generic:terminal",
  client: "generic:client",
  compute: "generic:compute",
  database: "generic:database",
  datastore: "generic:database",
  db: "generic:database",
  "external-service": "generic:external",
  config: "generic:file",
  document: "generic:file",
  file: "generic:file",
  flow: "generic:flow",
  folder: "generic:folder",
  gateway: "generic:api",
  group: "generic:group",
  users: "generic:users",
  monitor: "generic:client",
  persistence: "generic:database",
  queue: "generic:queue",
  router: "generic:router",
  server: "generic:server",
  service: "generic:service",
  settings: "generic:settings",
  storage: "generic:storage",
  subscription: "generic:subscription",
  terminal: "generic:terminal",
  worker: "generic:worker",
};

const ARCHITECTURE_STYLED_ICON_COMPONENTS = {
  ai: Memory,
  api: Api,
  auth: VpnKey,
  cache: Cached,
  client: Computer,
  cloud: Cloud,
  cockroachlabs: Cockroachlabs,
  compute: Memory,
  database: Storage,
  db: Storage,
  docker: Docker,
  dns: Dns,
  external: Public,
  file: InsertDriveFile,
  flow: AccountTree,
  folder: Folder,
  github: Github,
  "github-actions": Githubactions,
  group: Hub,
  http: Http,
  kubernetes: Kubernetes,
  lock: Lock,
  mongodb: Mongodb,
  nginx: Nginx,
  postgres: Postgresql,
  postgresql: Postgresql,
  queue: AllInbox,
  redis: Redis,
  router: Route,
  security: Security,
  server: Dns,
  service: Work,
  settings: Settings,
  storage: Storage,
  stripe: Stripe,
  subscription: Sync,
  supabase: Supabase,
  terminal: Terminal,
  users: Groups,
  user: Person,
  webhook: Webhook,
  worker: Settings,
  auth0: Auth0,
  cloudflare: Cloudflare,
  schema: Schema,
};

const ARCHITECTURE_KIND_ICON_FALLBACKS = {
  api: "generic:api",
  client: "generic:client",
  database: "generic:database",
  external: "generic:external",
  group: "generic:group",
  queue: "generic:queue",
  service: "generic:service",
  worker: "generic:worker",
};

const architectureNodeTypes = {
  architectureGroup: ArchitectureCanvasGroup,
  architectureNode: ArchitectureCanvasNode,
};

const architectureEdgeTypes = {
  architectureEdge: ArchitectureCanvasEdge,
};

function architectureSlug(value, fallback = "architecture") {
  const raw = text(value, fallback).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return slug || fallback;
}

function architectureIconSlug(value, fallback = "") {
  const raw = text(value).toLowerCase();
  const slug = raw
    .replace(/&/gu, " and ")
    .replace(/\+/gu, " plus ")
    .replace(/([a-z])([0-9])/gu, "$1-$2")
    .replace(/([0-9])([a-z])/gu, "$1-$2")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || fallback;
}

function architectureIconNamespace(value) {
  const normalized = architectureIconSlug(value);
  return ARCHITECTURE_ICON_NAMESPACE_ALIASES[normalized] || normalized;
}

function architectureIconParts(value) {
  const raw = text(value).toLowerCase();
  const namespaceMatch = raw.match(/^([a-z0-9][a-z0-9\s_-]*)\s*[:/]\s*(.+)$/u);
  if (namespaceMatch) {
    const namespace = architectureIconNamespace(namespaceMatch[1]);
    const slug = architectureIconSlug(namespaceMatch[2]);
    return {
      key: namespace && slug ? `${namespace}:${slug}` : slug,
      namespace,
      slug,
    };
  }
  const slug = architectureIconSlug(raw);
  return {
    key: slug,
    namespace: "",
    slug,
  };
}

function architectureLikeC4IconPath(collection, slug) {
  return `/node_modules/@likec4/icons/${collection}/${slug}.js`;
}

function architectureAddLikeC4Candidate(candidates, collection, value) {
  const slug = architectureIconSlug(value);
  if (!collection || !slug) return;
  const path = architectureLikeC4IconPath(collection, slug);
  if (!ARCHITECTURE_LIKEC4_ICON_MODULES[path]) return;
  if (candidates.some((candidate) => candidate.path === path)) return;
  candidates.push({
    collection,
    path,
    slug,
  });
}

function architectureStyledSimpleIconFolder(path) {
  return text(path.match(/\/simple-icons\/([^/]+)\//u)?.[1]);
}

function architectureStyledSimpleIconIndexes() {
  if (architectureStyledSimpleIconIndex) return architectureStyledSimpleIconIndex;
  const byCompact = new Map();
  const bySlug = new Map();
  Object.keys(ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES).forEach((path) => {
    const folder = architectureStyledSimpleIconFolder(path);
    const slug = architectureIconSlug(folder);
    const compact = slug.replace(/-/gu, "");
    if (slug && !bySlug.has(slug)) bySlug.set(slug, path);
    if (compact && !byCompact.has(compact)) byCompact.set(compact, path);
  });
  architectureStyledSimpleIconIndex = { byCompact, bySlug };
  return architectureStyledSimpleIconIndex;
}

function architectureStyledSimpleIconPath(value) {
  const slug = architectureIconSlug(value);
  if (!slug) return "";
  const compact = slug.replace(/-/gu, "");
  const alias = ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES[slug]
    || ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES[compact]
    || "";
  const aliasSlug = architectureIconSlug(alias);
  const aliasCompact = aliasSlug.replace(/-/gu, "");
  const indexes = architectureStyledSimpleIconIndexes();
  return indexes.bySlug.get(aliasSlug)
    || indexes.byCompact.get(aliasCompact)
    || indexes.bySlug.get(slug)
    || indexes.byCompact.get(compact)
    || "";
}

function architectureAddStyledSimpleCandidate(candidates, value) {
  const path = architectureStyledSimpleIconPath(value);
  if (!path) return;
  const folder = architectureStyledSimpleIconFolder(path);
  if (!folder) return;
  if (candidates.some((candidate) => candidate.path === path)) return;
  candidates.push({
    folder,
    path,
    slug: architectureIconSlug(folder),
  });
}

function architectureIconAliasTarget(parts) {
  if (!parts?.slug) return "";
  if (parts.key && ARCHITECTURE_ICON_ALIASES[parts.key]) {
    return ARCHITECTURE_ICON_ALIASES[parts.key];
  }
  return ARCHITECTURE_ICON_ALIASES[parts.slug] || "";
}

function architectureAddIconToken(state, value, depth = 0) {
  if (!state || depth > 5) return;
  const parts = architectureIconParts(value);
  if (!parts.slug) return;
  const tokenKey = parts.key || parts.slug;
  if (state.seenTokens.has(tokenKey)) return;
  state.seenTokens.add(tokenKey);

  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    architectureAddIconToken(state, aliasTarget, depth + 1);
  }

  if (parts.namespace === "styled") {
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    if (!state.styledKey) state.styledKey = parts.slug;
    return;
  }

  if (parts.namespace === "generic") {
    if (!state.styledKey) state.styledKey = parts.slug;
    return;
  }

  if (parts.namespace === "aws") {
    architectureAddLikeC4Candidate(state.candidates, "aws", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `aws-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `aws-${parts.slug}`);
    return;
  }

  if (parts.namespace === "gcp") {
    architectureAddLikeC4Candidate(state.candidates, "gcp", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `google-cloud-${parts.slug}`);
    architectureAddLikeC4Candidate(state.candidates, "tech", `gcp-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `google-cloud-${parts.slug}`);
    return;
  }

  if (parts.namespace === "azure") {
    architectureAddLikeC4Candidate(state.candidates, "azure", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `azure-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `azure-${parts.slug}`);
    return;
  }

  if (parts.namespace === "tech") {
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    return;
  }

  if (parts.namespace === "bootstrap") {
    architectureAddLikeC4Candidate(state.candidates, "bootstrap", parts.slug);
    return;
  }

  if (parts.slug.startsWith("aws-")) {
    const awsSlug = parts.slug.replace(/^aws-/u, "");
    architectureAddIconToken(state, `aws:${awsSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  } else if (parts.slug.startsWith("google-cloud-")) {
    const gcpSlug = parts.slug.replace(/^google-cloud-/u, "");
    architectureAddIconToken(state, `gcp:${gcpSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  } else if (parts.slug.startsWith("gcp-")) {
    architectureAddIconToken(state, `gcp:${parts.slug.replace(/^gcp-/u, "")}`, depth + 1);
  } else if (parts.slug.startsWith("azure-")) {
    const azureSlug = parts.slug.replace(/^azure-/u, "");
    architectureAddIconToken(state, `azure:${azureSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  }

  if (!parts.slug.endsWith("-icon")) {
    architectureAddLikeC4Candidate(state.candidates, "tech", `${parts.slug}-icon`);
  }
  architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
  if (!state.styledKey && ARCHITECTURE_STYLED_ICON_COMPONENTS[parts.slug]) {
    state.styledKey = parts.slug;
  }
}

function architectureIconInitials(value, fallback = "IC") {
  const raw = text(value, fallback);
  return raw
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || fallback;
}

function architectureResolveIconDescriptor(icon, kind = "service") {
  const state = {
    candidates: [],
    seenTokens: new Set(),
    styledCandidates: [],
    styledKey: "",
  };
  const rawIcon = text(icon);
  const rawKind = text(kind, "service");
  architectureAddIconToken(state, rawIcon || rawKind);
  const kindFallback = ARCHITECTURE_KIND_ICON_FALLBACKS[architectureIconSlug(rawKind)];
  if (kindFallback) architectureAddIconToken(state, kindFallback);
  if (!state.styledKey) {
    const styledFallback = architectureIconSlug(rawKind);
    if (ARCHITECTURE_STYLED_ICON_COMPONENTS[styledFallback]) {
      state.styledKey = styledFallback;
    }
  }
  const displayName = rawIcon || rawKind;
  return {
    candidates: state.candidates,
    key: [
      rawIcon,
      rawKind,
      state.styledKey,
      ...state.candidates.map((candidate) => candidate.path),
      ...state.styledCandidates.map((candidate) => candidate.path),
    ].join("|"),
    label: architectureIconInitials(displayName),
    sourceLabel: displayName,
    styledCandidates: state.styledCandidates,
    styledKey: state.styledKey,
  };
}

function architectureIconFallbackState(descriptor) {
  const Icon = ARCHITECTURE_STYLED_ICON_COMPONENTS[descriptor.styledKey] || null;
  return {
    Icon,
    label: descriptor.label,
    source: Icon ? "styled" : "label",
    title: descriptor.sourceLabel,
  };
}

function architectureLoadLikeC4Icon(candidates) {
  const key = candidates.map((candidate) => candidate.path).join("|");
  if (!key) return Promise.resolve(null);
  if (ARCHITECTURE_LIKEC4_ICON_CACHE.has(key)) {
    return ARCHITECTURE_LIKEC4_ICON_CACHE.get(key);
  }
  const promise = (async () => {
    for (const candidate of candidates) {
      const load = ARCHITECTURE_LIKEC4_ICON_MODULES[candidate.path];
      if (!load) continue;
      try {
        const iconModule = await load();
        if (iconModule?.default) {
          return {
            Icon: iconModule.default,
            title: `${candidate.collection}:${candidate.slug}`,
          };
        }
      } catch {
        // Try the next candidate; bad package entries should not break graph rendering.
      }
    }
    return null;
  })();
  ARCHITECTURE_LIKEC4_ICON_CACHE.set(key, promise);
  return promise;
}

function architectureLoadStyledSimpleIcon(candidates) {
  const key = candidates.map((candidate) => candidate.path).join("|");
  if (!key) return Promise.resolve(null);
  if (ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.has(key)) {
    return ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.get(key);
  }
  const promise = (async () => {
    for (const candidate of candidates) {
      const load = ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES[candidate.path];
      if (!load) continue;
      try {
        const iconModule = await load();
        const Icon = iconModule?.[candidate.folder];
        if (Icon) {
          return {
            Icon,
            title: `styled:${candidate.slug}`,
          };
        }
      } catch {
        // Try the next candidate; missing brand fallbacks should not break rendering.
      }
    }
    return null;
  })();
  ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.set(key, promise);
  return promise;
}

function useArchitectureIcon(icon, kind = "service") {
  const descriptor = useMemo(() => architectureResolveIconDescriptor(icon, kind), [icon, kind]);
  const [state, setState] = useState(() => architectureIconFallbackState(descriptor));

  useEffect(() => {
    let cancelled = false;
    setState(architectureIconFallbackState(descriptor));
    Promise.resolve()
      .then(async () => (
        await architectureLoadLikeC4Icon(descriptor.candidates)
        || await architectureLoadStyledSimpleIcon(descriptor.styledCandidates)
      ))
      .then((loaded) => {
      if (cancelled || !loaded?.Icon) return;
      setState({
        Icon: loaded.Icon,
        label: descriptor.label,
        source: loaded.title?.startsWith("styled:") ? "styled" : "likec4",
        title: loaded.title,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [descriptor]);

  return state;
}

function architectureEntityId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function architectureKindLabel(value) {
  const raw = text(value, "architecture");
  return ARCHITECTURE_KIND_OPTIONS.find((option) => option.value === raw)?.label
    || raw.replace(/[-_]+/gu, " ");
}

function architectureGroupPathLabel(value) {
  const parts = jsonArray(value).map((item) => text(item)).filter(Boolean);
  return parts.length ? parts.join(" / ") : "General";
}

function architectureFolderPathParts(value) {
  return jsonArray(value)
    .map((item) => text(item))
    .filter(Boolean);
}

function architectureFolderPathText(value) {
  return architectureFolderPathParts(value).join(" / ");
}

function createArchitectureTreeNode(name = "", path = []) {
  return {
    folders: new Map(),
    graphs: [],
    name,
    path,
  };
}

function architectureGraphTreeRows(graphs, startDepth = 0) {
  const root = createArchitectureTreeNode();
  jsonArray(graphs).forEach((graph) => {
    const parts = architectureFolderPathParts(graph.groupPath);
    let node = root;
    parts.forEach((part) => {
      const key = part.toLowerCase();
      if (!node.folders.has(key)) {
        node.folders.set(key, createArchitectureTreeNode(part, [...node.path, part]));
      }
      node = node.folders.get(key);
    });
    node.graphs.push(graph);
  });

  const rows = [];
  const sortGraphs = (items) => [...items].sort((left, right) => (
    text(left.title).localeCompare(text(right.title))
  ));
  const flatten = (node, depth) => {
    sortGraphs(node.graphs).forEach((graph) => {
      rows.push({
        depth,
        graph,
        id: graph.id,
        kind: "graph",
      });
    });
    [...node.folders.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((folder) => {
        rows.push({
          depth,
          id: folder.path.join("/"),
          kind: "folder",
          name: folder.name,
          path: folder.path,
        });
        flatten(folder, depth + 1);
      });
  };

  flatten(root, startDepth);
  return rows;
}

function architectureCloudMcpNoiseError(value) {
  const raw = text(value).toLowerCase();
  return raw.includes("cloud mcp app websocket request timed out")
    || raw.includes("cloud mcp websocket request timed out");
}

function architectureEscapeDsl(value) {
  return text(value).replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
}

function architectureDslString(value) {
  return `"${architectureEscapeDsl(value)}"`;
}

function architectureDslName(value) {
  const raw = text(value, "Node");
  if (/^[A-Za-z0-9][A-Za-z0-9 _./-]*$/u.test(raw) && !/[{}[\],:<>]/u.test(raw)) {
    return raw;
  }
  return architectureDslString(raw);
}

function architectureStripDslComments(line) {
  let inQuote = false;
  let previous = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "/" && next === "/") return line.slice(0, index).trim();
    if (!inQuote && char === "#") return line.slice(0, index).trim();
    previous = char;
  }
  return line.trim();
}

function architectureUnquoteDsl(value) {
  const raw = text(value);
  if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
    return raw.slice(1, -1).replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\").trim();
  }
  return raw.trim();
}

function architectureSplitDslTopLevel(value, separator = ",") {
  const parts = [];
  let inQuote = false;
  let bracketDepth = 0;
  let current = "";
  let previous = "";

  for (const char of text(value)) {
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!inQuote && bracketDepth === 0 && char === separator) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    previous = char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function architectureExtractDslProps(value) {
  const raw = text(value);
  let inQuote = false;
  let bracketStart = -1;
  let previous = "";

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketStart = index;
    previous = char;
  }

  if (bracketStart < 0 || !raw.endsWith("]")) {
    return { name: architectureUnquoteDsl(raw), props: {} };
  }

  const name = architectureUnquoteDsl(raw.slice(0, bracketStart).trim());
  const propsText = raw.slice(bracketStart + 1, -1);
  const props = {};
  architectureSplitDslTopLevel(propsText).forEach((part) => {
    const colonIndex = part.indexOf(":");
    if (colonIndex <= 0) return;
    const key = part.slice(0, colonIndex).trim();
    const valuePart = architectureUnquoteDsl(part.slice(colonIndex + 1).trim());
    if (key) props[key] = valuePart;
  });
  return { name, props };
}

function architectureFindDslLabelIndex(value) {
  let inQuote = false;
  let bracketDepth = 0;
  let previous = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!inQuote && bracketDepth === 0 && char === ":") return index;
    previous = char;
  }
  return -1;
}

function architectureTokenizeDslConnection(value) {
  const tokens = [];
  let inQuote = false;
  let bracketDepth = 0;
  let current = "";
  let previous = "";
  let index = 0;
  const pushCurrent = () => {
    const token = current.trim();
    if (token) tokens.push({ type: "name", value: token });
    current = "";
  };

  while (index < value.length) {
    const char = value[index];
    const pair = value.slice(index, index + 2);
    const triple = value.slice(index, index + 3);

    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (!inQuote && bracketDepth === 0) {
      const connector = triple === "-->" ? "-->"
        : pair === "<>" ? "<>"
          : pair === "--" ? "--"
            : char === ">" || char === "<" ? char : "";
      if (connector) {
        pushCurrent();
        tokens.push({ type: "connector", value: connector });
        index += connector.length;
        previous = "";
        continue;
      }
    }

    current += char;
    previous = char;
    index += 1;
  }
  pushCurrent();
  return tokens;
}

function architectureIconKind(icon, fallback = "service") {
  const raw = text(icon).toLowerCase();
  if (!raw) return fallback;
  if (/(db|database|rds|sql|postgres|mysql|mongo|redis|store|storage|bucket|s3)/u.test(raw)) return "database";
  if (/(user|client|browser|mobile|cli|bot|agent)/u.test(raw)) return "client";
  if (/(queue|kafka|pubsub|bus|stream|event)/u.test(raw)) return "queue";
  if (/(api|gateway|route|router|endpoint)/u.test(raw)) return "api";
  if (/(worker|lambda|function|job)/u.test(raw)) return "worker";
  if (/(external|cloud|github|slack|stripe|third)/u.test(raw)) return "external";
  return fallback;
}

function architectureDslPropsText(props = {}) {
  const entries = Object.entries(props)
    .filter(([, value]) => text(value))
    .map(([key, value]) => `${key}: ${/[,\][{}:<>]/u.test(text(value)) || /\s/u.test(text(value)) ? architectureDslString(value) : value}`);
  return entries.length ? ` [${entries.join(", ")}]` : "";
}

function architectureLayoutGraph(graph) {
  const nodes = jsonArray(graph.nodes).map((node, index) => ({ ...node, __order: index }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  nodes.forEach((node) => {
    const parentId = text(node.parentId || "");
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });

  const direction = text(graph?.layout?.direction, "LR");
  const topLevel = childrenByParent.get("") || [];
  const topGroups = topLevel.filter((node) => node.type === "group");
  const topNodes = topLevel.filter((node) => node.type !== "group");
  const groupWidth = 360;
  const nodeWidth = 184;
  const nodeHeight = 76;

  function layoutGroup(group, groupIndex = 0) {
    const directChildren = childrenByParent.get(group.id) || [];
    const childGroups = directChildren.filter((node) => node.type === "group");
    const childNodes = directChildren.filter((node) => node.type !== "group");
    const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, childNodes.length)))));
    const rows = Math.max(1, Math.ceil(childNodes.length / columns));
    const nestedHeight = childGroups.length ? childGroups.length * 210 + 24 : 0;
    const height = Math.max(190, 74 + rows * 102 + nestedHeight);
    group.width = numberValue(group.width, Math.max(groupWidth, 48 + columns * (nodeWidth + 34)));
    group.height = numberValue(group.height, height);

    childNodes.forEach((node, index) => {
      node.position = node.position || {
        x: 28 + (index % columns) * (nodeWidth + 24),
        y: 72 + Math.floor(index / columns) * 102,
      };
    });

    childGroups.forEach((childGroup, index) => {
      layoutGroup(childGroup, index);
      childGroup.position = childGroup.position || {
        x: 28,
        y: 72 + rows * 102 + index * 214,
      };
      childGroup.width = Math.max(numberValue(childGroup.width, groupWidth - 56), groupWidth - 56);
    });

    return {
      height: group.height,
      width: group.width,
      x: direction === "TB" ? 80 : 80 + groupIndex * (group.width + 64),
      y: direction === "TB" ? 80 + groupIndex * (group.height + 64) : 80,
    };
  }

  topGroups.forEach((group, index) => {
    const position = layoutGroup(group, index);
    group.position = group.position || { x: position.x, y: position.y };
  });

  const topNodeOffsetX = topGroups.length
    ? Math.max(...topGroups.map((group) => numberValue(group.position?.x, 0) + numberValue(group.width, groupWidth))) + 72
    : 80;
  topNodes.forEach((node, index) => {
    node.position = node.position || {
      x: direction === "TB" ? 80 + (index % 3) * 218 : topNodeOffsetX,
      y: direction === "TB" ? 80 + topGroups.reduce((total, group) => total + numberValue(group.height, groupWidth) + 64, 0) + Math.floor(index / 3) * 108 : 110 + index * 108,
    };
  });

  return {
    ...graph,
    nodes: nodes
      .sort((left, right) => left.__order - right.__order)
      .map(({ __order, ...node }) => node),
  };
}

function architectureParseDslGraph(graph) {
  const source = text(graph?.source);
  if (!source) return jsonObject(graph) || null;

  const parsed = {
    id: text(graph?.id, architectureSlug(graph?.title || "architecture")),
    title: text(graph?.title, "Architecture graph"),
    kind: "architecture",
    groupPath: architectureFolderPathParts(graph?.groupPath),
    layout: { direction: "LR", engine: "dsl" },
    source,
    sourceFormat: "eraserDsl",
    version: 2,
    createdAt: text(graph?.createdAt),
    updatedAt: text(graph?.updatedAt),
    filePath: text(graph?.filePath),
    nodes: [],
    edges: [],
  };
  const nameToId = new Map();
  const nodeById = new Map();
  const stack = [];
  const idCounts = new Map();

  const uniqueId = (name, prefix = "node") => {
    const base = architectureSlug(name, prefix);
    const count = idCounts.get(base) || 0;
    idCounts.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
  const registerNode = (name, props = {}, isGroup = false, explicitParentId = "") => {
    const cleanName = text(name);
    if (!cleanName) return null;
    if (nameToId.has(cleanName)) return nameToId.get(cleanName);
    const id = uniqueId(cleanName, isGroup ? "group" : "node");
    const parentId = explicitParentId || stack.at(-1)?.id || "";
    const icon = text(props.icon);
    const node = {
      id,
      title: text(props.label, cleanName),
      subtitle: text(props.desc || props.description),
      kind: isGroup ? "group" : architectureIconKind(icon, "service"),
      type: isGroup ? "group" : "node",
      icon,
      color: text(props.color),
      ...(parentId ? { parentId } : {}),
    };
    parsed.nodes.push(node);
    nodeById.set(id, node);
    nameToId.set(cleanName, id);
    return id;
  };
  const ensureNode = (name) => registerNode(name, {}, false, "");

  source.split(/\r?\n/u).forEach((rawLine) => {
    let line = architectureStripDslComments(rawLine);
    if (!line) return;
    if (line === "}") {
      stack.pop();
      return;
    }
    if (line.startsWith("title ")) {
      parsed.title = architectureUnquoteDsl(line.slice(6));
      return;
    }
    if (line.startsWith("folder ") || line.startsWith("groupPath ") || line.startsWith("path ")) {
      parsed.groupPath = architectureUnquoteDsl(line.replace(/^(folder|groupPath|path)\s+/u, ""))
        .split(/[/>]/u)
        .map((part) => part.trim())
        .filter(Boolean);
      return;
    }
    if (line.startsWith("direction ")) {
      const direction = text(line.slice(10)).toLowerCase();
      parsed.layout.direction = direction === "down" ? "TB"
        : direction === "up" ? "BT"
          : direction === "left" ? "RL" : "LR";
      return;
    }
    if (/^(colorMode|styleMode|typeface|legend)\b/u.test(line)) return;

    const opensGroup = line.endsWith("{");
    if (opensGroup) {
      line = line.slice(0, -1).trim();
      const { name, props } = architectureExtractDslProps(line);
      const id = registerNode(name, props, true);
      if (id) stack.push({ id, name });
      return;
    }

    const labelIndex = architectureFindDslLabelIndex(line);
    const connectionExpression = labelIndex >= 0 ? line.slice(0, labelIndex).trim() : line;
    const connectionLabelRaw = labelIndex >= 0 ? line.slice(labelIndex + 1).trim() : "";
    const tokens = architectureTokenizeDslConnection(connectionExpression);
    if (tokens.some((token) => token.type === "connector")) {
      const cleanLabel = architectureExtractDslProps(connectionLabelRaw).name;
      for (let index = 0; index < tokens.length - 2; index += 2) {
        const left = tokens[index];
        const connector = tokens[index + 1];
        const right = tokens[index + 2];
        if (left?.type !== "name" || connector?.type !== "connector" || right?.type !== "name") continue;
        const leftNames = architectureSplitDslTopLevel(left.value).map((item) => architectureExtractDslProps(item).name).filter(Boolean);
        const rightNames = architectureSplitDslTopLevel(right.value).map((item) => architectureExtractDslProps(item).name).filter(Boolean);
        leftNames.forEach((leftName) => {
          rightNames.forEach((rightName) => {
            const sourceId = ensureNode(connector.value === "<" ? rightName : leftName);
            const targetId = ensureNode(connector.value === "<" ? leftName : rightName);
            if (!sourceId || !targetId) return;
            parsed.edges.push({
              id: uniqueId(`${sourceId}-${targetId}`, "edge"),
              source: sourceId,
              target: targetId,
              label: cleanLabel,
              kind: connector.value === "--" ? "depends" : "calls",
            });
            if (connector.value === "<>") {
              parsed.edges.push({
                id: uniqueId(`${targetId}-${sourceId}`, "edge"),
                source: targetId,
                target: sourceId,
                label: cleanLabel,
                kind: "calls",
              });
            }
          });
        });
      }
      return;
    }

    const { name, props } = architectureExtractDslProps(line);
    registerNode(name, props, false);
  });

  return architectureLayoutGraph(parsed);
}

function architectureStarterSource({ groupPath = "", title = "" } = {}) {
  const cleanTitle = text(title, "Architecture graph");
  const groupParts = text(groupPath)
    .split(/[/>]/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  const lines = [
    `title ${architectureDslString(cleanTitle)}`,
    "direction right",
  ];
  if (groupParts.length) lines.push(`folder ${architectureDslString(groupParts.join(" / "))}`);
  lines.push(
    "",
    "Client Layer [icon: users, color: blue] {",
    "  Client [icon: monitor, desc: Entry point]",
    "}",
    "",
    "Application [icon: server, color: amber] {",
    "  API [icon: api, desc: Request handling and validation]",
    "  Service [icon: settings, desc: Core logic]",
    "}",
    "",
    "Persistence [icon: database, color: purple] {",
    "  Store [icon: database, desc: State and durable records]",
    "}",
    "",
    "Client > API: request",
    "API > Service: delegate",
    "Service > Store: read/write",
  );
  return `${lines.join("\n")}\n`;
}

function architectureStarterGraph({ groupPath = "", title = "" } = {}) {
  const cleanTitle = text(title, "Architecture graph");
  const id = `${architectureSlug(cleanTitle)}-${String(Date.now()).slice(-5)}`;
  const source = architectureStarterSource({ groupPath, title: cleanTitle });
  return architectureParseDslGraph({
    id,
    title: cleanTitle,
    groupPath: text(groupPath)
      .split(/[/>]/u)
      .map((part) => part.trim())
      .filter(Boolean),
    source,
    sourceFormat: "eraserDsl",
  });
}

function architectureFlowNodeFromGraphNode(node, index = 0) {
  const rawKind = text(node?.kind || node?.type, "service");
  const isGroup = rawKind === "group" || text(node?.type) === "group";
  const id = text(node?.id, architectureEntityId(isGroup ? "group" : "node"));
  const parentId = text(node?.parentId || node?.parent_id);
  const position = jsonObject(node?.position) || {};
  const width = numberValue(node?.width || node?.style?.width, isGroup ? 360 : 184);
  const height = numberValue(node?.height || node?.style?.height, isGroup ? 220 : 76);

  return {
    id,
    type: isGroup ? "architectureGroup" : "architectureNode",
    parentId: parentId || undefined,
    extent: parentId && !isGroup ? "parent" : undefined,
    position: {
      x: numberValue(position.x, 80 + (index % 3) * 220),
      y: numberValue(position.y, 80 + Math.floor(index / 3) * 120),
    },
    style: isGroup ? { width, height } : undefined,
    data: {
      color: text(node?.color),
      icon: text(node?.icon),
      kind: isGroup ? "group" : rawKind,
      subtitle: text(node?.subtitle || node?.description),
      title: text(node?.title || node?.label, isGroup ? "Group" : "Node"),
    },
  };
}

function architectureFlowEdgeFromGraphEdge(edge) {
  const source = text(edge?.source || edge?.from);
  const target = text(edge?.target || edge?.to);
  if (!source || !target) return null;
  return {
    id: text(edge?.id, `${source}-${target}`),
    source,
    target,
    type: "architectureEdge",
    markerEnd: {
      color: "rgba(125, 211, 252, 0.88)",
      height: 18,
      type: MarkerType.ArrowClosed,
      width: 18,
    },
    data: {
      kind: text(edge?.kind, "calls"),
      label: text(edge?.label || edge?.title),
    },
  };
}

function architectureGraphToFlow(graph) {
  const compiledGraph = architectureParseDslGraph(graph) || graph;
  const nodes = jsonArray(compiledGraph?.nodes).map(architectureFlowNodeFromGraphNode);
  const edges = jsonArray(compiledGraph?.edges)
    .map(architectureFlowEdgeFromGraphEdge)
    .filter(Boolean);
  return { edges, nodes };
}

function architectureFlowGraphToDsl(graph, nodes, edges) {
  const currentGraph = jsonObject(graph) || {};
  const graphTitle = text(currentGraph.title, "Architecture graph");
  const groupPath = architectureFolderPathParts(currentGraph.groupPath);
  const groupNodes = nodes.filter((node) => node.type === "architectureGroup");
  const regularNodes = nodes.filter((node) => node.type !== "architectureGroup");
  const childrenByParent = new Map();
  [...groupNodes, ...regularNodes].forEach((node) => {
    const parentId = text(node.parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const lineForNode = (node, depth) => {
    const props = {
      icon: node.data?.icon || node.data?.kind,
      desc: node.data?.subtitle,
    };
    return `${"  ".repeat(depth)}${architectureDslName(node.data?.title || node.id)}${architectureDslPropsText(props)}`;
  };
  const lines = [
    `title ${architectureDslString(graphTitle)}`,
    "direction right",
  ];
  if (groupPath.length) lines.push(`folder ${architectureDslString(groupPath.join(" / "))}`);
  lines.push("");
  const emitGroup = (group, depth = 0) => {
    lines.push(`${"  ".repeat(depth)}${architectureDslName(group.data?.title || group.id)}${architectureDslPropsText({
      icon: group.data?.icon || "box",
      color: group.data?.color,
      desc: group.data?.subtitle,
    })} {`);
    const children = childrenByParent.get(group.id) || [];
    children.filter((child) => child.type === "architectureGroup").forEach((childGroup) => emitGroup(childGroup, depth + 1));
    children.filter((child) => child.type !== "architectureGroup").forEach((child) => lines.push(lineForNode(child, depth + 1)));
    lines.push(`${"  ".repeat(depth)}}`);
    lines.push("");
  };
  (childrenByParent.get("") || [])
    .filter((node) => node.type === "architectureGroup")
    .forEach((group) => emitGroup(group));
  (childrenByParent.get("") || [])
    .filter((node) => node.type !== "architectureGroup")
    .forEach((node) => lines.push(lineForNode(node, 0)));
  if (edges.length) lines.push("");
  const titleById = new Map(nodes.map((node) => [node.id, node.data?.title || node.id]));
  edges.forEach((edge) => {
    const source = architectureDslName(titleById.get(edge.source) || edge.source);
    const target = architectureDslName(titleById.get(edge.target) || edge.target);
    const label = text(edge.data?.label);
    lines.push(`${source} > ${target}${label ? `: ${label}` : ""}`);
  });
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim()}\n`;
}

function architectureGraphFromFlow(graph, nodes, edges) {
  const currentGraph = jsonObject(graph) || {};
  const source = architectureFlowGraphToDsl(currentGraph, nodes, edges);
  return {
    ...currentGraph,
    source,
    sourceFormat: "eraserDsl",
    nodes: nodes.map((node) => {
      const isGroup = node.type === "architectureGroup";
      return {
        id: node.id,
        title: text(node.data?.title, isGroup ? "Group" : "Node"),
        subtitle: text(node.data?.subtitle),
        icon: text(node.data?.icon),
        color: text(node.data?.color),
        kind: isGroup ? "group" : text(node.data?.kind, "service"),
        type: isGroup ? "group" : "node",
        position: {
          x: Math.round(numberValue(node.position?.x, 0)),
          y: Math.round(numberValue(node.position?.y, 0)),
        },
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(isGroup ? {
          height: Math.round(numberValue(node.style?.height, 220)),
          width: Math.round(numberValue(node.style?.width, 360)),
        } : {}),
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: text(edge.data?.label),
      kind: text(edge.data?.kind, "calls"),
    })),
    layout: {
      ...(jsonObject(graph?.layout) || {}),
      engine: "manual",
    },
  };
}

function formatDurationMs(value) {
  const ms = numberValue(value, 0);
  if (!ms) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function formatRelativeTimeMs(value, nowMs = Date.now()) {
  const ms = parseTimeMs(value);
  if (!ms) return "";
  const deltaMs = Math.max(0, nowMs - ms);
  if (deltaMs < 45_000) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(deltaMs / 86_400_000);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return formatTime(ms);
}

function formatTimelineDuration(startMs, endMs, active) {
  if (!startMs) return "";
  const durationMs = (endMs || Date.now()) - startMs;
  const formatted = formatDurationMs(Math.max(0, durationMs));
  if (!formatted) return "";
  return active ? `${formatted} live` : formatted;
}

function taskStartMs(task) {
  return parseTimeMs(task?.started_at)
    || parseTimeMs(task?.task_started_at)
    || parseTimeMs(task?.created_at)
    || parseTimeMs(task?.task_created_at)
    || parseTimeMs(task?.first_mutation_at)
    || parseTimeMs(task?.updated_at)
    || parseTimeMs(task?.last_mutation_at);
}

function taskEndMs(task) {
  return parseTimeMs(task?.finished_at)
    || parseTimeMs(task?.completed_at)
    || parseTimeMs(task?.merged_at);
}

function taskUpdatedMs(task) {
  return parseTimeMs(task?.updated_at)
    || parseTimeMs(task?.task_updated_at)
    || parseTimeMs(task?.last_mutation_at)
    || taskEndMs(task)
    || taskStartMs(task);
}

function taskStatusKind(task) {
  const status = taskStatus(task).toLowerCase().replaceAll("_", "-");
  if (["merged", "applied", "done", "completed", "complete", "success", "idle", "ready", "prompt-ready"].includes(status)) return "done";
  if (["active", "running", "started", "claimed", "in-progress", "working", "starting"].includes(status)) return "active";
  if (["integrator-reviewing", "merge-queued", "patch-submitted", "resolved-patch-submitted", "review", "submitted"].includes(status)) return "active";
  if (["queued", "dispatched"].includes(status)) return "queued";
  if (["blocked"].includes(status)) return "blocked";
  if (["parked", "waiting", "paused", "resume-ready", "resume-requested"].includes(status)) return "parked";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["interrupted"].includes(status)) return "interrupted";
  if (["rolled back", "rolled-back"].includes(status)) return "rolled-back";
  if (["skipped"].includes(status)) return "skipped";
  return "unknown";
}

const TASK_TIMELINE_STATUS_LABELS = {
  active: "Active",
  blocked: "Blocked",
  cancelled: "Cancelled",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  parked: "Parked",
  queued: "Queued",
  "rolled-back": "Rolled Back",
  skipped: "Skipped",
  unknown: "Unknown",
};

function taskStatusLabel(task) {
  const status = taskStatus(task).replaceAll("_", " ");
  return status || "unknown";
}

function terminalPlanStatusKind(plan) {
  const status = text(plan?.status).toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "done", "finished", "success"].includes(status)) return "completed";
  if (["interrupted", "cancelled", "canceled", "stopped"].includes(status)) return "interrupted";
  if (["blocked"].includes(status)) return "blocked";
  return status ? "active" : "unknown";
}

function taskTimelineStatusLabel(task) {
  return TASK_TIMELINE_STATUS_LABELS[taskStatusKind(task)] || TASK_TIMELINE_STATUS_LABELS.unknown;
}

function taskIsActive(task) {
  return ["active", "parked"].includes(taskStatusKind(task)) && !taskEndMs(task);
}

function taskDisplayTitle(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  return text(
    terminalPlan?.title
      || terminalPlan?.name
      || task?.plan_title
      || task?.planTitle
      || metadata?.plan_title
      || metadata?.planTitle
      || task?.title
      || task?.name
      || metadata?.title
      || metadata?.name,
    "Untitled plan",
  );
}

function taskBody(task) {
  const terminalPlan = taskTerminalPlan(task);
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return text(
    task?.body
      || task?.prompt
      || task?.input
      || task?.user_input
      || task?.userInput
      || task?.description
      || task?.details
      || task?.summary
      || task?.request
      || metadata?.body
      || metadata?.prompt
      || metadata?.input
      || metadata?.user_input
      || metadata?.userInput
      || terminalPlan?.description
      || terminalPlan?.detail
      || task?.start_task_plan,
  );
}

function taskAgentLabel(task) {
  return text(task?.coding_agent || task?.agent_kind || task?.agent || task?.agent_id);
}

function taskRelativeStamp(item) {
  if (!item) return "";
  if (item.active) return "live now";
  const referenceMs = item.endMs || item.updatedMs || item.startMs;
  return formatRelativeTimeMs(referenceMs) || "unknown";
}

function addUniqueInputBlock(blocks, label, value) {
  const content = text(value);
  if (!content || blocks.some((block) => block.content === content)) return;
  blocks.push({ content, label });
}

function taskInputBlocks(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  const blocks = [];

  addUniqueInputBlock(blocks, "Input", task?.input);
  addUniqueInputBlock(blocks, "Input", task?.user_input);
  addUniqueInputBlock(blocks, "Input", task?.userInput);
  addUniqueInputBlock(blocks, "Input", task?.prompt);
  addUniqueInputBlock(blocks, "Input", task?.body);
  addUniqueInputBlock(blocks, "Input", task?.request);
  addUniqueInputBlock(blocks, "Input", task?.description);
  addUniqueInputBlock(blocks, "Input", metadata?.input);
  addUniqueInputBlock(blocks, "Input", metadata?.user_input);
  addUniqueInputBlock(blocks, "Input", metadata?.userInput);
  addUniqueInputBlock(blocks, "Input", metadata?.prompt);
  addUniqueInputBlock(blocks, "Input", metadata?.body);
  addUniqueInputBlock(blocks, "Input", metadata?.request);
  addUniqueInputBlock(blocks, "Input", terminalPlan?.description);

  addUniqueInputBlock(blocks, "Park resume", task?.parked_prompt);
  addUniqueInputBlock(blocks, "Park resume", task?.parkedPrompt);
  addUniqueInputBlock(blocks, "Park resume", task?.parked_resume_input);
  addUniqueInputBlock(blocks, "Park resume", task?.parkedResumeInput);
  addUniqueInputBlock(blocks, "Park resume", task?.resume_prompt);
  addUniqueInputBlock(blocks, "Park resume", task?.resumePrompt);
  addUniqueInputBlock(blocks, "Park resume", task?.resume_input);
  addUniqueInputBlock(blocks, "Park resume", task?.resumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parked_prompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parkedPrompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parked_resume_input);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parkedResumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_prompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumePrompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_input);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_instruction);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumeInstruction);

  return blocks;
}

function planStepStatusKind(step) {
  const status = text(step?.status || step?.state || step?.phase).toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "done", "finished", "success"].includes(status)) return "completed";
  if (["active", "current", "in-progress", "running", "working", "pending"].includes(status)) return "active";
  if (["blocked", "interrupted"].includes(status)) return "blocked";
  if (["skipped"].includes(status)) return "skipped";
  if (["cancelled", "canceled", "failed", "error"].includes(status)) return "failed";
  return "queued";
}

function planStepStatusLabel(step) {
  const kind = planStepStatusKind(step);
  if (kind === "completed") return "Done";
  if (kind === "active") return "Active";
  if (kind === "blocked") return "Blocked";
  if (kind === "skipped") return "Skipped";
  if (kind === "failed") return "Failed";
  return "Queued";
}

function planStepTitle(step, index) {
  return text(
    step?.title
      || step?.step
      || step?.task
      || step?.objective
      || (typeof step === "string" ? step : ""),
    `Step ${index + 1}`,
  );
}

function planStepDetail(step) {
  return text(
    step?.detail
      || step?.details
      || step?.description
      || step?.done_when
      || step?.doneWhen
      || step?.summary
      || step?.result,
  );
}

function buildTimelineItems(tasks) {
  const normalized = jsonArray(tasks)
    .map((task, index) => {
      const startMs = taskStartMs(task);
      const endMs = taskEndMs(task);
      const active = taskIsActive(task);
      return {
        active,
        endMs,
        index,
        label: taskDisplayTitle(task),
        startMs,
        statusKind: taskStatusKind(task),
        statusLabel: taskTimelineStatusLabel(task),
        rawStatusLabel: taskStatusLabel(task),
        task,
        taskId: text(task?.task_id || task?.id, `task-${index}`),
        updatedMs: taskUpdatedMs(task),
      };
    })
    .filter((item) => item.taskId);

  const ascending = [...normalized].sort((left, right) => (
    (left.startMs || left.updatedMs || 0) - (right.startMs || right.updatedMs || 0)
      || left.index - right.index
  ));
  const laneEnds = [];
  ascending.forEach((item) => {
    const startMs = item.startMs || item.updatedMs || 0;
    const endMs = item.endMs || (item.active ? Date.now() : item.updatedMs || startMs);
    let lane = laneEnds.findIndex((laneEnd) => startMs >= laneEnd);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = Math.max(laneEnds[lane] || 0, endMs || startMs);
    item.lane = lane;
  });

  return {
    laneCount: Math.max(1, laneEnds.length),
    rows: normalized.sort((left, right) => (
      (right.startMs || right.updatedMs || 0) - (left.startMs || left.updatedMs || 0)
        || right.index - left.index
    )),
  };
}

function mountField(mount, camelKey, snakeKey, fallback = "") {
  return text(mount?.[camelKey] ?? mount?.[snakeKey], fallback);
}

function rawGraphNodeKind(mount) {
  const mountKind = mountField(mount, "mountKind", "mount_kind");
  const projectKind = mountField(mount, "projectKind", "project_kind");
  if (mountKind === "container" || projectKind === "container") return "container";
  if (projectKind === "git" || mount?.hasGit === true || mount?.has_git === true) return "git";
  return "project";
}

function rawGraphParentPath(relativePath) {
  const parts = text(relativePath).split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function buildRawScanGraph(scan) {
  const object = jsonObject(scan);
  if (!object) {
    return {
      edges: [],
      nodes: [],
      stats: {
        cacheLabel: "No scan data",
        cacheReason: "Raw Scan reads the cached startup topology. No cached response has been loaded yet.",
        cacheStatus: "waiting",
        projectCount: 0,
        sourceLabel: "Waiting",
        workspaceKind: "workspace",
      },
    };
  }

  const nodeMap = new Map();
  const edgeMap = new Map();
  const rootId = "root";
  const rootName = text(object.workspaceName) || pathName(object.root, "workspace");

  const addNode = (node) => {
    const existing = nodeMap.get(node.id) || {};
    nodeMap.set(node.id, {
      ...existing,
      ...node,
      depth: Math.max(numberValue(existing.depth, 0), numberValue(node.depth, 0)),
    });
  };
  const addEdge = (from, to) => {
    if (!from || !to || from === to) return;
    edgeMap.set(`${from}->${to}`, { from, to });
  };

  addNode({
    id: rootId,
    kind: "root",
    label: rootName,
    meta: text(object.workspaceKind, "workspace"),
    path: text(object.root),
    relativePath: "",
    badge: text(object.scanMode, "cached_topology").replaceAll("_", " "),
    depth: 0,
  });

  const mounts = [
    ...jsonArray(object.workspaceMounts),
    ...jsonArray(object.projectMounts),
  ];
  const seenMountKeys = new Set();
  const mountNodes = [];

  mounts.forEach((mount) => {
    const relativePath = mountField(mount, "workspaceRelativePath", "workspace_relative_path");
    const mountId = mountField(mount, "mountId", "mount_id", relativePath || "root");
    const key = mountId || relativePath || mountField(mount, "projectRoot", "project_root");
    if (!key || seenMountKeys.has(key)) return;
    seenMountKeys.add(key);
    if (!relativePath) {
      addNode({
        id: rootId,
        kind: "root",
        label: mountField(mount, "projectName", "project_name", rootName),
        meta: mountField(mount, "projectKind", "project_kind", text(object.workspaceKind, "workspace")),
        path: mountField(mount, "projectRoot", "project_root", text(object.root)),
        relativePath: "",
        badge: mountField(mount, "mountKind", "mount_kind", "root"),
        depth: 0,
      });
      return;
    }
    mountNodes.push({ mount, mountId, relativePath });
    addNode({
      id: `mount:${mountId}`,
      kind: rawGraphNodeKind(mount),
      label: mountField(mount, "projectName", "project_name", pathName(relativePath, "project")),
      meta: relativePath,
      path: mountField(mount, "projectRoot", "project_root"),
      relativePath,
      badge: mountField(mount, "projectKind", "project_kind", "project"),
      depth: numberValue(mount?.mountDepth ?? mount?.mount_depth, relativePath.split("/").filter(Boolean).length),
      mountId,
    });
  });

  const idByMountId = new Map(mountNodes.map((entry) => [entry.mountId, `mount:${entry.mountId}`]));
  const idByPath = new Map(mountNodes.map((entry) => [entry.relativePath, `mount:${entry.mountId}`]));
  mountNodes.forEach(({ mount, mountId, relativePath }) => {
    const parentMountId = mountField(mount, "parentMountId", "parent_mount_id");
    const parentId = idByMountId.get(parentMountId)
      || idByPath.get(rawGraphParentPath(relativePath))
      || rootId;
    addEdge(parentId, `mount:${mountId}`);
  });

  if (nodeMap.size <= 1) {
    const traceEntries = jsonArray(object.folderTrace?.entries);
    const traceIdByPath = new Map();
    traceEntries.forEach((entry, index) => {
      const relativePath = text(entry?.relativePath);
      if (!relativePath && index > 0) return;
      const id = relativePath ? `trace:${relativePath}` : rootId;
      traceIdByPath.set(relativePath, id);
      const depth = numberValue(entry?.depth, relativePath.split("/").filter(Boolean).length);
      addNode({
        id,
        kind: entry?.skipped ? "skipped" : text(entry?.projectKind) === "git" ? "git" : "trace",
        label: relativePath ? pathName(relativePath) : rootName,
        meta: relativePath || text(object.root),
        path: text(entry?.path),
        relativePath,
        badge: text(entry?.scanAction, "scan").replaceAll("_", " "),
        depth,
      });
    });
    traceEntries.forEach((entry, index) => {
      const relativePath = text(entry?.relativePath);
      if (!relativePath && index > 0) return;
      if (!relativePath) return;
      const parentRelativePath = rawGraphParentPath(relativePath);
      const parentId = traceIdByPath.get(parentRelativePath) || idByPath.get(parentRelativePath) || rootId;
      const id = traceIdByPath.get(relativePath);
      if (id !== rootId) {
        addEdge(parentId, id);
      }
    });
  }

  const nodes = Array.from(nodeMap.values());
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.from(edgeMap.values()).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const cacheStatus = text(object.cache?.status, "missing");
  const cacheAge = formatDurationMs(object.cache?.ageMs);
  const cacheReason = text(
    object.cache?.reason
      || object.diagnostic?.reason
      || object.folderTrace?.reason
      || (cacheStatus === "missing"
        ? "No terminal startup topology has populated this workspace cache yet. Raw Scan does not rescan."
        : ""),
  );

  return {
    edges,
    nodes,
    stats: {
      cacheLabel: cacheAge ? `${cacheStatus} · ${cacheAge}` : cacheStatus,
      cacheReason,
      cacheStatus,
      projectCount: jsonArray(object.projectMounts).length,
      sourceLabel: text(object.scanMode, "cached_topology").replaceAll("_", " "),
      workspaceKind: text(object.workspaceKind, "workspace"),
    },
  };
}

function layoutRawScanGraph(graph) {
  const nodes = jsonArray(graph?.nodes);
  if (!nodes.length) {
    return { edges: [], height: 360, nodes: [], width: 760 };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  jsonArray(graph?.edges).forEach((edge) => {
    if (!byId.has(edge.from) || !byId.has(edge.to)) return;
    if (!childrenByParent.has(edge.from)) childrenByParent.set(edge.from, []);
    childrenByParent.get(edge.from).push(edge.to);
  });

  childrenByParent.forEach((children) => {
    children.sort((left, right) => {
      const leftNode = byId.get(left);
      const rightNode = byId.get(right);
      return numberValue(leftNode?.depth, 0) - numberValue(rightNode?.depth, 0)
        || text(leftNode?.label).localeCompare(text(rightNode?.label));
    });
  });

  const positioned = new Map();
  const visited = new Set();
  let nextY = 54;
  let maxDepth = 0;

  const place = (id, depth = 0) => {
    if (visited.has(id)) return positioned.get(id)?.y || nextY;
    visited.add(id);
    const node = byId.get(id);
    const children = childrenByParent.get(id) || [];
    const childYs = children.map((childId) => place(childId, depth + 1));
    const y = childYs.length
      ? childYs.reduce((sum, value) => sum + value, 0) / childYs.length
      : nextY;
    if (!childYs.length) nextY += 88;
    const nodeDepth = Math.max(depth, numberValue(node?.depth, depth));
    maxDepth = Math.max(maxDepth, nodeDepth);
    positioned.set(id, {
      ...node,
      depth: nodeDepth,
      x: 44 + nodeDepth * 245,
      y,
    });
    return y;
  };

  place("root", 0);
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      place(node.id, numberValue(node.depth, 1));
    }
  });

  return {
    edges: jsonArray(graph?.edges),
    height: Math.max(360, nextY + 38),
    nodes: Array.from(positioned.values()),
    width: Math.max(760, 44 + (maxDepth + 1) * 245 + 250),
  };
}

export default function ArchitectureWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  architectureError = "",
  architectureSnapshot = null,
  architectureState = "idle",
  rawScanError = "",
  rawScanSnapshot = null,
  rawScanState = "idle",
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const repoPath = workspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const [viewMode, setViewMode] = useState("architectures");
  const [localArchitectureSnapshot, setLocalArchitectureSnapshot] = useState(architectureSnapshot);
  const [finishPlanState, setFinishPlanState] = useState({ error: "", taskId: "" });
  const [finishedPlanTaskIds, setFinishedPlanTaskIds] = useState(() => new Set());
  const activeArchitectureSnapshot = localArchitectureSnapshot || architectureSnapshot;
  const taskHistory = useMemo(() => taskHistoryFromSnapshot(activeArchitectureSnapshot), [activeArchitectureSnapshot]);
  const tasks = useMemo(() => jsonArray(taskHistory.tasks), [taskHistory]);
  const visibleTasks = useMemo(() => {
    if (!finishedPlanTaskIds.size) return tasks;
    return tasks.map((task, index) => {
      const taskId = taskPlanTaskId(task, `task-${index}`);
      return finishedPlanTaskIds.has(taskId) ? taskWithCompletedTerminalPlan(task) : task;
    });
  }, [finishedPlanTaskIds, tasks]);
  const repoLabel = pathName(repoPath || rootDirectory || defaultWorkingDirectory, "repo");
  const toolbarMeta = viewMode === "architectures"
    ? `Architectures · repo scoped · ${repoLabel}`
    : viewMode === "rawScan"
      ? `Raw Scan · startup cache · ${repoLabel}`
      : `Task History · ${tasks.length} task${tasks.length === 1 ? "" : "s"} · repo: ${repoLabel} · live`;
  const visibleArchitectureError = architectureCloudMcpNoiseError(architectureError) ? "" : architectureError;

  useEffect(() => {
    setLocalArchitectureSnapshot(architectureSnapshot);
  }, [architectureSnapshot]);

  useEffect(() => {
    setFinishedPlanTaskIds(new Set());
    setFinishPlanState({ error: "", taskId: "" });
  }, [repoPath, workspaceId]);

  const refreshTaskHistorySnapshot = useCallback(() => {
    if (!repoPath || !workspaceId) {
      return Promise.resolve(null);
    }
    return invoke("cloud_mcp_get_task_history", {
      repoPath,
      workspaceId,
      workspaceName,
    }).then((result) => {
      setLocalArchitectureSnapshot(result);
      return result;
    });
  }, [repoPath, workspaceId, workspaceName]);

  const finishTerminalTaskPlan = useCallback((item) => {
    const task = item?.task || null;
    const terminalPlan = taskTerminalPlan(task);
    const taskId = text(
      terminalPlan?.task_id
        || terminalPlan?.taskId
        || task?.task_id
        || task?.id
        || item?.taskId,
    );
    if (!taskId || !repoPath) return;

    setFinishPlanState({ error: "", taskId });
    invoke("coordination_terminal_task_plan_finish", {
      repoPath,
      input: {
        agent_id: terminalPlan?.agent_id || terminalPlan?.agentId || task?.agent_id || task?.agentId || taskAgentLabel(task),
        direct_repo_target: true,
        session_id: terminalPlan?.session_id || terminalPlan?.sessionId || task?.session_id || task?.sessionId,
        task_id: taskId,
        workspace_id: workspaceId,
      },
    })
      .then((response) => {
        if (response?.data?.plan_finished === false) {
          throw new Error("No terminal plan was found to finish.");
        }
        setFinishedPlanTaskIds((current) => {
          const next = new Set(current);
          next.add(taskId);
          return next;
        });
        setFinishPlanState((current) => (
          current.taskId === taskId ? { error: "", taskId: "" } : current
        ));
        void refreshTaskHistorySnapshot().catch((error) => {
          setFinishPlanState((current) => ({
            ...current,
            error: `Plan finished locally. Cloud refresh failed: ${error?.message || String(error || "Unable to refresh task history.")}`,
          }));
        });
      })
      .catch((error) => {
        setFinishPlanState({
          error: error?.message || String(error || "Unable to finish terminal plan."),
          taskId: "",
        });
      });
  }, [refreshTaskHistorySnapshot, repoPath, workspaceId]);

  return (
    <ArchitectureSurface aria-label={`${workspace?.name || "Workspace"} Architecture`} data-state={architectureState}>
      <ArchitectureToolbar>
        <ViewToggleGroup aria-label="Architecture view mode">
          <ViewToggleButton
            data-active={viewMode === "architectures" ? "true" : "false"}
            onClick={() => setViewMode("architectures")}
            type="button"
          >
            Architectures
          </ViewToggleButton>
          <ViewToggleButton
            data-active={viewMode === "taskHistory" ? "true" : "false"}
            onClick={() => setViewMode("taskHistory")}
            type="button"
          >
            Task History
          </ViewToggleButton>
          <ViewToggleButton
            data-active={viewMode === "rawScan" ? "true" : "false"}
            onClick={() => setViewMode("rawScan")}
            type="button"
          >
            Raw Scan
          </ViewToggleButton>
        </ViewToggleGroup>
        <ToolbarMeta>{toolbarMeta}</ToolbarMeta>
      </ArchitectureToolbar>

      {viewMode === "architectures" ? (
        <ArchitecturesPanel
          repoLabel={repoLabel}
          repoPath={repoPath}
        />
      ) : viewMode === "rawScan" ? (
        <RawScanPanel
          error={rawScanError}
          scan={rawScanSnapshot}
          state={rawScanState}
        />
      ) : (
        <HistoryTimeline
          finishPlanError={finishPlanState.error}
          finishingPlanTaskId={finishPlanState.taskId}
          onFinishPlan={finishTerminalTaskPlan}
          tasks={visibleTasks}
          repoLabel={repoLabel}
        />
      )}
      {visibleArchitectureError && (
        <ArchitectureErrorToast aria-live="polite" role="status" title={visibleArchitectureError}>
          <strong>Architecture sync issue</strong>
          <span>{visibleArchitectureError}</span>
        </ArchitectureErrorToast>
      )}
    </ArchitectureSurface>
  );
}

function ArchitecturesPanel({ repoLabel, repoPath }) {
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState("");
  const [repoState, setRepoState] = useState("loading");
  const [graphs, setGraphs] = useState([]);
  const [graphState, setGraphState] = useState("idle");
  const [selectedGraphId, setSelectedGraphId] = useState("");
  const [selectedGraph, setSelectedGraph] = useState(null);
  const [error, setError] = useState("");
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [draftTitle, setDraftTitle] = useState("Architecture graph");
  const [draftLocationMode, setDraftLocationMode] = useState("root");
  const [draftFolderPath, setDraftFolderPath] = useState("");
  const [saveState, setSaveState] = useState("idle");

  useEffect(() => {
    let cancelled = false;
    setRepoState("loading");
    setError("");
    invoke("architecture_repositories", { rootDirectory: repoPath || null })
      .then((result) => {
        if (cancelled) return;
        const nextRepositories = jsonArray(result?.repositories);
        setRepositories(nextRepositories);
        setSelectedRepoPath((current) => {
          if (current && nextRepositories.some((repo) => repo.path === current)) return current;
          return nextRepositories[0]?.path || "";
        });
        setRepoState("ready");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setRepositories([]);
        setSelectedRepoPath("");
        setCreatingGraph(false);
        setRepoState("error");
        setError(nextError?.message || String(nextError || "Unable to load architecture repositories."));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const loadGraphList = useCallback((repo = selectedRepoPath, options = {}) => {
    if (!repo) {
      setGraphs([]);
      setSelectedGraphId("");
      setSelectedGraph(null);
      return Promise.resolve([]);
    }
    if (!options.silent) setGraphState("loading");
    setError("");
    return invoke("architecture_graphs_list", { repoPath: repo })
      .then((result) => {
        const nextGraphs = jsonArray(result?.graphs);
        setGraphs(nextGraphs);
        setRepositories((currentRepositories) => currentRepositories.map((repository) => (
          repository.path === repo
            ? { ...repository, graphCount: nextGraphs.length }
            : repository
        )));
        setSelectedGraphId((current) => {
          if (current && nextGraphs.some((graph) => graph.id === current)) return current;
          return nextGraphs[0]?.id || "";
        });
        if (!nextGraphs.length) {
          setSelectedGraph(null);
        }
        setGraphState("ready");
        return nextGraphs;
      })
      .catch((nextError) => {
        setGraphs([]);
        setSelectedGraphId("");
        setSelectedGraph(null);
        setGraphState("error");
        setError(nextError?.message || String(nextError || "Unable to load architecture graphs."));
        return [];
      });
  }, [selectedRepoPath]);

  useEffect(() => {
    void loadGraphList(selectedRepoPath);
  }, [loadGraphList, selectedRepoPath]);

  useEffect(() => {
    if (!selectedRepoPath) return undefined;
    const interval = window.setInterval(() => {
      void loadGraphList(selectedRepoPath, { silent: true });
    }, 1800);
    return () => window.clearInterval(interval);
  }, [loadGraphList, selectedRepoPath]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRepoPath || !selectedGraphId) {
      setSelectedGraph(null);
      return () => {
        cancelled = true;
      };
    }

    setGraphState("loading");
    invoke("architecture_graph_read", {
      graphId: selectedGraphId,
      repoPath: selectedRepoPath,
    })
      .then((graph) => {
        if (cancelled) return;
        setSelectedGraph(graph);
        setGraphState("ready");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setSelectedGraph(null);
        setGraphState("error");
        setError(nextError?.message || String(nextError || "Unable to read architecture graph."));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGraphId, selectedRepoPath]);

  useEffect(() => {
    if (!selectedRepoPath || !selectedGraphId || creatingGraph || saveState === "saving") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      invoke("architecture_graph_read", {
        graphId: selectedGraphId,
        repoPath: selectedRepoPath,
      })
        .then((graph) => {
          setSelectedGraph((current) => {
            const currentSource = text(current?.source);
            const nextSource = text(graph?.source);
            const currentUpdatedAt = text(current?.updatedAt);
            const nextUpdatedAt = text(graph?.updatedAt);
            if (currentSource === nextSource && currentUpdatedAt === nextUpdatedAt) {
              return current;
            }
            return graph;
          });
        })
        .catch(() => {});
    }, 1200);
    return () => window.clearInterval(interval);
  }, [creatingGraph, saveState, selectedGraphId, selectedRepoPath]);

  const selectedRepo = repositories.find((repo) => repo.path === selectedRepoPath) || null;
  const isLoading = repoState === "loading" || graphState === "loading";
  const singleRepository = repositories.length <= 1;
  const treeRows = useMemo(() => architectureGraphTreeRows(graphs, singleRepository ? 0 : 1), [graphs, singleRepository]);
  const folderSuggestions = useMemo(() => (
    [...new Set(graphs.map((graph) => architectureFolderPathText(graph.groupPath)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
  ), [graphs]);

  const beginCreateGraph = useCallback((folderPath = "") => {
    const nextFolderPath = text(folderPath);
    setDraftTitle("Architecture graph");
    setDraftLocationMode(nextFolderPath ? "folder" : "root");
    setDraftFolderPath(nextFolderPath);
    setCreatingGraph(true);
    setError("");
  }, []);

  const createGraph = useCallback(() => {
    if (!selectedRepoPath) return;
    const groupPath = draftLocationMode === "folder" ? draftFolderPath : "";
    const graph = architectureStarterGraph({
      groupPath,
      kind: "architecture",
      title: draftTitle,
    });
    setSaveState("saving");
    setError("");
    invoke("architecture_graph_save", {
      graph,
      repoPath: selectedRepoPath,
    })
      .then((result) => {
        setSelectedGraph(result?.graph || graph);
        setSelectedGraphId(result?.graphId || graph.id);
        setCreatingGraph(false);
        setDraftTitle("Architecture graph");
        setDraftLocationMode("root");
        setDraftFolderPath("");
        setSaveState("idle");
        void loadGraphList(selectedRepoPath);
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to create architecture graph."));
      });
  }, [draftFolderPath, draftLocationMode, draftTitle, loadGraphList, selectedRepoPath]);

  const saveGraph = useCallback((graph) => {
    if (!selectedRepoPath) return Promise.reject(new Error("Select a repository first."));
    setSaveState("saving");
    setError("");
    return invoke("architecture_graph_save", {
      graph,
      repoPath: selectedRepoPath,
    })
      .then((result) => {
        const nextGraph = result?.graph || graph;
        setSelectedGraph(nextGraph);
        setSelectedGraphId(result?.graphId || nextGraph.id);
        setSaveState("idle");
        void loadGraphList(selectedRepoPath);
        return nextGraph;
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to save architecture graph."));
        throw nextError;
      });
  }, [loadGraphList, selectedRepoPath]);

  const renderTreeRows = useCallback((emptyDepth = 0) => (
    <>
      {treeRows.map((row) => (
        row.kind === "folder" ? (
          <ArchitectureTreeRow
            data-kind="folder"
            key={`folder-${row.id}`}
            onClick={() => beginCreateGraph(row.path.join(" / "))}
            style={{ "--tree-depth": row.depth }}
            title={row.path.join(" / ")}
            type="button"
          >
            <ArchitectureTreeGlyph data-kind="folder" aria-hidden="true" />
            <span>{row.name}</span>
          </ArchitectureTreeRow>
        ) : (
          <ArchitectureTreeRow
            data-active={row.graph.id === selectedGraphId && !creatingGraph ? "true" : "false"}
            data-kind="graph"
            key={`graph-${row.graph.id}`}
            onClick={() => {
              setSelectedGraphId(row.graph.id);
              setCreatingGraph(false);
            }}
            style={{ "--tree-depth": row.depth }}
            title={row.graph.filePath}
            type="button"
          >
            <ArchitectureTreeGlyph data-kind="graph" aria-hidden="true" />
            <span>{row.graph.title}</span>
            <em>{row.graph.nodeCount}</em>
          </ArchitectureTreeRow>
        )
      ))}
      {graphState === "ready" && !graphs.length && (
        <ArchitectureTreeEmpty style={{ "--tree-depth": emptyDepth }}>No graphs yet</ArchitectureTreeEmpty>
      )}
    </>
  ), [beginCreateGraph, creatingGraph, graphState, graphs.length, selectedGraphId, treeRows]);

  return (
    <ArchitecturesShell>
      <ArchitectureNavRail aria-label="Architecture repositories">
        <ArchitectureNavHeader>
          <strong>Architectures</strong>
          <ArchitectureIconButton
            aria-label="Create architecture graph"
            disabled={!selectedRepoPath || saveState === "saving"}
            onClick={() => beginCreateGraph()}
            title="Create architecture graph"
            type="button"
          >
            +
          </ArchitectureIconButton>
        </ArchitectureNavHeader>
        <ArchitectureTree>
          {singleRepository ? renderTreeRows(0) : repositories.map((repo) => (
            <ArchitectureTreeRepoGroup key={repo.id}>
              <ArchitectureTreeRow
                data-active={repo.path === selectedRepoPath ? "true" : "false"}
                data-kind="repo"
                onClick={() => {
                  setSelectedRepoPath(repo.path);
                  setSelectedGraphId("");
                  setSelectedGraph(null);
                  setCreatingGraph(false);
                }}
                style={{ "--tree-depth": 0 }}
                title={repo.path}
                type="button"
              >
                <ArchitectureTreeGlyph data-kind="repo" aria-hidden="true" />
                <span>{repo.name}</span>
                <em>{repo.graphCount}</em>
              </ArchitectureTreeRow>
              {repo.path === selectedRepoPath && (
                <ArchitectureTreeBranch>
                  {renderTreeRows(1)}
                </ArchitectureTreeBranch>
              )}
            </ArchitectureTreeRepoGroup>
          ))}
          {repoState === "ready" && !repositories.length && (
            <ArchitectureEmptyNote>No repository roots detected.</ArchitectureEmptyNote>
          )}
        </ArchitectureTree>
        {selectedRepo && (
          <ArchitectureNavStoragePath title={selectedRepo.architectureRoot}>
            .agents/architectures
          </ArchitectureNavStoragePath>
        )}
      </ArchitectureNavRail>

      <ArchitectureEditorRegion>
        {error && <ArchitectureError>{error}</ArchitectureError>}
        <ArchitectureEditorContent>
          {creatingGraph || !selectedGraph ? (
            <ArchitectureCreateSurface
              canCancel={creatingGraph && Boolean(selectedGraph)}
              draftFolderPath={draftFolderPath}
              draftLocationMode={draftLocationMode}
              draftTitle={draftTitle}
              folderSuggestions={folderSuggestions}
              graphCount={graphs.length}
              isLoading={isLoading}
              onCancel={() => setCreatingGraph(false)}
              onCreate={createGraph}
              onDraftFolderPathChange={setDraftFolderPath}
              onDraftLocationModeChange={setDraftLocationMode}
              onDraftTitleChange={setDraftTitle}
              repoLabel={repoLabel}
              saveState={saveState}
              selectedRepo={selectedRepo}
            />
          ) : (
            <ArchitectureGraphEditor
              graph={selectedGraph}
              onSave={saveGraph}
              saveState={saveState}
            />
          )}
        </ArchitectureEditorContent>
      </ArchitectureEditorRegion>
    </ArchitecturesShell>
  );
}

function ArchitectureCreateSurface({
  canCancel,
  draftFolderPath,
  draftLocationMode,
  draftTitle,
  folderSuggestions,
  graphCount,
  isLoading,
  onCancel,
  onCreate,
  onDraftFolderPathChange,
  onDraftLocationModeChange,
  onDraftTitleChange,
  repoLabel,
  saveState,
  selectedRepo,
}) {
  const canCreate = Boolean(selectedRepo && text(draftTitle));
  const title = isLoading
    ? "Loading architectures..."
    : graphCount ? "Create or select an architecture graph" : "Create architecture graph";

  return (
    <ArchitectureCreateSurfaceShell>
      <ArchitectureCreateDialog>
        <TimelineKicker>{selectedRepo?.name || repoLabel}</TimelineKicker>
        <ArchitectureCreateTitle>{title}</ArchitectureCreateTitle>
        <ArchitectureCreateText>
          Graphs are stored under the selected repo in .agents/architectures.
        </ArchitectureCreateText>
        <ArchitectureField>
          <span>Title</span>
          <ArchitectureInput
            onChange={(event) => onDraftTitleChange(event.target.value)}
            placeholder="Auth flow"
            value={draftTitle}
          />
        </ArchitectureField>
        <ArchitectureField>
          <span>Location</span>
          <ArchitectureLocationToggle aria-label="Architecture graph location">
            <ArchitectureLocationButton
              data-active={draftLocationMode === "root" ? "true" : "false"}
              onClick={() => onDraftLocationModeChange("root")}
              type="button"
            >
              Architecture root
            </ArchitectureLocationButton>
            <ArchitectureLocationButton
              data-active={draftLocationMode === "folder" ? "true" : "false"}
              onClick={() => onDraftLocationModeChange("folder")}
              type="button"
            >
              Folder
            </ArchitectureLocationButton>
          </ArchitectureLocationToggle>
        </ArchitectureField>
        {draftLocationMode === "folder" && (
          <ArchitectureField>
            <span>Folder path</span>
            <ArchitectureInput
              onChange={(event) => onDraftFolderPathChange(event.target.value)}
              placeholder="auth / api"
              value={draftFolderPath}
            />
          </ArchitectureField>
        )}
        {draftLocationMode === "folder" && folderSuggestions.length > 0 && (
          <ArchitectureFolderSuggestions>
            {folderSuggestions.slice(0, 6).map((folderPath) => (
              <button
                key={folderPath}
                onClick={() => onDraftFolderPathChange(folderPath)}
                type="button"
              >
                {folderPath}
              </button>
            ))}
          </ArchitectureFolderSuggestions>
        )}
        <ArchitectureCreateActions>
          {canCancel && (
            <ArchitectureSmallButton onClick={onCancel} type="button">
              Cancel
            </ArchitectureSmallButton>
          )}
          <ArchitecturePrimaryButton
            disabled={!canCreate || saveState === "saving"}
            onClick={onCreate}
            type="button"
          >
            {saveState === "saving" ? "Creating..." : "Create Graph"}
          </ArchitecturePrimaryButton>
        </ArchitectureCreateActions>
      </ArchitectureCreateDialog>
    </ArchitectureCreateSurfaceShell>
  );
}

function ArchitectureGraphEditor({ graph, onSave, saveState }) {
  const initialFlow = useMemo(() => architectureGraphToFlow(graph), [graph]);
  const [nodes, setNodes, handleNodesChange] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, handleEdgesChange] = useEdgesState(initialFlow.edges);
  const [draftGraph, setDraftGraph] = useState(() => jsonObject(graph) || {});
  const [dirty, setDirty] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    const nextFlow = architectureGraphToFlow(graph);
    setNodes(nextFlow.nodes);
    setEdges(nextFlow.edges);
    setDraftGraph(jsonObject(graph) || {});
    setSelectedNodes([]);
    setSelectedEdges([]);
    setDirty(false);
    setLocalError("");
  }, [graph, setEdges, setNodes]);

  const selectedNode = selectedNodes[0]
    ? nodes.find((node) => node.id === selectedNodes[0].id)
    : null;
  const selectedEdge = selectedEdges[0]
    ? edges.find((edge) => edge.id === selectedEdges[0].id)
    : null;

  const onNodesChange = useCallback((changes) => {
    if (changes.some((change) => change.type !== "select")) setDirty(true);
    handleNodesChange(changes);
  }, [handleNodesChange]);

  const onEdgesChange = useCallback((changes) => {
    if (changes.some((change) => change.type !== "select")) setDirty(true);
    handleEdgesChange(changes);
  }, [handleEdgesChange]);

  const onConnect = useCallback((connection) => {
    const id = architectureEntityId("edge");
    setDirty(true);
    setEdges((currentEdges) => addReactFlowEdge({
      ...connection,
      id,
      markerEnd: {
        color: "rgba(125, 211, 252, 0.88)",
        height: 18,
        type: MarkerType.ArrowClosed,
        width: 18,
      },
      type: "architectureEdge",
      data: {
        kind: "calls",
        label: "",
      },
    }, currentEdges));
  }, [setEdges]);

  const updateDraftGraph = useCallback((patch) => {
    setDraftGraph((current) => ({
      ...current,
      ...patch,
    }));
    setDirty(true);
  }, []);

  const addGroup = useCallback(() => {
    const count = nodes.filter((node) => node.type === "architectureGroup").length;
    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: architectureEntityId("group"),
        type: "architectureGroup",
        position: { x: 120 + count * 34, y: 90 + count * 28 },
        style: { height: 240, width: 380 },
        data: {
          icon: "box",
          kind: "group",
          subtitle: "Drag nodes into this area",
          title: `Group ${count + 1}`,
        },
      },
    ]);
    setDirty(true);
  }, [nodes, setNodes]);

  const addNode = useCallback(() => {
    const selectedGroup = selectedNodes.find((node) => node.type === "architectureGroup")
      || (selectedNode?.type === "architectureGroup" ? selectedNode : null);
    const nodeCount = nodes.filter((node) => node.type !== "architectureGroup").length;
    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: architectureEntityId("node"),
        type: "architectureNode",
        parentId: selectedGroup?.id,
        extent: selectedGroup?.id ? "parent" : undefined,
        position: selectedGroup?.id
          ? { x: 44 + (nodeCount % 2) * 190, y: 72 + Math.floor(nodeCount / 2) * 96 }
          : { x: 140 + (nodeCount % 3) * 220, y: 130 + Math.floor(nodeCount / 3) * 128 },
        data: {
          icon: "server",
          kind: "service",
          subtitle: "",
          title: `Node ${nodeCount + 1}`,
        },
      },
    ]);
    setDirty(true);
  }, [nodes, selectedNode, selectedNodes, setNodes]);

  const connectSelectedNodes = useCallback(() => {
    const pair = selectedNodes.filter((node) => node.type !== "architectureGroup").slice(0, 2);
    if (pair.length < 2) {
      setLocalError("Select two non-group nodes to connect.");
      return;
    }
    setLocalError("");
    setEdges((currentEdges) => [
      ...currentEdges,
      {
        id: architectureEntityId("edge"),
        source: pair[0].id,
        target: pair[1].id,
        type: "architectureEdge",
        markerEnd: {
          color: "rgba(125, 211, 252, 0.88)",
          height: 18,
          type: MarkerType.ArrowClosed,
          width: 18,
        },
        data: {
          kind: "calls",
          label: "",
        },
      },
    ]);
    setDirty(true);
  }, [selectedNodes, setEdges]);

  const deleteSelected = useCallback(() => {
    const nodeIds = new Set(selectedNodes.map((node) => node.id));
    const edgeIds = new Set(selectedEdges.map((edge) => edge.id));
    if (!nodeIds.size && !edgeIds.size) return;
    setNodes((currentNodes) => currentNodes.filter((node) => !nodeIds.has(node.id) && !nodeIds.has(node.parentId)));
    setEdges((currentEdges) => currentEdges.filter((edge) => (
      !edgeIds.has(edge.id)
      && !nodeIds.has(edge.source)
      && !nodeIds.has(edge.target)
    )));
    setSelectedNodes([]);
    setSelectedEdges([]);
    setDirty(true);
  }, [selectedEdges, selectedNodes, setEdges, setNodes]);

  const updateSelectedNodeData = useCallback((patch) => {
    if (!selectedNode) return;
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === selectedNode.id
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
    setDirty(true);
  }, [selectedNode, setNodes]);

  const updateSelectedGroupSize = useCallback((field, value) => {
    if (!selectedNode || selectedNode.type !== "architectureGroup") return;
    const numeric = Math.max(field === "width" ? 220 : 150, numberValue(value, selectedNode.style?.[field] || 0));
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === selectedNode.id
        ? { ...node, style: { ...node.style, [field]: numeric } }
        : node
    )));
    setDirty(true);
  }, [selectedNode, setNodes]);

  const updateSelectedEdgeData = useCallback((patch) => {
    if (!selectedEdge) return;
    setEdges((currentEdges) => currentEdges.map((edge) => (
      edge.id === selectedEdge.id
        ? { ...edge, data: { ...edge.data, ...patch } }
        : edge
    )));
    setDirty(true);
  }, [selectedEdge, setEdges]);

  const save = useCallback(() => {
    const nextGraph = architectureGraphFromFlow(draftGraph, nodes, edges);
    setLocalError("");
    onSave(nextGraph)
      .then(() => setDirty(false))
      .catch((nextError) => {
        setLocalError(nextError?.message || String(nextError || "Unable to save graph."));
      });
  }, [draftGraph, edges, nodes, onSave]);

  return (
    <ArchitectureEditorShell>
      <ArchitectureEditorToolbar>
        <ArchitectureEditorMeta>
          <ArchitectureField>
            <span>Graph title</span>
            <ArchitectureInput
              onChange={(event) => updateDraftGraph({ title: event.target.value })}
              value={text(draftGraph.title)}
            />
          </ArchitectureField>
          <ArchitectureField>
            <span>Folder</span>
            <ArchitectureInput
              onChange={(event) => updateDraftGraph({
                groupPath: event.target.value
                  .split(/[/>]/u)
                  .map((part) => part.trim())
                  .filter(Boolean),
              })}
              placeholder="auth / api"
              value={jsonArray(draftGraph.groupPath).join(" / ")}
            />
          </ArchitectureField>
        </ArchitectureEditorMeta>
        <ArchitectureEditorActions>
          <ArchitectureSmallButton onClick={addNode} type="button">Add Node</ArchitectureSmallButton>
          <ArchitectureSmallButton onClick={addGroup} type="button">Add Group</ArchitectureSmallButton>
          <ArchitectureSmallButton onClick={connectSelectedNodes} type="button">Connect</ArchitectureSmallButton>
          <ArchitectureDangerButton
            disabled={!selectedNodes.length && !selectedEdges.length}
            onClick={deleteSelected}
            type="button"
          >
            Delete
          </ArchitectureDangerButton>
          <ArchitecturePrimaryButton
            disabled={!dirty || saveState === "saving"}
            onClick={save}
            type="button"
          >
            {saveState === "saving" ? "Saving..." : dirty ? "Save" : "Saved"}
          </ArchitecturePrimaryButton>
        </ArchitectureEditorActions>
      </ArchitectureEditorToolbar>

      {(localError || dirty) && (
        <ArchitectureEditorNotice data-kind={localError ? "error" : "dirty"}>
          {localError || "Unsaved architecture changes"}
        </ArchitectureEditorNotice>
      )}

      <ArchitectureEditorBody>
        <ArchitectureCanvasViewport>
          <ReactFlow
            colorMode="dark"
            defaultEdgeOptions={{
              markerEnd: {
                color: "rgba(125, 211, 252, 0.88)",
                type: MarkerType.ArrowClosed,
              },
              type: "architectureEdge",
            }}
            edgeTypes={architectureEdgeTypes}
            edges={edges}
            fitView
            maxZoom={1.7}
            minZoom={0.18}
            nodeTypes={architectureNodeTypes}
            nodes={nodes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onNodesChange={onNodesChange}
            onSelectionChange={({ nodes: nextNodes, edges: nextEdges }) => {
              setSelectedNodes(nextNodes);
              setSelectedEdges(nextEdges);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(148, 163, 184, 0.22)" gap={22} size={1} />
            <MiniMap
              nodeBorderRadius={8}
              nodeColor={(node) => {
                if (node.type === "architectureGroup") return "rgba(148, 163, 184, 0.24)";
                if (node.data?.kind === "database") return "#34d399";
                if (node.data?.kind === "client") return "#fbbf24";
                if (node.data?.kind === "external") return "#f472b6";
                if (node.data?.kind === "queue") return "#a78bfa";
                return "#38bdf8";
              }}
              pannable
              zoomable
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ArchitectureCanvasViewport>

        <ArchitectureInspector aria-label="Architecture selection inspector">
          <ArchitectureInspectorHeader>
            <span>Selection</span>
            <strong>
              {selectedNode
                ? selectedNode.type === "architectureGroup" ? "Group" : "Node"
                : selectedEdge ? "Edge" : "None"}
            </strong>
          </ArchitectureInspectorHeader>
          {selectedNode ? (
            <>
              <ArchitectureField>
                <span>Title</span>
                <ArchitectureInput
                  onChange={(event) => updateSelectedNodeData({ title: event.target.value })}
                  value={text(selectedNode.data?.title)}
                />
              </ArchitectureField>
              <ArchitectureField>
                <span>Subtitle</span>
                <ArchitectureInput
                  onChange={(event) => updateSelectedNodeData({ subtitle: event.target.value })}
                  value={text(selectedNode.data?.subtitle)}
                />
              </ArchitectureField>
              <ArchitectureField>
                <span>Icon</span>
                <ArchitectureInput
                  onChange={(event) => {
                    const nextIcon = event.target.value;
                    updateSelectedNodeData({
                      icon: nextIcon,
                      ...(selectedNode.type === "architectureGroup" ? {} : {
                        kind: architectureIconKind(nextIcon, selectedNode.data?.kind || "service"),
                      }),
                    });
                  }}
                  placeholder="aws:s3, github, cockroachdb"
                  value={text(selectedNode.data?.icon)}
                />
              </ArchitectureField>
              {selectedNode.type === "architectureGroup" ? (
                <>
                  <ArchitectureField>
                    <span>Width</span>
                    <ArchitectureInput
                      min="220"
                      onChange={(event) => updateSelectedGroupSize("width", event.target.value)}
                      type="number"
                      value={Math.round(numberValue(selectedNode.style?.width, 360))}
                    />
                  </ArchitectureField>
                  <ArchitectureField>
                    <span>Height</span>
                    <ArchitectureInput
                      min="150"
                      onChange={(event) => updateSelectedGroupSize("height", event.target.value)}
                      type="number"
                      value={Math.round(numberValue(selectedNode.style?.height, 220))}
                    />
                  </ArchitectureField>
                </>
              ) : (
                <ArchitectureField>
                  <span>Kind</span>
                  <ArchitectureSelect
                    onChange={(event) => updateSelectedNodeData({ kind: event.target.value })}
                    value={text(selectedNode.data?.kind, "service")}
                  >
                    {ARCHITECTURE_NODE_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </ArchitectureSelect>
                </ArchitectureField>
              )}
            </>
          ) : selectedEdge ? (
            <>
              <ArchitectureField>
                <span>Label</span>
                <ArchitectureInput
                  onChange={(event) => updateSelectedEdgeData({ label: event.target.value })}
                  value={text(selectedEdge.data?.label)}
                />
              </ArchitectureField>
              <ArchitectureField>
                <span>Kind</span>
                <ArchitectureSelect
                  onChange={(event) => updateSelectedEdgeData({ kind: event.target.value })}
                  value={text(selectedEdge.data?.kind, "calls")}
                >
                  {ARCHITECTURE_EDGE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </ArchitectureSelect>
              </ArchitectureField>
              <ArchitectureInspectorMeta>
                {selectedEdge.source} {"->"} {selectedEdge.target}
              </ArchitectureInspectorMeta>
            </>
          ) : (
            <ArchitectureInspectorMeta>
              Select a node, group, or edge to edit it.
            </ArchitectureInspectorMeta>
          )}
        </ArchitectureInspector>
      </ArchitectureEditorBody>
    </ArchitectureEditorShell>
  );
}

function ArchitectureCanvasNode({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, data?.kind);
  const IconComponent = icon.Icon;
  return (
    <ArchitectureCanvasNodeShell data-kind={text(data?.kind, "service")} data-selected={selected ? "true" : "false"}>
      <Handle position={Position.Left} type="target" />
      <ArchitectureNodeIcon
        aria-hidden="true"
        data-kind={text(data?.kind, "service")}
        data-source={icon.source}
        title={icon.title}
      >
        {IconComponent ? <IconComponent /> : icon.label}
      </ArchitectureNodeIcon>
      <ArchitectureNodeText>
        <strong>{text(data?.title, "Node")}</strong>
        <span>{text(data?.subtitle, architectureKindLabel(data?.kind))}</span>
      </ArchitectureNodeText>
      <Handle position={Position.Right} type="source" />
    </ArchitectureCanvasNodeShell>
  );
}

function ArchitectureCanvasGroup({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, "group");
  const IconComponent = icon.Icon;
  return (
    <ArchitectureCanvasGroupShell data-selected={selected ? "true" : "false"}>
      <Handle position={Position.Left} type="target" />
      <ArchitectureGroupHeader>
        <ArchitectureNodeIcon
          aria-hidden="true"
          data-kind="group"
          data-source={icon.source}
          title={icon.title}
        >
          {IconComponent ? <IconComponent /> : icon.label}
        </ArchitectureNodeIcon>
        <ArchitectureGroupText>
          <strong>{text(data?.title, "Group")}</strong>
          <span>{text(data?.subtitle, "Architecture group")}</span>
        </ArchitectureGroupText>
      </ArchitectureGroupHeader>
      <Handle position={Position.Right} type="source" />
    </ArchitectureCanvasGroupShell>
  );
}

function ArchitectureCanvasEdge({
  data,
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  const kind = text(data?.kind, "calls");
  const label = text(data?.label);

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: selected ? "rgba(251, 191, 36, 0.95)" : "rgba(125, 211, 252, 0.8)",
          strokeDasharray: kind === "depends" ? "7 5" : kind === "subscribes" ? "2 6" : "0",
          strokeLinecap: "round",
          strokeWidth: selected ? 3 : 2.2,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <ArchitectureEdgeLabel
            data-kind={kind}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </ArchitectureEdgeLabel>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function HistoryTimeline({
  finishPlanError = "",
  finishingPlanTaskId = "",
  onFinishPlan,
  repoLabel,
  tasks,
}) {
  const timeline = useMemo(() => buildTimelineItems(tasks), [tasks]);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  useEffect(() => {
    if (!timeline.rows.length) {
      if (selectedTaskId) setSelectedTaskId("");
      return;
    }
    if (!timeline.rows.some((item) => item.taskId === selectedTaskId)) {
      setSelectedTaskId(timeline.rows[0].taskId);
    }
  }, [selectedTaskId, timeline.rows]);

  const selectedItem = timeline.rows.find((item) => item.taskId === selectedTaskId)
    || timeline.rows[0]
    || null;

  if (!tasks.length) {
    return (
      <HistoryPane>
        <EmptyState>No task history recorded yet.</EmptyState>
      </HistoryPane>
    );
  }

  return (
    <HistoryPane>
      <TimelineHeader>
        <div>
          <TimelineKicker>Repo timeline</TimelineKicker>
          <TimelineTitle>{repoLabel}</TimelineTitle>
        </div>
        <TimelineSummary>{timeline.rows.length} task{timeline.rows.length === 1 ? "" : "s"} · newest first</TimelineSummary>
      </TimelineHeader>
      <HistorySplit>
        <TimelineList aria-label="Task history timeline" style={{ "--timeline-lanes": timeline.laneCount }}>
          {timeline.rows.map((item) => {
            const startLabel = formatTime(item.startMs) || "unknown";
            const finishLabel = item.endMs
              ? formatTime(item.endMs)
              : item.active ? "now" : "not finished";
            const duration = formatTimelineDuration(item.startMs, item.endMs, item.active);
            const relativeStamp = taskRelativeStamp(item);

            return (
              <TimelineRow
                aria-pressed={selectedItem?.taskId === item.taskId}
                data-selected={selectedItem?.taskId === item.taskId ? "true" : "false"}
                data-status={item.statusKind}
                key={item.taskId}
                onClick={() => setSelectedTaskId(item.taskId)}
                title={`${item.label}\n${startLabel} -> ${finishLabel}`}
                type="button"
              >
                <TimelineTrack aria-hidden="true" style={{ "--timeline-lane": item.lane }}>
                  <span data-part="trunk" />
                  <span data-part="lane" />
                  <span data-part="connector" />
                  <span data-part="dot" />
                </TimelineTrack>
                <TimelineTask>
                  <TimelineTaskLine>
                    <TimelineTaskName>{item.label}</TimelineTaskName>
                    <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatusLabel}`}>
                      {item.statusLabel}
                    </StatusPill>
                  </TimelineTaskLine>
                </TimelineTask>
                <TimelineTimes>
                  <strong>{relativeStamp}</strong>
                  {duration && <em>{duration}</em>}
                </TimelineTimes>
              </TimelineRow>
            );
          })}
        </TimelineList>
        <TaskDetailPanel
          finishPlanError={finishPlanError}
          finishingPlanTaskId={finishingPlanTaskId}
          item={selectedItem}
          onFinishPlan={onFinishPlan}
          repoLabel={repoLabel}
        />
      </HistorySplit>
    </HistoryPane>
  );
}

function TaskDetailPanel({
  finishPlanError = "",
  finishingPlanTaskId = "",
  item,
  onFinishPlan,
  repoLabel,
}) {
  if (!item) {
    return (
      <TaskDetails>
        <EmptyState>Select a task to inspect it.</EmptyState>
      </TaskDetails>
    );
  }

  const task = item.task;
  const terminalPlan = taskTerminalPlan(task);
  const duration = formatTimelineDuration(item.startMs, item.endMs, item.active) || "unknown";
  const agent = taskAgentLabel(task) || "unknown";
  const body = taskBody(task);
  const title = item.label;
  const relativeStamp = taskRelativeStamp(item);
  const updatedRelative = formatRelativeTimeMs(item.updatedMs || item.endMs || item.startMs) || relativeStamp;
  const taskId = text(terminalPlan?.task_id || terminalPlan?.taskId || task?.task_id || task?.id || item.taskId);
  const planKey = text(terminalPlan?.plan_id || terminalPlan?.planId, taskId);
  const planSteps = jsonArray(terminalPlan?.steps);
  const planDetail = text(terminalPlan?.description || terminalPlan?.detail || terminalPlan?.summary);
  const inputBlocks = taskInputBlocks(task);
  const canFinishPlan = Boolean(
    terminalPlan
      && taskId
      && terminalPlanStatusKind(terminalPlan) !== "completed"
      && typeof onFinishPlan === "function",
  );
  const finishingPlan = finishingPlanTaskId === taskId;

  return (
    <TaskDetails aria-label="Selected task details">
      <TaskDetailsHeader>
        <div>
          <TimelineKicker>{repoLabel}</TimelineKicker>
          <TaskDetailsTitle>{title}</TaskDetailsTitle>
        </div>
        <TaskDetailsHeaderActions>
          <TaskDetailsUpdated>Updated {updatedRelative}</TaskDetailsUpdated>
          <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatusLabel}`}>
            {item.statusLabel}
          </StatusPill>
          {canFinishPlan && (
            <FinishPlanButton
              disabled={finishingPlan}
              data-loading={finishingPlan ? "true" : undefined}
              onClick={() => onFinishPlan(item)}
              type="button"
            >
              {finishingPlan && <FinishPlanButtonSpinner aria-hidden="true" />}
              <span>{finishingPlan ? "Finishing..." : "Finish plan"}</span>
            </FinishPlanButton>
          )}
        </TaskDetailsHeaderActions>
      </TaskDetailsHeader>
      <TaskMetaStrip>
        <TaskMetaChip>
          <span>Agent</span>
          <strong>{agent}</strong>
        </TaskMetaChip>
        <TaskMetaChip>
          <span>Duration</span>
          <strong>{duration}</strong>
        </TaskMetaChip>
      </TaskMetaStrip>
      <TaskInputPanel>
        {(inputBlocks.length ? inputBlocks : [{ content: body || "No agent input recorded.", label: "Input" }])
          .map((block, index) => (
            <TaskInputBlock key={`${block.label}-${index}-${block.content.slice(0, 24)}`}>
              <span>{block.label}</span>
              <p>{block.content}</p>
            </TaskInputBlock>
          ))}
      </TaskInputPanel>
      {terminalPlan && (
        <TaskPlanCard>
          <TaskPlanHeader>
            <span>Terminal plan</span>
            <strong>{text(terminalPlan.title, title)}</strong>
          </TaskPlanHeader>
          {planDetail && <TaskPlanDescription>{planDetail}</TaskPlanDescription>}
          {planSteps.length > 0 && (
            <TaskPlanSteps>
              {planSteps.map((step, index) => {
                const stepStatus = planStepStatusKind(step);
                const stepDetail = planStepDetail(step);
                return (
                  <TaskPlanStep data-status={stepStatus} key={`${planKey}-step-${text(step?.id || step?.index, index)}`}>
                    <TaskPlanStepMarker aria-hidden="true" data-status={stepStatus}>
                      <span />
                    </TaskPlanStepMarker>
                    <TaskPlanStepContent>
                      <TaskPlanStepTitleRow>
                        <strong>{planStepTitle(step, index)}</strong>
                        <TaskPlanStepBadge data-status={stepStatus}>{planStepStatusLabel(step)}</TaskPlanStepBadge>
                      </TaskPlanStepTitleRow>
                      {stepDetail && <p>{stepDetail}</p>}
                    </TaskPlanStepContent>
                  </TaskPlanStep>
                );
              })}
            </TaskPlanSteps>
          )}
        </TaskPlanCard>
      )}
      {finishPlanError && <TaskActionError>{finishPlanError}</TaskActionError>}
    </TaskDetails>
  );
}

function RawScanPanel({ error, scan, state }) {
  const graph = useMemo(() => buildRawScanGraph(scan), [scan]);
  const hasGraph = graph.nodes.length > 0;
  const isLoading = state === "loading";
  const cacheReason = graph.stats.cacheReason || "";
  const cacheStatus = graph.stats.cacheStatus || "";
  const emptyMessage = isLoading
    ? "Loading startup workspace graph..."
    : cacheReason || "No startup workspace graph cached yet.";
  const shouldShowCacheNotice = Boolean(
    cacheReason
      && !isLoading
      && (!hasGraph || ["error", "missing", "stale_cached", "unavailable"].includes(cacheStatus)),
  );

  return (
    <RawShell>
      <RawHeader>
        <div>
          <RawKicker>Startup cache</RawKicker>
          <RawTitle>{isLoading ? "Loading cached workspace graph..." : "Cached workspace graph"}</RawTitle>
        </div>
      </RawHeader>
      {error && <ArchitectureError>{error}</ArchitectureError>}
      <RawGraphStats>
        <span>{graph.stats.sourceLabel}</span>
        <span>{graph.stats.cacheLabel}</span>
        <span>{graph.stats.workspaceKind}</span>
        <span>{graph.stats.projectCount} project{graph.stats.projectCount === 1 ? "" : "s"}</span>
      </RawGraphStats>
      {shouldShowCacheNotice && (
        <RawCacheNotice data-cache-status={cacheStatus}>{cacheReason}</RawCacheNotice>
      )}
      {hasGraph ? (
        <RawScanGraph graph={graph} />
      ) : (
        <EmptyState>{emptyMessage}</EmptyState>
      )}
      <RawDetails>
        <summary>Raw payload</summary>
        <JsonBlock>{JSON.stringify(scan || { state }, null, 2)}</JsonBlock>
      </RawDetails>
    </RawShell>
  );
}

function RawScanGraph({ graph }) {
  const layout = useMemo(() => layoutRawScanGraph(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const nodeWidth = 206;
  const nodeHeight = 66;

  return (
    <RawGraphViewport>
      <RawGraphSvg
        aria-label="Cached workspace scan graph"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker id="raw-graph-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
            <path d="M0,0 L8,4 L0,8 Z" fill="rgba(147, 197, 253, 0.72)" />
          </marker>
        </defs>
        <g>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const startX = from.x + nodeWidth;
            const startY = from.y;
            const endX = to.x;
            const endY = to.y;
            const midX = startX + Math.max(50, (endX - startX) * 0.52);
            return (
              <path
                className="raw-edge"
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                key={`${edge.from}-${edge.to}`}
                markerEnd="url(#raw-graph-arrow)"
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <g data-kind={node.kind} key={node.id} transform={`translate(${node.x}, ${node.y - nodeHeight / 2})`}>
              <title>{[node.label, node.meta, node.path].filter(Boolean).join("\n")}</title>
              <rect className="raw-node-box" height={nodeHeight} rx="8" width={nodeWidth} />
              <circle className="raw-node-dot" cx="18" cy="21" r="5" />
              <text className="raw-node-label" x="32" y="24">{shortLabel(node.label, 24)}</text>
              <text className="raw-node-meta" x="14" y="46">{shortLabel(node.meta || node.relativePath || node.path, 30)}</text>
              <text className="raw-node-badge" x={nodeWidth - 14} y="46" textAnchor="end">{shortLabel(node.badge, 13)}</text>
            </g>
          ))}
        </g>
      </RawGraphSvg>
    </RawGraphViewport>
  );
}

const ArchitectureSurface = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const ArchitectureToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--forge-border);
  background: rgba(15, 23, 42, 0.42);
`;

const ViewToggleGroup = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.48);
`;

const ViewToggleButton = styled.button`
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(148, 163, 184, 0.14);
  }
`;

const ToolbarMeta = styled.span`
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 800;
`;

const ArchitectureError = styled.div`
  max-height: 76px;
  margin: 0;
  padding: 9px 11px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.35;
  overflow: auto;
  overflow-wrap: anywhere;
`;

const ArchitectureErrorToast = styled.div`
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 6;
  display: grid;
  gap: 4px;
  width: min(520px, calc(100% - 32px));
  max-height: 96px;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid rgba(248, 113, 113, 0.38);
  border-radius: 8px;
  color: #fecaca;
  background:
    linear-gradient(180deg, rgba(127, 29, 29, 0.36), rgba(69, 10, 10, 0.3)),
    rgba(2, 6, 23, 0.94);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;

  strong {
    color: #fee2e2;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  span {
    color: rgba(254, 202, 202, 0.9);
    font-weight: 720;
  }
`;

const ArchitecturesShell = styled.div`
  display: grid;
  grid-template-columns: clamp(176px, 15vw, 232px) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const ArchitectureNavRail = styled.aside`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(2, 6, 23, 0.32);

  @media (max-width: 760px) {
    min-height: 260px;
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
`;

const ArchitectureNavHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  min-height: 26px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: rgba(226, 232, 240, 0.86);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
`;

const ArchitectureIconButton = styled.button`
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(45, 212, 191, 0.28);
  border-radius: 6px;
  color: rgba(204, 251, 241, 0.95);
  background: rgba(13, 148, 136, 0.18);
  font: inherit;
  font-size: 16px;
  font-weight: 780;
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(94, 234, 212, 0.5);
    background: rgba(20, 184, 166, 0.26);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ArchitectureTree = styled.div`
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureTreeRepoGroup = styled.div`
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
`;

const ArchitectureTreeBranch = styled.div`
  display: grid;
  align-content: start;
  gap: 1px;
  min-width: 0;
`;

const ArchitectureTreeRow = styled.button`
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 24px;
  padding: 0 6px 0 calc(6px + var(--tree-depth, 0) * 12px);
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.82);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 760;
  }

  em {
    min-width: 16px;
    color: rgba(148, 163, 184, 0.62);
    font-size: 9px;
    font-style: normal;
    font-weight: 850;
    text-align: right;
  }

  &[data-kind="repo"] {
    color: rgba(226, 232, 240, 0.92);
  }

  &[data-kind="repo"] span {
    font-size: 12px;
    font-weight: 880;
  }

  &[data-kind="folder"] {
    color: rgba(148, 163, 184, 0.86);
  }

  &[data-kind="graph"] {
    color: rgba(226, 232, 240, 0.86);
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(125, 211, 252, 0.14);
    background: rgba(148, 163, 184, 0.08);
  }

  &[data-active="true"] {
    color: rgba(248, 250, 252, 0.96);
    background: rgba(14, 165, 233, 0.13);
    box-shadow: inset 2px 0 0 rgba(34, 211, 238, 0.72);
  }
`;

const ArchitectureTreeGlyph = styled.i`
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.08);

  &[data-kind="repo"] {
    border-color: rgba(125, 211, 252, 0.32);
    background: rgba(14, 165, 233, 0.15);
  }

  &[data-kind="folder"] {
    border-color: rgba(251, 191, 36, 0.28);
    background: rgba(217, 119, 6, 0.15);
  }

  &[data-kind="graph"] {
    border-color: rgba(45, 212, 191, 0.28);
    border-radius: 50%;
    background: rgba(13, 148, 136, 0.16);
  }
`;

const ArchitectureTreeEmpty = styled.div`
  min-width: 0;
  min-height: 24px;
  padding: 5px 6px 5px calc(6px + var(--tree-depth, 0) * 12px + 18px);
  color: rgba(148, 163, 184, 0.58);
  font-size: 10px;
  font-weight: 760;
`;

const ArchitectureNavStoragePath = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(148, 163, 184, 0.62);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 760;
`;

const ArchitectureRepoRail = styled.aside`
  display: grid;
  align-content: start;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(2, 6, 23, 0.34);

  @media (max-width: 760px) {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
`;

const ArchitectureRailHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;

  strong {
    color: rgba(226, 232, 240, 0.82);
    font-size: 10px;
    font-weight: 900;
    text-transform: none;
  }
`;

const ArchitectureRepoList = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureRepoButton = styled.button`
  display: grid;
  gap: 3px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(15, 23, 42, 0.28);
  font: inherit;
  text-align: left;
  cursor: pointer;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
    font-weight: 880;
  }

  span {
    color: rgba(148, 163, 184, 0.78);
    font-size: 10px;
    font-weight: 720;
  }

  em {
    color: rgba(125, 211, 252, 0.78);
    font-size: 9px;
    font-style: normal;
    font-weight: 820;
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(125, 211, 252, 0.24);
    background: rgba(14, 165, 233, 0.12);
  }

  &[data-active="true"] {
    box-shadow: inset 2px 0 0 rgba(34, 211, 238, 0.72);
  }
`;

const ArchitectureCreatePanel = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
`;

const ArchitectureField = styled.label`
  display: grid;
  gap: 4px;
  min-width: 0;

  span {
    color: rgba(148, 163, 184, 0.82);
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
`;

const ArchitectureInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.42);
  font: inherit;
  font-size: 12px;
  font-weight: 760;
  outline: none;

  &:focus {
    border-color: rgba(125, 211, 252, 0.52);
    box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.14);
  }
`;

const ArchitectureSelect = styled.select`
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.42);
  font: inherit;
  font-size: 12px;
  font-weight: 760;
  outline: none;

  &:focus {
    border-color: rgba(125, 211, 252, 0.52);
    box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.14);
  }
`;

const ArchitecturePrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(45, 212, 191, 0.32);
  border-radius: 7px;
  color: rgba(204, 251, 241, 0.95);
  background: rgba(13, 148, 136, 0.22);
  font: inherit;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(94, 234, 212, 0.48);
    background: rgba(20, 184, 166, 0.28);
  }

  &:disabled {
    cursor: default;
    opacity: 0.52;
  }
`;

const ArchitectureSmallButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.86);
  background: rgba(15, 23, 42, 0.48);
  font: inherit;
  font-size: 10px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    background: rgba(14, 165, 233, 0.13);
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const ArchitectureDangerButton = styled(ArchitectureSmallButton)`
  border-color: rgba(251, 113, 133, 0.18);
  color: rgba(254, 205, 211, 0.86);
  background: rgba(127, 29, 29, 0.16);

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(251, 113, 133, 0.32);
    background: rgba(190, 18, 60, 0.18);
  }
`;

const ArchitectureGraphLibrary = styled.aside`
  display: grid;
  align-content: start;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.18);

  @media (max-width: 1100px) {
    display: none;
  }
`;

const ArchitectureGraphHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`;

const ArchitectureGraphTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  color: var(--forge-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.2;
`;

const ArchitectureGraphHeaderActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
`;

const ArchitectureStoragePath = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(167, 243, 208, 0.74);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 820;
`;

const ArchitectureGraphList = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureGraphButton = styled.button`
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.24);
  font: inherit;
  text-align: left;
  cursor: pointer;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
    font-weight: 880;
  }

  span {
    color: rgba(226, 232, 240, 0.72);
    font-size: 10px;
    font-weight: 740;
    text-transform: capitalize;
  }

  em {
    color: rgba(148, 163, 184, 0.72);
    font-size: 9px;
    font-style: normal;
    font-weight: 780;
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(251, 191, 36, 0.26);
    background: rgba(120, 53, 15, 0.14);
  }

  &[data-active="true"] {
    box-shadow: inset 2px 0 0 rgba(251, 191, 36, 0.68);
  }
`;

const ArchitectureEmptyNote = styled.div`
  padding: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: rgba(148, 163, 184, 0.76);
  font-size: 11px;
  font-weight: 760;
  line-height: 1.4;
`;

const ArchitectureEditorRegion = styled.main`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
`;

const ArchitectureEditorContent = styled.div`
  display: grid;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ArchitectureEditorEmpty = styled.div`
  display: grid;
  place-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: rgba(148, 163, 184, 0.78);
  text-align: center;

  strong {
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 900;
  }

  span {
    font-size: 12px;
    font-weight: 760;
  }
`;

const ArchitectureCreateSurfaceShell = styled.div`
  display: grid;
  align-self: stretch;
  place-items: center;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 24px;
  overflow: auto;
  border: 1px dashed rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(2, 6, 23, 0.12)),
    rgba(2, 6, 23, 0.18);
`;

const ArchitectureCreateDialog = styled.div`
  display: grid;
  gap: 11px;
  width: min(460px, 100%);
  min-width: 0;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.46);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.26);
`;

const ArchitectureCreateTitle = styled.strong`
  min-width: 0;
  overflow-wrap: anywhere;
  color: rgba(248, 250, 252, 0.96);
  font-size: 18px;
  font-weight: 920;
  line-height: 1.2;
`;

const ArchitectureCreateText = styled.p`
  min-width: 0;
  margin: -4px 0 2px;
  color: rgba(148, 163, 184, 0.78);
  font-size: 12px;
  font-weight: 720;
  line-height: 1.4;
`;

const ArchitectureLocationToggle = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.36);
`;

const ArchitectureLocationButton = styled.button`
  min-width: 0;
  min-height: 28px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.82);
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &[data-active="true"] {
    color: rgba(226, 232, 240, 0.95);
    background: rgba(148, 163, 184, 0.13);
  }
`;

const ArchitectureFolderSuggestions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;

  button {
    max-width: 100%;
    min-height: 24px;
    padding: 0 8px;
    overflow: hidden;
    border: 1px solid rgba(251, 191, 36, 0.16);
    border-radius: 999px;
    color: rgba(254, 243, 199, 0.82);
    background: rgba(120, 53, 15, 0.12);
    font: inherit;
    font-size: 10px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
`;

const ArchitectureCreateActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
  padding-top: 2px;
`;

const ArchitectureEditorShell = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ArchitectureEditorToolbar = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  min-width: 0;

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }
`;

const ArchitectureEditorMeta = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 1.25fr) minmax(140px, 0.85fr);
  gap: 8px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const ArchitectureEditorActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
`;

const ArchitectureEditorNotice = styled.div`
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 8px;
  color: rgba(254, 240, 138, 0.82);
  background: rgba(120, 53, 15, 0.12);
  font-size: 11px;
  font-weight: 800;
  overflow-wrap: anywhere;

  &[data-kind="error"] {
    border-color: rgba(251, 113, 133, 0.26);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.16);
  }
`;

const ArchitectureEditorBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 230px);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const ArchitectureCanvasViewport = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.16), rgba(2, 6, 23, 0.18)),
    rgba(2, 6, 23, 0.36);

  .react-flow {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .react-flow__controls {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: none;
  }

  .react-flow__controls-button {
    border-bottom-color: rgba(148, 163, 184, 0.12);
    color: rgba(226, 232, 240, 0.86);
    background: rgba(15, 23, 42, 0.82);
  }

  .react-flow__minimap {
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.72);
  }
`;

const ArchitectureInspector = styled.aside`
  display: grid;
  align-content: start;
  gap: 9px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 11px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.3);
`;

const ArchitectureInspectorHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(148, 163, 184, 0.82);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;

  strong {
    color: rgba(226, 232, 240, 0.88);
    text-transform: none;
  }
`;

const ArchitectureInspectorMeta = styled.div`
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  color: rgba(148, 163, 184, 0.78);
  background: rgba(2, 6, 23, 0.24);
  font-size: 11px;
  font-weight: 760;
  overflow-wrap: anywhere;
`;

const ArchitectureCanvasNodeShell = styled.div`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 184px;
  min-height: 76px;
  padding: 10px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 8px;
  color: var(--forge-text);
  background:
    linear-gradient(180deg, rgba(14, 165, 233, 0.18), rgba(15, 23, 42, 0.86)),
    rgba(2, 6, 23, 0.9);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);

  &[data-kind="client"] {
    border-color: rgba(251, 191, 36, 0.36);
    background: linear-gradient(180deg, rgba(217, 119, 6, 0.18), rgba(15, 23, 42, 0.86));
  }

  &[data-kind="database"] {
    border-color: rgba(52, 211, 153, 0.34);
    background: linear-gradient(180deg, rgba(5, 150, 105, 0.18), rgba(15, 23, 42, 0.86));
  }

  &[data-kind="external"] {
    border-color: rgba(244, 114, 182, 0.36);
    background: linear-gradient(180deg, rgba(190, 24, 93, 0.18), rgba(15, 23, 42, 0.86));
  }

  &[data-kind="queue"] {
    border-color: rgba(167, 139, 250, 0.36);
    background: linear-gradient(180deg, rgba(109, 40, 217, 0.18), rgba(15, 23, 42, 0.86));
  }

  &[data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.18), 0 12px 30px rgba(0, 0, 0, 0.24);
  }

  .react-flow__handle {
    width: 9px;
    height: 9px;
    border: 1px solid rgba(2, 6, 23, 0.9);
    background: rgba(125, 211, 252, 0.95);
  }
`;

const ArchitectureNodeIcon = styled.span`
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(125, 211, 252, 0.36);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.76);
  background: rgba(14, 165, 233, 0.2);
  font-size: 6px;
  font-weight: 900;
  line-height: 1;
  overflow: hidden;

  svg {
    display: block;
    width: 16px;
    height: 16px;
    max-width: 18px;
    max-height: 18px;
    color: currentColor;
  }

  &[data-source="likec4"],
  &[data-source="styled"] {
    border-color: rgba(226, 232, 240, 0.74);
    color: rgba(15, 23, 42, 0.92);
    background: rgba(248, 250, 252, 0.92);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.14);
  }

  &[data-source="label"] {
    letter-spacing: 0;
    font-size: 7px;
  }

  &[data-kind="client"] {
    border-color: rgba(251, 191, 36, 0.42);
    background: rgba(217, 119, 6, 0.22);
  }

  &[data-kind="client"][data-source="likec4"],
  &[data-kind="client"][data-source="styled"] {
    border-color: rgba(254, 240, 138, 0.78);
    background: rgba(255, 251, 235, 0.94);
  }

  &[data-kind="database"] {
    border-color: rgba(52, 211, 153, 0.44);
    border-radius: 50%;
    background: rgba(5, 150, 105, 0.22);
  }

  &[data-kind="database"][data-source="likec4"],
  &[data-kind="database"][data-source="styled"] {
    border-color: rgba(167, 243, 208, 0.82);
    background: rgba(240, 253, 244, 0.94);
  }

  &[data-kind="external"] {
    border-color: rgba(244, 114, 182, 0.42);
    background: rgba(190, 24, 93, 0.22);
  }

  &[data-kind="external"][data-source="likec4"],
  &[data-kind="external"][data-source="styled"] {
    border-color: rgba(251, 207, 232, 0.82);
    background: rgba(253, 242, 248, 0.94);
  }

  &[data-kind="queue"] {
    border-color: rgba(167, 139, 250, 0.42);
    background: rgba(109, 40, 217, 0.22);
  }

  &[data-kind="queue"][data-source="likec4"],
  &[data-kind="queue"][data-source="styled"] {
    border-color: rgba(221, 214, 254, 0.82);
    background: rgba(245, 243, 255, 0.94);
  }

  &[data-kind="group"] {
    border-radius: 7px;
  }
`;

const ArchitectureNodeText = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(248, 250, 252, 0.95);
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: rgba(203, 213, 225, 0.74);
    font-size: 10px;
    font-weight: 760;
  }
`;

const ArchitectureCanvasGroupShell = styled.div`
  width: 100%;
  height: 100%;
  padding: 12px;
  border: 1px dashed rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.88);
  background: rgba(15, 23, 42, 0.18);

  &[data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    background: rgba(120, 53, 15, 0.12);
  }

  .react-flow__handle {
    width: 9px;
    height: 9px;
    border: 1px solid rgba(2, 6, 23, 0.9);
    background: rgba(251, 191, 36, 0.95);
  }
`;

const ArchitectureGroupHeader = styled.div`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 14px);
`;

const ArchitectureGroupText = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(248, 250, 252, 0.92);
    font-size: 12px;
    font-weight: 900;
  }

  span {
    color: rgba(148, 163, 184, 0.75);
    font-size: 10px;
    font-weight: 760;
  }
`;

const ArchitectureEdgeLabel = styled.div`
  position: absolute;
  z-index: 3;
  padding: 3px 7px;
  border: 1px solid rgba(125, 211, 252, 0.22);
  border-radius: 999px;
  color: rgba(224, 242, 254, 0.92);
  background: rgba(2, 6, 23, 0.82);
  font-size: 9px;
  font-weight: 850;
  line-height: 1.15;
  pointer-events: all;
  text-transform: lowercase;

  &[data-kind="writes"],
  &[data-kind="publishes"] {
    border-color: rgba(52, 211, 153, 0.24);
    color: rgba(209, 250, 229, 0.92);
  }

  &[data-kind="reads"],
  &[data-kind="subscribes"] {
    border-color: rgba(251, 191, 36, 0.24);
    color: rgba(254, 243, 199, 0.92);
  }
`;

const HistoryPane = styled.div`
  display: grid;
  align-content: start;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
`;

const TimelineHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
`;

const TimelineKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const TimelineTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.2;
`;

const TimelineSummary = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 820;
`;

const HistorySplit = styled.div`
  display: grid;
  grid-template-columns: minmax(420px, 0.95fr) minmax(340px, 1.05fr);
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const TimelineList = styled.div`
  --timeline-lane-gap: 14px;
  --timeline-line-center: 15px;
  --timeline-track-width: calc(var(--timeline-lanes) * var(--timeline-lane-gap) + 26px);
  display: grid;
  align-content: start;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid rgba(148, 163, 184, 0.12);

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 14px;
    z-index: 1;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, rgba(71, 85, 105, 0.3), rgba(96, 165, 250, 0.58), rgba(71, 85, 105, 0.3));
    content: "";
    pointer-events: none;
  }
`;

const TimelineRow = styled.button`
  display: grid;
  grid-template-columns: var(--timeline-track-width) minmax(0, 1fr) minmax(78px, 104px);
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  color: var(--forge-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, box-shadow 140ms ease;

  &:hover {
    background: rgba(148, 163, 184, 0.055);
  }

  &:focus-visible {
    outline: 2px solid rgba(96, 165, 250, 0.7);
    outline-offset: -2px;
  }

  &[data-selected="true"] {
    background: rgba(37, 99, 235, 0.13);
    box-shadow: inset 2px 0 0 rgba(96, 165, 250, 0.75);
  }

  &[data-status="active"] {
    background: rgba(37, 99, 235, 0.08);
  }

  &[data-status="queued"] {
    background: rgba(14, 165, 233, 0.055);
  }

  &[data-status="blocked"] {
    background: rgba(217, 119, 6, 0.085);
  }

  &[data-status="parked"] {
    background: rgba(217, 119, 6, 0.06);
  }

  &[data-selected="true"][data-status="active"] {
    background: rgba(37, 99, 235, 0.16);
  }

  &[data-selected="true"][data-status="parked"] {
    background: rgba(217, 119, 6, 0.12);
  }

  &[data-selected="true"][data-status="queued"] {
    background: rgba(14, 165, 233, 0.12);
  }

  &[data-selected="true"][data-status="blocked"] {
    background: rgba(217, 119, 6, 0.16);
  }

  @media (max-width: 700px) {
    grid-template-columns: var(--timeline-track-width) minmax(0, 1fr);
  }
`;

const TimelineTrack = styled.div`
  --timeline-lane-x: calc(var(--timeline-line-center) + var(--timeline-lane) * var(--timeline-lane-gap));
  align-self: stretch;
  position: relative;
  height: 100%;
  min-width: 0;
  min-height: 36px;

  span {
    position: absolute;
    z-index: 2;
    display: block;
    pointer-events: none;
  }

  [data-part="trunk"],
  [data-part="lane"] {
    top: -1px;
    bottom: -1px;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, rgba(71, 85, 105, 0.38), rgba(96, 165, 250, 0.5), rgba(71, 85, 105, 0.38));
  }

  [data-part="trunk"] {
    left: calc(var(--timeline-line-center) - 1px);
    background: transparent;
  }

  [data-part="lane"] {
    left: calc(var(--timeline-lane-x) - 1px);
    background: linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(96, 165, 250, 0.56), rgba(96, 165, 250, 0.12));
  }

  [data-part="connector"] {
    top: 50%;
    left: var(--timeline-line-center);
    width: calc(var(--timeline-lane) * var(--timeline-lane-gap));
    height: 0;
    border-bottom: 2px solid rgba(96, 165, 250, 0.5);
    border-left: 2px solid rgba(96, 165, 250, 0.24);
    border-bottom-left-radius: 14px;
    transform: translateY(-1px);
  }

  [data-part="dot"] {
    top: 50%;
    left: var(--timeline-lane-x);
    z-index: 3;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(15, 23, 42, 0.96);
    border-radius: 50%;
    box-sizing: border-box;
    background: #93c5fd;
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.5);
    transform: translate(-50%, -50%);
  }

  ${TimelineRow}[data-status="done"] & [data-part="dot"] {
    background: #34d399;
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.5);
  }

  ${TimelineRow}[data-status="active"] & [data-part="dot"] {
    background: #60a5fa;
    box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.62), 0 0 18px rgba(96, 165, 250, 0.3);
  }

  ${TimelineRow}[data-status="parked"] & [data-part="dot"] {
    background: #f59e0b;
    box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.5);
  }

  ${TimelineRow}[data-status="queued"] & [data-part="dot"] {
    background: #38bdf8;
    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.46);
  }

  ${TimelineRow}[data-status="blocked"] & [data-part="dot"] {
    background: #f97316;
    box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.5);
  }

  ${TimelineRow}[data-status="failed"] & [data-part="dot"],
  ${TimelineRow}[data-status="cancelled"] & [data-part="dot"],
  ${TimelineRow}[data-status="interrupted"] & [data-part="dot"],
  ${TimelineRow}[data-status="rolled-back"] & [data-part="dot"] {
    background: #fb7185;
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.5);
  }

  ${TimelineRow}[data-status="skipped"] & [data-part="dot"] {
    background: #94a3b8;
    box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.44);
  }
`;

const TimelineTask = styled.div`
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 5px 10px 5px 0;
`;

const TimelineTaskLine = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const TimelineTaskName = styled.strong`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.25;
`;

const StatusPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(148, 163, 184, 0.11);
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.72);
  font-size: 8px;
  font-weight: 820;
  line-height: 1.05;
  text-transform: uppercase;

  &[data-status="done"] {
    border-color: rgba(52, 211, 153, 0.16);
    color: rgba(167, 243, 208, 0.72);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.18);
    color: rgba(191, 219, 254, 0.74);
    background: rgba(30, 64, 175, 0.12);
  }

  &[data-status="queued"] {
    border-color: rgba(56, 189, 248, 0.16);
    color: rgba(186, 230, 253, 0.72);
    background: rgba(8, 47, 73, 0.11);
  }

  &[data-status="blocked"] {
    border-color: rgba(249, 115, 22, 0.18);
    color: rgba(254, 215, 170, 0.74);
    background: rgba(124, 45, 18, 0.12);
  }

  &[data-status="parked"] {
    border-color: rgba(245, 158, 11, 0.17);
    color: rgba(253, 230, 138, 0.72);
    background: rgba(120, 53, 15, 0.11);
  }

  &[data-status="failed"],
  &[data-status="interrupted"],
  &[data-status="rolled-back"] {
    border-color: rgba(251, 113, 133, 0.18);
    color: rgba(254, 205, 211, 0.72);
    background: rgba(127, 29, 29, 0.11);
  }

  &[data-status="cancelled"],
  &[data-status="skipped"] {
    border-color: rgba(148, 163, 184, 0.14);
    color: rgba(203, 213, 225, 0.66);
    background: rgba(51, 65, 85, 0.1);
  }
`;

const TimelineTimes = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 1px;
  min-width: 0;
  padding: 5px 0 5px 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;

  strong {
    min-width: 0;
    color: var(--forge-text);
    font-size: 10px;
    font-weight: 850;
    line-height: 1.15;
  }

  span,
  em {
    min-width: 0;
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    color: rgba(148, 163, 184, 0.78);
    font-size: 9px;
    font-style: normal;
  }

  @media (max-width: 700px) {
    grid-column: 2;
    justify-items: start;
    gap: 8px;
    padding: 0 0 10px;
  }
`;

const TaskDetails = styled.aside`
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.28);
`;

const TaskDetailsHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

const TaskDetailsHeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
`;

const TaskDetailsUpdated = styled.span`
  color: rgba(148, 163, 184, 0.72);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;
`;

const finishPlanButtonSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const FinishPlanButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 7px;
  color: rgba(191, 219, 254, 0.84);
  background: rgba(30, 64, 175, 0.14);
  font: inherit;
  font-size: 9px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(96, 165, 250, 0.3);
    color: rgba(219, 234, 254, 0.94);
    background: rgba(37, 99, 235, 0.2);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }

  &[data-loading="true"] {
    opacity: 0.82;
  }
`;

const FinishPlanButtonSpinner = styled.i`
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 2px solid rgba(191, 219, 254, 0.22);
  border-top-color: rgba(191, 219, 254, 0.88);
  border-radius: 50%;
  animation: ${finishPlanButtonSpin} 720ms linear infinite;
`;

const TaskDetailsTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font-size: 16px;
  line-height: 1.25;
`;

const TaskMetaStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
`;

const TaskMetaChip = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.24);

  span {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 820;
  }
`;

const TaskPlanCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 8px;
  background: rgba(30, 64, 175, 0.12);
`;

const TaskPlanHeader = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 860;
  }
`;

const TaskPlanDescription = styled.p`
  margin: -2px 0 0;
  color: rgba(203, 213, 225, 0.78);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.38;
`;

const TaskPlanSteps = styled.ol`
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const TaskPlanStep = styled.li`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.2);

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.18);
    background: rgba(37, 99, 235, 0.11);
  }

  &[data-status="completed"] {
    border-color: rgba(52, 211, 153, 0.16);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-status="blocked"],
  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.18);
    background: rgba(127, 29, 29, 0.12);
  }
`;

const TaskPlanStepMarker = styled.span`
  display: grid;
  position: relative;
  place-items: center;
  min-height: 20px;

  span {
    display: block;
    width: 9px;
    height: 9px;
    border: 2px solid rgba(15, 23, 42, 0.96);
    border-radius: 50%;
    background: #94a3b8;
    box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.36);
  }

  &[data-status="completed"] span {
    background: #34d399;
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.42);
  }

  &[data-status="active"] span {
    background: #60a5fa;
    box-shadow:
      0 0 0 1px rgba(96, 165, 250, 0.5),
      0 0 14px rgba(96, 165, 250, 0.28);
  }

  &[data-status="blocked"] span,
  &[data-status="failed"] span {
    background: #fb7185;
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.45);
  }

  &[data-status="skipped"] span {
    background: #64748b;
  }
`;

const TaskPlanStepContent = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  p {
    margin: 0;
    color: rgba(203, 213, 225, 0.72);
    font-size: 10px;
    font-weight: 690;
    line-height: 1.34;
    overflow-wrap: anywhere;
  }
`;

const TaskPlanStepTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;

  strong {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: rgba(241, 245, 249, 0.94);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 800;
  }
`;

const TaskPlanStepBadge = styled.span`
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.72);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-status="completed"] {
    border-color: rgba(52, 211, 153, 0.24);
    color: #a7f3d0;
    background: rgba(6, 78, 59, 0.18);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.28);
    color: #bfdbfe;
    background: rgba(30, 64, 175, 0.2);
  }

  &[data-status="blocked"],
  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.24);
    color: #fecdd3;
    background: rgba(127, 29, 29, 0.18);
  }
`;

const TaskInputPanel = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
`;

const TaskInputBlock = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.22);

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  p {
    max-height: 116px;
    margin: 0;
    overflow: auto;
    color: rgba(203, 213, 225, 0.84);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
`;

const TaskActionError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 8px;
  color: rgba(254, 202, 202, 0.92);
  background: rgba(127, 29, 29, 0.12);
  font-size: 10px;
  font-weight: 760;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const RawShell = styled.div`
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px;
`;

const RawHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const RawKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
`;

const RawTitle = styled.strong`
  display: block;
  margin-top: 3px;
  font-size: 16px;
`;

const RawGraphStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;

  span {
    padding: 4px 7px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    color: var(--forge-text-muted);
    background: rgba(15, 23, 42, 0.42);
    font-size: 11px;
    font-weight: 820;
  }
`;

const RawCacheNotice = styled.div`
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  color: rgba(203, 213, 225, 0.82);
  background: rgba(15, 23, 42, 0.38);
  font-size: 11px;
  font-weight: 740;
  line-height: 1.35;
  overflow-wrap: anywhere;

  &[data-cache-status="missing"],
  &[data-cache-status="stale_cached"],
  &[data-cache-status="unavailable"] {
    border-color: rgba(251, 191, 36, 0.22);
    color: rgba(254, 240, 138, 0.88);
    background: rgba(113, 63, 18, 0.12);
  }

  &[data-cache-status="error"] {
    border-color: rgba(248, 113, 113, 0.24);
    color: rgba(254, 202, 202, 0.9);
    background: rgba(127, 29, 29, 0.13);
  }
`;

const RawGraphViewport = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(rgba(96, 165, 250, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96, 165, 250, 0.035) 1px, transparent 1px),
    rgba(2, 6, 23, 0.72);
  background-size: 26px 26px;
`;

const RawGraphSvg = styled.svg`
  display: block;
  min-width: 760px;
  min-height: 360px;

  .raw-edge {
    fill: none;
    stroke: rgba(147, 197, 253, 0.5);
    stroke-width: 2;
  }

  .raw-node-box {
    fill: rgba(15, 23, 42, 0.92);
    stroke: rgba(148, 163, 184, 0.24);
    stroke-width: 1.4;
  }

  .raw-node-dot {
    fill: #94a3b8;
  }

  .raw-node-label {
    fill: #f8fafc;
    font-size: 13px;
    font-weight: 850;
  }

  .raw-node-meta,
  .raw-node-badge {
    fill: rgba(203, 213, 225, 0.68);
    font-size: 10px;
    font-weight: 760;
  }

  [data-kind="root"] .raw-node-box {
    fill: rgba(30, 64, 175, 0.28);
    stroke: rgba(96, 165, 250, 0.55);
  }

  [data-kind="root"] .raw-node-dot {
    fill: #60a5fa;
  }

  [data-kind="git"] .raw-node-box {
    fill: rgba(20, 83, 45, 0.2);
    stroke: rgba(52, 211, 153, 0.42);
  }

  [data-kind="git"] .raw-node-dot {
    fill: #34d399;
  }

  [data-kind="project"] .raw-node-box {
    fill: rgba(8, 47, 73, 0.24);
    stroke: rgba(56, 189, 248, 0.34);
  }

  [data-kind="project"] .raw-node-dot {
    fill: #38bdf8;
  }

  [data-kind="container"] .raw-node-box {
    fill: rgba(120, 53, 15, 0.18);
    stroke: rgba(251, 191, 36, 0.36);
  }

  [data-kind="container"] .raw-node-dot {
    fill: #fbbf24;
  }

  [data-kind="skipped"] {
    opacity: 0.62;
  }
`;

const RawDetails = styled.details`
  min-width: 0;

  summary {
    cursor: pointer;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 850;
  }

  &[open] {
    display: grid;
    gap: 8px;
  }

  & > pre {
    max-height: 220px;
  }
`;

const JsonBlock = styled.pre`
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  color: #cbd5e1;
  background: rgba(2, 6, 23, 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const EmptyState = styled.div`
  display: grid;
  place-items: center;
  min-height: 160px;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 760;
`;
