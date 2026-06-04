import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  addEdge as addReactFlowEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styled, { keyframes } from "styled-components";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Add } from "@styled-icons/material-rounded/Add";
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
import { North } from "@styled-icons/material-rounded/North";
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

const ARCHITECTURE_GRAPH_LIST_REFRESH_MS = 700;
const ARCHITECTURE_SELECTED_GRAPH_REFRESH_MS = 450;
const ARCHITECTURE_REMOTE_TODO_QUEUE_EVENT = "diffforge:remote-todo-queue";
const ARCHITECTURE_TODO_QUEUE_STORAGE_PREFIX = "diffforge.todoQueue.v1";
const ARCHITECTURE_TODO_QUEUE_SOURCE = "next-remote-control";
const ARCHITECTURE_TODO_QUEUE_MAX_ITEMS = 120;
const ARCHITECTURE_AGENT_EDIT_MARKERS_STORAGE_PREFIX = "diffforge.architectureAgentEdits.v1";
const ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS = 80;
const ARCHITECTURE_AGENT_EDIT_MARKER_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const ARCHITECTURE_AGENT_EDIT_DONE_STATUSES = new Set([
  "cancelled",
  "done",
  "failed",
  "interrupted",
  "rolled-back",
  "skipped",
]);
const ARCHITECTURE_AGENT_EDIT_AGENT_COLORS = {
  claude: "#f59e0b",
  "claude-code": "#f59e0b",
  codex: "#60a5fa",
  opencode: "#34d399",
};
const ARCHITECTURE_AGENT_EDIT_FALLBACK_COLORS = [
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#2dd4bf",
];
const ARCHITECTURE_ROUTE_GRID_CELL = 48;
const ARCHITECTURE_ROUTE_GRID_MAX_POINTS = 1600;
const ARCHITECTURE_ROUTE_CACHE_MAX = 700;
const ARCHITECTURE_ROUTE_SETTLE_DELAY_MS = 120;
const ARCHITECTURE_ROUTE_NODE_CLEARANCE = 44;
const ARCHITECTURE_ROUTE_EDGE_CLEARANCE = 20;
const ARCHITECTURE_ROUTE_ENDPOINT_STUB = ARCHITECTURE_ROUTE_NODE_CLEARANCE + 24;
const ARCHITECTURE_ROUTE_INTERACTIVE_STUB = 28;
const ARCHITECTURE_ROUTE_CROSSING_EPSILON = 2;
const ARCHITECTURE_EDGE_LABEL_HEIGHT = 21;
const ARCHITECTURE_EDGE_LABEL_MIN_WIDTH = 54;
const ARCHITECTURE_EDGE_LABEL_MAX_WIDTH = 156;
const ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP = 44;
const ARCHITECTURE_EDGE_LABEL_OFFSET = 12;
const ARCHITECTURE_EDGE_LABEL_NODE_PADDING = 12;
const ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING = 2;
const ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING = 6;
const ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING = 1;
const ARCHITECTURE_NODE_CARD_WIDTH = 184;
const ARCHITECTURE_NODE_CARD_HEIGHT = 76;
const ARCHITECTURE_NODE_COMPACT_WIDTH = 88;
const ARCHITECTURE_NODE_COMPACT_HEIGHT = 70;

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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  { label: "Architecture", value: "architecture" },
  { label: "Deployment", value: "deployment" },
  { label: "API pathway", value: "api-pathway" },
  { label: "Data flow", value: "data-flow" },
  { label: "Control graph", value: "control-graph" },
  { label: "State machine", value: "state-machine" },
  { label: "Dependency graph", value: "dependency-graph" },
  { label: "Subsystem", value: "subsystem" },
  { label: "Runtime", value: "runtime" },
];

const ARCHITECTURE_GRAPH_TEMPLATE_OPTIONS = [
  { label: "System graph", value: "system" },
  { label: "Architecture", value: "architecture" },
  { label: "API pathway", value: "api-pathway" },
  { label: "Data flow", value: "data-flow" },
  { label: "Control graph", value: "control-graph" },
  { label: "State machine", value: "state-machine" },
  { label: "Dependency graph", value: "dependency-graph" },
  { label: "Deployment", value: "deployment" },
];

const ARCHITECTURE_NODE_ROLE_OPTIONS = [
  "actor",
  "service",
  "api",
  "endpoint",
  "controller",
  "worker",
  "queue",
  "datastore",
  "cache",
  "file",
  "external",
  "state",
  "decision",
  "action",
  "event",
  "timer",
  "terminal",
  "dependency",
  "package",
];

const ARCHITECTURE_EDGE_ROLE_OPTIONS = [
  "calls",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "transitions",
  "guards",
  "depends-on",
  "emits",
  "retries",
  "fails-to",
  "resolves-to",
];

const ARCHITECTURE_GROUP_INTENT_VALUES = new Set(ARCHITECTURE_KIND_OPTIONS.map((option) => option.value));
const ARCHITECTURE_NODE_ROLE_VALUES = new Set(ARCHITECTURE_NODE_ROLE_OPTIONS);
const ARCHITECTURE_EDGE_ROLE_VALUES = new Set(ARCHITECTURE_EDGE_ROLE_OPTIONS);

const ARCHITECTURE_GROUP_INTENT_ICONS = {
  architecture: "group",
  "api-pathway": "api",
  "data-flow": "flow",
  "control-graph": "router",
  "state-machine": "flow",
  "dependency-graph": "schema",
  deployment: "cloud",
  runtime: "server",
  subsystem: "settings",
};

const ARCHITECTURE_GROUP_INTENT_COLORS = {
  architecture: "blue",
  "api-pathway": "sky",
  "data-flow": "emerald",
  "control-graph": "amber",
  "state-machine": "violet",
  "dependency-graph": "rose",
  deployment: "cyan",
  runtime: "slate",
  subsystem: "blue",
};

const ARCHITECTURE_NODE_ROLE_ICONS = {
  actor: "users",
  service: "service",
  api: "api",
  endpoint: "api",
  controller: "router",
  worker: "worker",
  queue: "queue",
  datastore: "database",
  cache: "cache",
  file: "file",
  external: "external",
  state: "flow",
  decision: "router",
  action: "settings",
  event: "webhook",
  timer: "cache",
  terminal: "security",
  dependency: "schema",
  package: "schema",
};

const ARCHITECTURE_NODE_ROLE_KIND = {
  actor: "client",
  service: "service",
  api: "api",
  endpoint: "api",
  controller: "router",
  worker: "worker",
  queue: "queue",
  datastore: "database",
  cache: "database",
  file: "service",
  external: "external",
  state: "state",
  decision: "decision",
  action: "action",
  event: "event",
  timer: "event",
  terminal: "terminal",
  dependency: "dependency",
  package: "dependency",
};

const ARCHITECTURE_EDGE_ROLE_KIND = {
  "depends-on": "depends",
  reads: "reads",
  writes: "writes",
  publishes: "publishes",
  subscribes: "subscribes",
  transitions: "transitions",
  guards: "guards",
  retries: "retries",
  "fails-to": "fails-to",
  emits: "emits",
  "resolves-to": "resolves-to",
};

const ARCHITECTURE_SEMANTIC_SLICE_TEMPLATES = {
  architecture: {
    title: "System Architecture",
    intent: "architecture",
    icon: "group",
    color: "blue",
    subtitle: "System-level components and boundaries",
    nodes: [
      { id: "user", title: "User", role: "actor", icon: "users", display: "compact", x: 58, y: 98 },
      { id: "app", title: "App", role: "service", icon: "server", desc: "Primary application surface", x: 228, y: 92 },
      { id: "api", title: "API", role: "api", icon: "api", desc: "Request handling boundary", x: 448, y: 92 },
      { id: "store", title: "Store", role: "datastore", icon: "database", desc: "Durable state", x: 448, y: 214 },
    ],
    edges: [
      { source: "user", target: "app", label: "use", role: "calls" },
      { source: "app", target: "api", label: "request", role: "calls" },
      { source: "api", target: "store", label: "read/write", role: "writes" },
    ],
  },
  "api-pathway": {
    title: "API Pathway",
    intent: "api-pathway",
    icon: "api",
    color: "sky",
    subtitle: "Request path from caller to effect",
    nodes: [
      { id: "client", title: "Client", role: "actor", icon: "users", display: "compact", x: 58, y: 98 },
      { id: "endpoint", title: "Endpoint", role: "endpoint", icon: "api", desc: "Public route or handler", x: 220, y: 92 },
      { id: "controller", title: "Controller", role: "controller", icon: "router", desc: "Validation and orchestration", x: 438, y: 92 },
      { id: "effect", title: "Effect", role: "service", icon: "service", desc: "Domain operation", x: 438, y: 214 },
    ],
    edges: [
      { source: "client", target: "endpoint", label: "request", role: "calls" },
      { source: "endpoint", target: "controller", label: "route", role: "calls" },
      { source: "controller", target: "effect", label: "execute", role: "calls" },
    ],
  },
  "data-flow": {
    title: "Data Flow",
    intent: "data-flow",
    icon: "flow",
    color: "emerald",
    subtitle: "Data movement and persistence",
    nodes: [
      { id: "producer", title: "Producer", role: "service", icon: "service", desc: "Creates data", x: 58, y: 92 },
      { id: "queue", title: "Event Queue", role: "queue", icon: "queue", desc: "Buffers changes", x: 278, y: 92 },
      { id: "worker", title: "Worker", role: "worker", icon: "worker", desc: "Processes events", x: 498, y: 92 },
      { id: "store", title: "Data Store", role: "datastore", icon: "database", desc: "Persists records", x: 498, y: 214 },
    ],
    edges: [
      { source: "producer", target: "queue", label: "publish", role: "publishes" },
      { source: "queue", target: "worker", label: "consume", role: "subscribes" },
      { source: "worker", target: "store", label: "write", role: "writes" },
    ],
  },
  "control-graph": {
    title: "Control Graph",
    intent: "control-graph",
    icon: "router",
    color: "amber",
    subtitle: "Branching decisions and control paths",
    nodes: [
      { id: "start", title: "Start", role: "state", lifecycle: "start", icon: "flow", desc: "Entry condition", x: 58, y: 102 },
      { id: "decide", title: "Decision", role: "decision", icon: "router", desc: "Branch condition", x: 240, y: 96 },
      { id: "action", title: "Action", role: "action", icon: "settings", desc: "Primary path", x: 454, y: 80 },
      { id: "retry", title: "Retry", role: "action", lifecycle: "retry", icon: "worker", desc: "Recovery path", x: 454, y: 196 },
      { id: "failed", title: "Failed", role: "terminal", lifecycle: "terminal", icon: "security", desc: "Stop condition", x: 454, y: 302 },
    ],
    edges: [
      { source: "start", target: "decide", label: "evaluate", role: "transitions" },
      { source: "decide", target: "action", label: "ok", role: "guards", condition: "valid" },
      { source: "decide", target: "retry", label: "retry", role: "guards", condition: "recoverable" },
      { source: "decide", target: "failed", label: "fail", role: "fails-to", condition: "invalid" },
    ],
  },
  "state-machine": {
    title: "State Machine",
    intent: "state-machine",
    icon: "flow",
    color: "violet",
    subtitle: "States, events, and terminal transitions",
    nodes: [
      { id: "idle", title: "Idle", role: "state", lifecycle: "start", icon: "flow", desc: "Waiting", x: 58, y: 96 },
      { id: "active", title: "Active", role: "state", icon: "flow", desc: "Running", x: 260, y: 96 },
      { id: "paused", title: "Paused", role: "state", icon: "flow", desc: "Suspended", x: 462, y: 196 },
      { id: "done", title: "Done", role: "terminal", lifecycle: "terminal", icon: "security", desc: "Completed", x: 462, y: 80 },
    ],
    edges: [
      { source: "idle", target: "active", label: "start", role: "transitions", event: "start" },
      { source: "active", target: "paused", label: "pause", role: "transitions", event: "pause" },
      { source: "paused", target: "active", label: "resume", role: "transitions", event: "resume" },
      { source: "active", target: "done", label: "complete", role: "transitions", event: "complete" },
    ],
  },
  "dependency-graph": {
    title: "Dependency Graph",
    intent: "dependency-graph",
    icon: "schema",
    color: "rose",
    subtitle: "Packages, modules, and dependency direction",
    nodes: [
      { id: "app", title: "Application", role: "package", icon: "schema", desc: "Root package", x: 58, y: 96 },
      { id: "sdk", title: "SDK", role: "dependency", icon: "schema", desc: "Shared client", x: 260, y: 72 },
      { id: "runtime", title: "Runtime", role: "dependency", icon: "server", desc: "Execution layer", x: 260, y: 188 },
      { id: "database", title: "Database Client", role: "dependency", icon: "database", desc: "Persistence adapter", x: 462, y: 72 },
    ],
    edges: [
      { source: "app", target: "sdk", label: "imports", role: "depends-on" },
      { source: "app", target: "runtime", label: "runs on", role: "depends-on" },
      { source: "sdk", target: "database", label: "uses", role: "depends-on" },
    ],
  },
  deployment: {
    title: "Deployment Slice",
    intent: "deployment",
    icon: "cloud",
    color: "cyan",
    subtitle: "Runtime placement and external services",
    nodes: [
      { id: "browser", title: "Browser", role: "actor", icon: "browser", display: "compact", x: 58, y: 98 },
      { id: "web", title: "Web Runtime", role: "service", icon: "cloud", desc: "Hosted frontend", x: 220, y: 92 },
      { id: "api", title: "API Runtime", role: "api", icon: "server", desc: "Backend runtime", x: 438, y: 92 },
      { id: "database", title: "Database", role: "datastore", icon: "database", desc: "Managed persistence", x: 438, y: 214 },
    ],
    edges: [
      { source: "browser", target: "web", label: "load", role: "calls" },
      { source: "web", target: "api", label: "https", role: "calls" },
      { source: "api", target: "database", label: "query", role: "reads" },
    ],
  },
};

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
  decision: "generic:router",
  dependency: "generic:schema",
  event: "generic:webhook",
  package: "generic:schema",
  state: "generic:flow",
  terminal: "generic:security",
  users: "generic:users",
  monitor: "generic:client",
  persistence: "generic:database",
  queue: "generic:queue",
  router: "generic:router",
  server: "generic:server",
  service: "generic:service",
  settings: "generic:settings",
  schema: "generic:schema",
  start: "generic:flow",
  storage: "generic:storage",
  subscription: "generic:subscription",
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
  schema: Schema,
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
};

const ARCHITECTURE_KIND_ICON_FALLBACKS = {
  api: "generic:api",
  client: "generic:client",
  database: "generic:database",
  external: "generic:external",
  group: "generic:group",
  queue: "generic:queue",
  service: "generic:service",
  state: "generic:flow",
  decision: "generic:router",
  action: "generic:settings",
  event: "generic:webhook",
  terminal: "generic:security",
  dependency: "generic:schema",
  worker: "generic:worker",
};

const ARCHITECTURE_SEMANTIC_ICON_SLUGS = new Set([
  "ai",
  "api",
  "auth",
  "authentication",
  "authorization",
  "browser",
  "box",
  "boxes",
  "cache",
  "client",
  "cloud",
  "compute",
  "config",
  "database",
  "datastore",
  "db",
  "document",
  "external",
  "external-service",
  "file",
  "flow",
  "folder",
  "gateway",
  "group",
  "decision",
  "dependency",
  "event",
  "package",
  "monitor",
  "persistence",
  "queue",
  "router",
  "schema",
  "security",
  "server",
  "service",
  "settings",
  "state",
  "start",
  "storage",
  "subscription",
  "terminal",
  "user",
  "users",
  "webhook",
  "worker",
]);

const ARCHITECTURE_TITLE_ICON_SUFFIXES = new Set([
  "account",
  "accounts",
  "api",
  "apis",
  "app",
  "application",
  "auth",
  "authentication",
  "bucket",
  "buckets",
  "cache",
  "client",
  "cloud",
  "cluster",
  "database",
  "databases",
  "db",
  "gateway",
  "integration",
  "platform",
  "provider",
  "providers",
  "queue",
  "router",
  "sdk",
  "server",
  "service",
  "services",
  "store",
  "storage",
  "system",
  "worker",
]);

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

function architectureIconTokenIsGeneric(value) {
  const parts = architectureIconParts(value);
  if (!parts.slug) return true;
  if (parts.namespace === "generic") return true;
  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    const aliasParts = architectureIconParts(aliasTarget);
    return aliasParts.namespace === "generic"
      || ARCHITECTURE_SEMANTIC_ICON_SLUGS.has(aliasParts.slug);
  }
  return ARCHITECTURE_SEMANTIC_ICON_SLUGS.has(parts.slug);
}

function architectureLabelIconHintTokens(value) {
  const slug = architectureIconSlug(value);
  if (!slug) return [];
  const tokens = [];
  const seen = new Set();
  const addToken = (token) => {
    const clean = architectureIconSlug(token);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    tokens.push(clean);
  };
  addToken(slug);

  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && ARCHITECTURE_TITLE_ICON_SUFFIXES.has(parts.at(-1))) {
    parts.pop();
    addToken(parts.join("-"));
  }

  if (slug.includes("-")) {
    addToken(slug.replace(/-/gu, ""));
  }

  return tokens;
}

function architectureAddPackageIconHint(state, value, depth = 0) {
  if (!state || depth > 4) return;
  const parts = architectureIconParts(value);
  if (!parts.slug) return;
  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    if (!architectureIconTokenIsGeneric(aliasTarget)) {
      architectureAddIconToken(state, aliasTarget, depth + 1);
    }
    return;
  }

  if (parts.namespace === "generic") return;

  if (parts.namespace === "styled") {
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
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

  if (parts.namespace) return;

  if (!parts.slug.endsWith("-icon")) {
    architectureAddLikeC4Candidate(state.candidates, "tech", `${parts.slug}-icon`);
  }
  architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
}

function architectureAddLabelIconHints(state, value) {
  architectureLabelIconHintTokens(value).forEach((token) => {
    architectureAddPackageIconHint(state, token);
  });
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

function architectureResolveIconDescriptor(icon, kind = "service", labelHint = "") {
  const state = {
    candidates: [],
    seenTokens: new Set(),
    styledCandidates: [],
    styledKey: "",
  };
  const rawIcon = text(icon);
  const rawKind = text(kind, "service");
  const rawLabelHint = text(labelHint);
  if (!rawIcon || architectureIconTokenIsGeneric(rawIcon)) {
    architectureAddLabelIconHints(state, rawLabelHint);
  }
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
      rawLabelHint,
    ].join("|"),
    label: architectureIconInitials(rawLabelHint || displayName),
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

function useArchitectureIcon(icon, kind = "service", labelHint = "") {
  const descriptor = useMemo(
    () => architectureResolveIconDescriptor(icon, kind, labelHint),
    [icon, kind, labelHint],
  );
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

function architectureSemanticSlug(value, fallback = "") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .toLowerCase()
    .replace(/[_\s]+/gu, "-")
    .replace(/[^a-z0-9:-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "") || fallback;
}

function architectureSemanticOptionLabel(options, value, fallback = "") {
  const slug = architectureSemanticSlug(value);
  return options.find((option) => option.value === slug)?.label
    || text(fallback)
    || slug.replace(/[-_]+/gu, " ");
}

function architectureGroupIntent(value, fallback = "architecture") {
  const slug = architectureSemanticSlug(value, fallback);
  return ARCHITECTURE_GROUP_INTENT_VALUES.has(slug) ? slug : slug;
}

function architectureGroupIntentLabel(value) {
  return architectureSemanticOptionLabel(ARCHITECTURE_KIND_OPTIONS, value, "Architecture");
}

function architectureNodeRole(value, fallback = "service") {
  const slug = architectureSemanticSlug(value, fallback);
  if (slug === "client" || slug === "user" || slug === "users") return "actor";
  if (slug === "database" || slug === "db" || slug === "store" || slug === "storage") return "datastore";
  if (slug === "router") return "controller";
  if (slug === "depends" || slug === "dependency") return "dependency";
  return ARCHITECTURE_NODE_ROLE_VALUES.has(slug) ? slug : slug;
}

function architectureEdgeRole(value, fallback = "calls") {
  const slug = architectureSemanticSlug(value, fallback);
  if (slug === "depends" || slug === "dependency") return "depends-on";
  if (slug === "call") return "calls";
  if (slug === "transition") return "transitions";
  if (slug === "guard") return "guards";
  if (slug === "fail" || slug === "failure") return "fails-to";
  return ARCHITECTURE_EDGE_ROLE_VALUES.has(slug) ? slug : slug;
}

function architectureNodeKindFromRole(role, fallback = "service") {
  return ARCHITECTURE_NODE_ROLE_KIND[architectureNodeRole(role)] || fallback;
}

function architectureEdgeKindFromRole(role, fallback = "calls") {
  return ARCHITECTURE_EDGE_ROLE_KIND[architectureEdgeRole(role)] || fallback;
}

function architectureCleanDslProps(props = {}) {
  const object = jsonObject(props) || {};
  return Object.fromEntries(
    Object.entries(object)
      .map(([key, value]) => [text(key), text(value)])
      .filter(([key, value]) => key && value),
  );
}

function architecturePropsWithOrderedOverrides(baseProps = {}, overrides = {}) {
  const next = {
    ...architectureCleanDslProps(baseProps),
    ...architectureCleanDslProps(overrides),
  };
  return Object.fromEntries(Object.entries(next).filter(([, value]) => text(value)));
}

function architectureEdgeConnectorForRole(role, kind = "") {
  const edgeRole = architectureEdgeRole(role || kind);
  const edgeKind = text(kind);
  if (edgeRole === "depends-on" || edgeKind === "depends") return "--";
  return ">";
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

function architectureNormalizeNodeDisplay(value) {
  const raw = architectureIconSlug(value);
  if (/(^|-)(compact|actor|person|people|human|icon|avatar)(-|$)/u.test(raw)) return "compact";
  if (/(^|-)(card|full|node|component)(-|$)/u.test(raw)) return "card";
  return "";
}

function architectureNodeDisplayMode(node, isGroup = false) {
  if (isGroup) return "group";
  const explicit = architectureNormalizeNodeDisplay(
    node?.display || node?.variant || node?.shape || node?.mode || node?.presentation,
  );
  if (explicit) return explicit;

  const titleSlug = architectureIconSlug(node?.title || node?.label || node?.name);
  const iconSlug = architectureIconSlug(node?.icon);
  const kindSlug = architectureIconSlug(node?.kind || node?.type);
  const actorPattern = /(^|-)(user|users|customer|customers|visitor|visitors|admin|admins|operator|operators|person|people|human|humans|actor|actors|agent|agents|bot|bots|client|clients|browser|browsers|cli|terminal)(-|$)/u;
  const systemTitlePattern = /(^|-)(api|service|server|database|db|store|storage|queue|worker|sdk|context|component|router|gateway|controller|manager|provider|page|pages|route|routes)(-|$)/u;
  const actorByIconOrKind = actorPattern.test(iconSlug) || actorPattern.test(kindSlug);
  const actorByTitle = actorPattern.test(titleSlug) && !systemTitlePattern.test(titleSlug);
  return (actorByIconOrKind || actorByTitle)
    ? "compact"
    : "card";
}

function architectureIsCompactNode(node, isGroup = false) {
  return architectureNodeDisplayMode(node, isGroup) === "compact";
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

  const rawDirection = text(graph?.layout?.direction, "LR").toUpperCase();
  const direction = ["LR", "RL", "TB", "BT"].includes(rawDirection) ? rawDirection : "LR";
  const horizontal = direction === "LR" || direction === "RL";
  const reverseRanks = direction === "RL" || direction === "BT";
  const nodeWidth = ARCHITECTURE_NODE_CARD_WIDTH;
  const nodeHeight = ARCHITECTURE_NODE_CARD_HEIGHT;
  const groupMinWidth = 460;
  const groupMinHeight = 280;
  const groupPadX = 52;
  const groupHeaderHeight = 88;
  const groupPadBottom = 48;
  const rootPadX = 80;
  const rootPadY = 70;
  const rankGap = 176;
  const rowGap = 54;
  const groupRankGap = 116;
  const groupRowGap = 46;
  const edges = jsonArray(graph.edges)
    .map((edge) => ({
      source: text(edge?.source || edge?.from),
      target: text(edge?.target || edge?.to),
    }))
    .filter((edge) => edge.source && edge.target && byId.has(edge.source) && byId.has(edge.target));
  const rankById = new Map(nodes.map((node) => [node.id, 0]));
  const incomingById = new Map(nodes.map((node) => [node.id, new Set()]));
  const outgoingById = new Map(nodes.map((node) => [node.id, new Set()]));

  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    incomingById.get(edge.target)?.add(edge.source);
    outgoingById.get(edge.source)?.add(edge.target);
  });

  const sortedNodes = [...nodes].sort((left, right) => left.__order - right.__order);
  const queue = sortedNodes
    .filter((node) => !(incomingById.get(node.id)?.size))
    .map((node) => node.id);
  if (!queue.length) {
    sortedNodes.forEach((node) => queue.push(node.id));
  }
  const indegree = new Map(nodes.map((node) => [node.id, incomingById.get(node.id)?.size || 0]));
  const queued = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sourceId = queue[cursor];
    const sourceRank = rankById.get(sourceId) || 0;
    [...(outgoingById.get(sourceId) || [])]
      .sort((left, right) => (byId.get(left)?.__order || 0) - (byId.get(right)?.__order || 0))
      .forEach((targetId) => {
        rankById.set(targetId, Math.max(rankById.get(targetId) || 0, sourceRank + 1));
        indegree.set(targetId, Math.max(0, (indegree.get(targetId) || 0) - 1));
        if ((indegree.get(targetId) || 0) === 0 && !queued.has(targetId)) {
          queued.add(targetId);
          queue.push(targetId);
        }
      });
  }
  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let changed = false;
    edges.forEach((edge) => {
      const nextRank = Math.min(nodes.length, (rankById.get(edge.source) || 0) + 1);
      if ((rankById.get(edge.target) || 0) < nextRank) {
        rankById.set(edge.target, nextRank);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const descendantsByGroup = new Map();
  function descendantNodeIds(groupId) {
    if (descendantsByGroup.has(groupId)) return descendantsByGroup.get(groupId);
    const directChildren = childrenByParent.get(groupId) || [];
    const ids = [];
    directChildren.forEach((child) => {
      if (child.type === "group") {
        ids.push(...descendantNodeIds(child.id));
      } else {
        ids.push(child.id);
      }
    });
    descendantsByGroup.set(groupId, ids);
    return ids;
  }

  function rankForEntity(entity) {
    if (!entity) return 0;
    if (entity.type !== "group") return rankById.get(entity.id) || 0;
    const childRanks = descendantNodeIds(entity.id)
      .map((id) => rankById.get(id))
      .filter((rank) => Number.isFinite(rank));
    return childRanks.length ? Math.min(...childRanks) : rankById.get(entity.id) || 0;
  }

  function layoutRankedBoxes(boxes, options = {}) {
    const safeBoxes = boxes.filter(Boolean);
    const paddingLeft = numberValue(options.paddingLeft, 0);
    const paddingTop = numberValue(options.paddingTop, 0);
    const paddingRight = numberValue(options.paddingRight, paddingLeft);
    const paddingBottom = numberValue(options.paddingBottom, paddingTop);
    const localRankGap = numberValue(options.rankGap, rankGap);
    const localRowGap = numberValue(options.rowGap, rowGap);
    const minWidth = numberValue(options.minWidth, 0);
    const minHeight = numberValue(options.minHeight, 0);
    if (!safeBoxes.length) {
      return {
        boxes: [],
        height: Math.max(minHeight, paddingTop + paddingBottom),
        width: Math.max(minWidth, paddingLeft + paddingRight),
      };
    }

    const rankKeys = [...new Set(safeBoxes.map((box) => numberValue(box.rank, 0)))]
      .sort((left, right) => left - right);
    if (reverseRanks) rankKeys.reverse();
    const boxesByRank = new Map(rankKeys.map((rank) => [rank, []]));
    safeBoxes
      .sort((left, right) => (
        numberValue(left.rank, 0) - numberValue(right.rank, 0)
          || numberValue(left.order, 0) - numberValue(right.order, 0)
          || text(left.id).localeCompare(text(right.id))
      ))
      .forEach((box) => {
        const rank = numberValue(box.rank, 0);
        if (!boxesByRank.has(rank)) boxesByRank.set(rank, []);
        boxesByRank.get(rank).push(box);
      });

    const placed = [];
    let width = paddingLeft + paddingRight;
    let height = paddingTop + paddingBottom;
    if (horizontal) {
      let x = paddingLeft;
      rankKeys.forEach((rank) => {
        const rankBoxes = boxesByRank.get(rank) || [];
        const columnWidth = Math.max(...rankBoxes.map((box) => numberValue(box.width, nodeWidth)), nodeWidth);
        let y = paddingTop;
        rankBoxes.forEach((box) => {
          const boxWidth = numberValue(box.width, nodeWidth);
          const boxHeight = numberValue(box.height, nodeHeight);
          placed.push({
            ...box,
            x: Math.round(x + Math.max(0, (columnWidth - boxWidth) / 2)),
            y: Math.round(y),
          });
          y += boxHeight + localRowGap;
        });
        width = Math.max(width, x + columnWidth + paddingRight);
        height = Math.max(height, y - localRowGap + paddingBottom);
        x += columnWidth + localRankGap;
      });
    } else {
      let y = paddingTop;
      rankKeys.forEach((rank) => {
        const rankBoxes = boxesByRank.get(rank) || [];
        const rowHeight = Math.max(...rankBoxes.map((box) => numberValue(box.height, nodeHeight)), nodeHeight);
        let x = paddingLeft;
        rankBoxes.forEach((box) => {
          const boxWidth = numberValue(box.width, nodeWidth);
          const boxHeight = numberValue(box.height, nodeHeight);
          placed.push({
            ...box,
            x: Math.round(x),
            y: Math.round(y + Math.max(0, (rowHeight - boxHeight) / 2)),
          });
          x += boxWidth + localRowGap;
        });
        width = Math.max(width, x - localRowGap + paddingRight);
        height = Math.max(height, y + rowHeight + paddingBottom);
        y += rowHeight + localRankGap;
      });
    }

    return {
      boxes: placed,
      height: Math.max(minHeight, Math.round(height)),
      width: Math.max(minWidth, Math.round(width)),
    };
  }

  const laidOutGroups = new Map();
  function boxForEntity(entity) {
    if (!entity) return null;
    if (entity.type === "group") return layoutGroup(entity);
    const compact = architectureIsCompactNode(entity);
    return {
      height: compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : nodeHeight,
      id: entity.id,
      node: entity,
      order: entity.__order,
      rank: rankForEntity(entity),
      width: compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : nodeWidth,
    };
  }

  function layoutGroup(group) {
    if (laidOutGroups.has(group.id)) return laidOutGroups.get(group.id);
    const directChildren = childrenByParent.get(group.id) || [];
    const childBoxes = directChildren.map(boxForEntity).filter(Boolean);
    const layout = layoutRankedBoxes(childBoxes, {
      minHeight: groupMinHeight,
      minWidth: groupMinWidth,
      paddingBottom: groupPadBottom,
      paddingLeft: groupPadX,
      paddingRight: groupPadX,
      paddingTop: groupHeaderHeight,
      rankGap: groupRankGap,
      rowGap: groupRowGap,
    });
    layout.boxes.forEach((box) => {
      box.node.position = { x: box.x, y: box.y };
    });
    group.width = Math.max(numberValue(group.width, 0), layout.width);
    group.height = Math.max(numberValue(group.height, 0), layout.height);
    const groupBox = {
      height: group.height,
      id: group.id,
      node: group,
      order: group.__order,
      rank: rankForEntity(group),
      width: group.width,
    };
    laidOutGroups.set(group.id, groupBox);
    return groupBox;
  }

  const rootLayout = layoutRankedBoxes((childrenByParent.get("") || []).map(boxForEntity), {
    minHeight: 360,
    minWidth: 760,
    paddingBottom: rootPadY,
    paddingLeft: rootPadX,
    paddingRight: rootPadX,
    paddingTop: rootPadY,
    rankGap,
    rowGap,
  });
  rootLayout.boxes.forEach((box) => {
    box.node.position = { x: box.x, y: box.y };
  });

  return {
    ...graph,
    layout: {
      ...(jsonObject(graph?.layout) || {}),
      direction,
      engine: "ranked",
    },
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
    const semanticProps = architectureCleanDslProps(props);
    const title = text(props.label, cleanName);
    const intent = isGroup
      ? architectureGroupIntent(props.intent || props.view || props.kind || props.type)
      : "";
    const role = !isGroup
      ? architectureNodeRole(props.role || props.kind || props.type || architectureIconKind(props.icon, "service"))
      : "";
    const icon = text(
      props.icon,
      isGroup
        ? ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group"
        : ARCHITECTURE_NODE_ROLE_ICONS[role] || "",
    );
    const kind = isGroup ? "group" : architectureNodeKindFromRole(role, architectureIconKind(icon, "service"));
    const display = architectureNodeDisplayMode({ ...props, icon, kind, role, title }, isGroup);
    const node = {
      id,
      title,
      subtitle: display === "compact"
        ? ""
        : text(props.desc || props.description, isGroup ? architectureGroupIntentLabel(intent) : ""),
      kind,
      type: isGroup ? "group" : "node",
      icon,
      color: text(props.color, isGroup ? ARCHITECTURE_GROUP_INTENT_COLORS[intent] : ""),
      semanticProps,
      ...(isGroup ? {
        intent,
        owner: text(props.owner),
        scope: text(props.scope),
        status: text(props.status),
      } : {
        lifecycle: text(props.lifecycle),
        role,
        source: text(props.source || props.ref || props.reference),
        status: text(props.status),
      }),
      ...(!isGroup ? { display } : {}),
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
      const labelParts = architectureExtractDslProps(connectionLabelRaw);
      const cleanLabel = labelParts.name;
      const edgeProps = architectureCleanDslProps(labelParts.props);
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
            const role = architectureEdgeRole(
              edgeProps.role || edgeProps.kind || edgeProps.type,
              connector.value === "--" ? "depends-on" : "calls",
            );
            parsed.edges.push({
              id: uniqueId(`${sourceId}-${targetId}`, "edge"),
              source: sourceId,
              target: targetId,
              label: cleanLabel,
              kind: architectureEdgeKindFromRole(role, connector.value === "--" ? "depends" : "calls"),
              role,
              condition: text(edgeProps.condition || edgeProps.guard),
              criticality: text(edgeProps.criticality),
              event: text(edgeProps.event),
              semanticProps: edgeProps,
            });
            if (connector.value === "<>") {
              parsed.edges.push({
                id: uniqueId(`${targetId}-${sourceId}`, "edge"),
                source: targetId,
                target: sourceId,
                label: cleanLabel,
                kind: architectureEdgeKindFromRole(role, "calls"),
                role,
                condition: text(edgeProps.condition || edgeProps.guard),
                criticality: text(edgeProps.criticality),
                event: text(edgeProps.event),
                semanticProps: edgeProps,
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

function architectureSliceTemplateLines(templateKey = "architecture") {
  const template = ARCHITECTURE_SEMANTIC_SLICE_TEMPLATES[templateKey]
    || ARCHITECTURE_SEMANTIC_SLICE_TEMPLATES.architecture;
  const groupProps = {
    icon: template.icon || ARCHITECTURE_GROUP_INTENT_ICONS[template.intent] || "group",
    color: template.color || ARCHITECTURE_GROUP_INTENT_COLORS[template.intent],
    intent: template.intent,
    desc: template.subtitle,
  };
  const lines = [
    `${architectureDslName(template.title)}${architectureDslPropsText(groupProps)} {`,
  ];
  template.nodes.forEach((node) => {
    const props = {
      icon: node.icon || ARCHITECTURE_NODE_ROLE_ICONS[node.role],
      role: node.role,
      ...(node.display ? { display: node.display } : {}),
      ...(node.lifecycle ? { lifecycle: node.lifecycle } : {}),
      ...(!node.display || node.display !== "compact" ? { desc: node.desc } : {}),
    };
    lines.push(`  ${architectureDslName(node.title)}${architectureDslPropsText(props)}`);
  });
  lines.push("}", "");
  template.edges.forEach((edge) => {
    const source = template.nodes.find((node) => node.id === edge.source)?.title || edge.source;
    const target = template.nodes.find((node) => node.id === edge.target)?.title || edge.target;
    const edgeProps = {
      role: edge.role,
      ...(edge.condition ? { condition: edge.condition } : {}),
      ...(edge.event ? { event: edge.event } : {}),
      ...(edge.criticality ? { criticality: edge.criticality } : {}),
    };
    const label = text(edge.label);
    const labelWithProps = `${label}${architectureDslPropsText(edgeProps)}`;
    lines.push(`${architectureDslName(source)} ${architectureEdgeConnectorForRole(edge.role)} ${architectureDslName(target)}: ${labelWithProps.trim()}`);
  });
  return lines;
}

function architectureStarterSource({ groupPath = "", template = "system", title = "" } = {}) {
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
  lines.push("");
  const templateKeys = template === "system"
    ? ["architecture", "api-pathway", "data-flow"]
    : [template];
  templateKeys.forEach((templateKey, index) => {
    if (index) lines.push("");
    lines.push(...architectureSliceTemplateLines(templateKey));
  });
  return `${lines.join("\n")}\n`;
}

function architectureStarterGraph({ groupPath = "", template = "system", title = "" } = {}) {
  const cleanTitle = text(title, "Architecture graph");
  const id = `${architectureSlug(cleanTitle)}-${String(Date.now()).slice(-5)}`;
  const source = architectureStarterSource({ groupPath, template, title: cleanTitle });
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

function architectureSourceHandlePosition(direction) {
  if (direction === "TB") return Position.Bottom;
  if (direction === "BT") return Position.Top;
  if (direction === "RL") return Position.Left;
  return Position.Right;
}

function architectureTargetHandlePosition(direction) {
  if (direction === "TB") return Position.Top;
  if (direction === "BT") return Position.Bottom;
  if (direction === "RL") return Position.Right;
  return Position.Left;
}

function architectureFlowNodeFromGraphNode(node, index = 0, direction = "LR") {
  const isSourceGroup = text(node?.kind || node?.type) === "group" || text(node?.type) === "group";
  const intent = isSourceGroup ? architectureGroupIntent(node?.intent || node?.view || node?.groupIntent) : "";
  const role = !isSourceGroup ? architectureNodeRole(node?.role || node?.semanticRole || node?.kind || node?.type) : "";
  const rawKind = text(
    node?.kind && node?.kind !== "node" ? node.kind : "",
    isSourceGroup ? "group" : architectureNodeKindFromRole(role, "service"),
  );
  const isGroup = rawKind === "group" || text(node?.type) === "group";
  const id = text(node?.id, architectureEntityId(isGroup ? "group" : "node"));
  const parentId = text(node?.parentId || node?.parent_id);
  const position = jsonObject(node?.position) || {};
  const title = text(node?.title || node?.label, isGroup ? "Group" : "Node");
  const semanticProps = architectureCleanDslProps(node?.semanticProps || node?.semantic_props || node?.props);
  const display = architectureNodeDisplayMode({ ...node, kind: rawKind, role, title }, isGroup);
  const compact = display === "compact";
  const icon = text(
    node?.icon,
    isGroup
      ? ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group"
      : ARCHITECTURE_NODE_ROLE_ICONS[role] || "",
  );
  const width = numberValue(
    node?.width || node?.style?.width,
    isGroup ? 460 : compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : ARCHITECTURE_NODE_CARD_WIDTH,
  );
  const height = numberValue(
    node?.height || node?.style?.height,
    isGroup ? 280 : compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : ARCHITECTURE_NODE_CARD_HEIGHT,
  );

  return {
    id,
    type: isGroup ? "architectureGroup" : "architectureNode",
    parentId: parentId || undefined,
    extent: parentId ? "parent" : undefined,
    position: {
      x: numberValue(position.x, 80 + (index % 3) * 220),
      y: numberValue(position.y, 80 + Math.floor(index / 3) * 120),
    },
    sourcePosition: architectureSourceHandlePosition(direction),
    style: isGroup || compact ? { width, height } : undefined,
    targetPosition: architectureTargetHandlePosition(direction),
    data: {
      color: text(node?.color),
      display,
      flowDirection: direction,
      icon,
      intent,
      kind: isGroup ? "group" : rawKind,
      lifecycle: text(node?.lifecycle),
      owner: text(node?.owner),
      role,
      scope: text(node?.scope),
      semanticProps,
      source: text(node?.source || node?.sourceRef || node?.reference),
      status: text(node?.status),
      subtitle: compact ? "" : text(
        node?.subtitle || node?.description,
        isGroup ? architectureGroupIntentLabel(intent) : "",
      ),
      title,
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
    zIndex: 0,
    markerEnd: {
      color: "rgba(125, 211, 252, 0.88)",
      height: 18,
      type: MarkerType.ArrowClosed,
      width: 18,
    },
    data: {
      condition: text(edge?.condition || edge?.guard),
      criticality: text(edge?.criticality),
      event: text(edge?.event),
      kind: text(edge?.kind, architectureEdgeKindFromRole(edge?.role, "calls")),
      label: text(edge?.label || edge?.title),
      role: architectureEdgeRole(edge?.role || edge?.kind, "calls"),
      semanticProps: architectureCleanDslProps(edge?.semanticProps || edge?.semantic_props || edge?.props),
    },
  };
}

function architectureGraphToFlow(graph) {
  const compiledGraph = architectureParseDslGraph(graph) || graph;
  const direction = text(compiledGraph?.layout?.direction, "LR").toUpperCase();
  const nodes = jsonArray(compiledGraph?.nodes).map((node, index) => (
    architectureFlowNodeFromGraphNode(node, index, direction)
  ));
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
  const allNodes = [...groupNodes, ...regularNodes];
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  allNodes.forEach((node) => {
    const parentId = text(node.parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const titleCounts = new Map();
  allNodes.forEach((node) => {
    const title = text(node.data?.title || node.id, node.id).toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
  });
  const dslNameById = new Map();
  const dslLabelById = new Map();
  allNodes.forEach((node) => {
    const title = text(node.data?.title || node.id, node.id);
    const duplicateTitle = (titleCounts.get(title.toLowerCase()) || 0) > 1;
    const parentTitle = text(nodeById.get(node.parentId)?.data?.title);
    const idSuffix = text(node.id).split("-").filter(Boolean).at(-1);
    const dslName = duplicateTitle
      ? [parentTitle, title, idSuffix].filter(Boolean).join(" / ")
      : title;
    dslNameById.set(node.id, dslName);
    if (dslName !== title) dslLabelById.set(node.id, title);
  });
  const lineForNode = (node, depth) => {
    const display = architectureNodeDisplayMode(node.data || {}, false);
    const compact = display === "compact";
    const role = architectureNodeRole(node.data?.role || node.data?.kind);
    const props = architecturePropsWithOrderedOverrides(node.data?.semanticProps, {
      icon: node.data?.icon || ARCHITECTURE_NODE_ROLE_ICONS[role] || node.data?.kind,
      ...(dslLabelById.has(node.id) ? { label: dslLabelById.get(node.id) } : {}),
      role,
      ...(compact ? { display: "compact" } : {}),
      ...(node.data?.lifecycle ? { lifecycle: node.data.lifecycle } : {}),
      ...(node.data?.source ? { source: node.data.source } : {}),
      ...(node.data?.status ? { status: node.data.status } : {}),
      ...(!compact ? { desc: node.data?.subtitle } : {}),
    });
    return `${"  ".repeat(depth)}${architectureDslName(dslNameById.get(node.id) || node.data?.title || node.id)}${architectureDslPropsText(props)}`;
  };
  const lines = [
    `title ${architectureDslString(graphTitle)}`,
    "direction right",
  ];
  if (groupPath.length) lines.push(`folder ${architectureDslString(groupPath.join(" / "))}`);
  lines.push("");
  const emitGroup = (group, depth = 0) => {
    const intent = architectureGroupIntent(group.data?.intent);
    lines.push(`${"  ".repeat(depth)}${architectureDslName(dslNameById.get(group.id) || group.data?.title || group.id)}${architectureDslPropsText(architecturePropsWithOrderedOverrides(group.data?.semanticProps, {
      icon: group.data?.icon || ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "box",
      color: group.data?.color || ARCHITECTURE_GROUP_INTENT_COLORS[intent],
      intent,
      ...(dslLabelById.has(group.id) ? { label: dslLabelById.get(group.id) } : {}),
      ...(group.data?.scope ? { scope: group.data.scope } : {}),
      ...(group.data?.owner ? { owner: group.data.owner } : {}),
      ...(group.data?.status ? { status: group.data.status } : {}),
      desc: group.data?.subtitle,
    }))} {`);
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
  edges.forEach((edge) => {
    const source = architectureDslName(dslNameById.get(edge.source) || edge.source);
    const target = architectureDslName(dslNameById.get(edge.target) || edge.target);
    const label = text(edge.data?.label);
    const role = architectureEdgeRole(edge.data?.role || edge.data?.kind);
    const props = architecturePropsWithOrderedOverrides(edge.data?.semanticProps, {
      role,
      ...(edge.data?.condition ? { condition: edge.data.condition } : {}),
      ...(edge.data?.event ? { event: edge.data.event } : {}),
      ...(edge.data?.criticality ? { criticality: edge.data.criticality } : {}),
    });
    const labelWithProps = `${label}${architectureDslPropsText(props)}`.trim();
    lines.push(`${source} ${architectureEdgeConnectorForRole(role, edge.data?.kind)} ${target}${labelWithProps ? `: ${labelWithProps}` : ""}`);
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
      const display = architectureNodeDisplayMode(node.data || {}, isGroup);
      const compact = display === "compact";
      const intent = isGroup ? architectureGroupIntent(node.data?.intent) : "";
      const role = !isGroup ? architectureNodeRole(node.data?.role || node.data?.kind) : "";
      return {
        id: node.id,
        title: text(node.data?.title, isGroup ? "Group" : "Node"),
        subtitle: compact ? "" : text(node.data?.subtitle),
        icon: text(node.data?.icon),
        color: text(node.data?.color),
        kind: isGroup ? "group" : text(node.data?.kind, "service"),
        type: isGroup ? "group" : "node",
        semanticProps: architectureCleanDslProps(node.data?.semanticProps),
        ...(isGroup ? {
          intent,
          owner: text(node.data?.owner),
          scope: text(node.data?.scope),
          status: text(node.data?.status),
        } : {
          display,
          lifecycle: text(node.data?.lifecycle),
          role,
          source: text(node.data?.source),
          status: text(node.data?.status),
        }),
        position: {
          x: Math.round(numberValue(node.position?.x, 0)),
          y: Math.round(numberValue(node.position?.y, 0)),
        },
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(isGroup || compact ? {
          height: Math.round(numberValue(
            node.style?.height,
            isGroup ? 220 : ARCHITECTURE_NODE_COMPACT_HEIGHT,
          )),
          width: Math.round(numberValue(
            node.style?.width,
            isGroup ? 360 : ARCHITECTURE_NODE_COMPACT_WIDTH,
          )),
        } : {}),
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: text(edge.data?.condition),
      criticality: text(edge.data?.criticality),
      event: text(edge.data?.event),
      label: text(edge.data?.label),
      kind: text(edge.data?.kind, "calls"),
      role: architectureEdgeRole(edge.data?.role || edge.data?.kind),
      semanticProps: architectureCleanDslProps(edge.data?.semanticProps),
    })),
    layout: {
      ...(jsonObject(graph?.layout) || {}),
      engine: "manual",
    },
  };
}

function architectureExpandParentNodesForChild(nodes, parentId, childPosition, childSize, padding = 58) {
  let nextNodes = nodes;
  let currentParentId = text(parentId);
  let requiredWidth = numberValue(childPosition?.x, 0) + numberValue(childSize?.width, 0) + padding;
  let requiredHeight = numberValue(childPosition?.y, 0) + numberValue(childSize?.height, 0) + padding;

  while (currentParentId) {
    const parentNode = nextNodes.find((node) => node.id === currentParentId);
    if (!parentNode) break;
    const currentWidth = numberValue(parentNode.style?.width, 460);
    const currentHeight = numberValue(parentNode.style?.height, 280);
    const nextWidth = Math.max(currentWidth, requiredWidth);
    const nextHeight = Math.max(currentHeight, requiredHeight);
    if (nextWidth !== currentWidth || nextHeight !== currentHeight) {
      nextNodes = nextNodes.map((node) => (
        node.id === currentParentId
          ? {
            ...node,
            style: {
              ...(node.style || {}),
              height: nextHeight,
              width: nextWidth,
            },
          }
          : node
      ));
    }

    requiredWidth = numberValue(parentNode.position?.x, 0) + nextWidth + padding;
    requiredHeight = numberValue(parentNode.position?.y, 0) + nextHeight + padding;
    currentParentId = text(parentNode.parentId);
  }

  return nextNodes;
}

function architectureCreateSemanticSliceFlow(intentValue = "architecture", options = {}) {
  const intent = architectureGroupIntent(intentValue);
  const template = ARCHITECTURE_SEMANTIC_SLICE_TEMPLATES[intent]
    || ARCHITECTURE_SEMANTIC_SLICE_TEMPLATES.architecture;
  const index = numberValue(options.index, 0);
  const groupId = architectureEntityId(`group-${intent}`);
  const groupWidth = 650;
  const groupHeight = intent === "control-graph" ? 430 : 340;
  const rootPosition = {
    x: 110 + (index % 3) * 48,
    y: 90 + Math.floor(index / 3) * 44,
  };
  const nodeIdByTemplateId = new Map();
  const nodes = [
    {
      id: groupId,
      type: "architectureGroup",
      position: rootPosition,
      style: { height: groupHeight, width: groupWidth },
      data: {
        color: template.color || ARCHITECTURE_GROUP_INTENT_COLORS[intent],
        icon: template.icon || ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group",
        intent,
        kind: "group",
        semanticProps: {
          color: template.color || ARCHITECTURE_GROUP_INTENT_COLORS[intent],
          desc: template.subtitle,
          icon: template.icon || ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group",
          intent,
        },
        subtitle: template.subtitle,
        title: template.title,
      },
    },
  ];
  template.nodes.forEach((templateNode) => {
    const id = architectureEntityId(`${intent}-${templateNode.id}`);
    const role = architectureNodeRole(templateNode.role);
    const display = text(templateNode.display);
    nodeIdByTemplateId.set(templateNode.id, id);
    nodes.push({
      id,
      type: "architectureNode",
      parentId: groupId,
      extent: "parent",
      position: {
        x: numberValue(templateNode.x, 58),
        y: numberValue(templateNode.y, 98),
      },
      style: display === "compact" ? {
        height: ARCHITECTURE_NODE_COMPACT_HEIGHT,
        width: ARCHITECTURE_NODE_COMPACT_WIDTH,
      } : undefined,
      data: {
        display,
        icon: templateNode.icon || ARCHITECTURE_NODE_ROLE_ICONS[role] || "service",
        kind: architectureNodeKindFromRole(role, "service"),
        lifecycle: text(templateNode.lifecycle),
        role,
        semanticProps: {
          ...(templateNode.desc && display !== "compact" ? { desc: templateNode.desc } : {}),
          ...(display ? { display } : {}),
          icon: templateNode.icon || ARCHITECTURE_NODE_ROLE_ICONS[role] || "service",
          ...(templateNode.lifecycle ? { lifecycle: templateNode.lifecycle } : {}),
          role,
        },
        subtitle: display === "compact" ? "" : text(templateNode.desc),
        title: templateNode.title,
      },
    });
  });
  const edges = template.edges
    .map((templateEdge) => {
      const source = nodeIdByTemplateId.get(templateEdge.source);
      const target = nodeIdByTemplateId.get(templateEdge.target);
      if (!source || !target) return null;
      const role = architectureEdgeRole(templateEdge.role);
      return {
        id: architectureEntityId(`edge-${intent}`),
        source,
        target,
        type: "architectureEdge",
        zIndex: 0,
        markerEnd: {
          color: "rgba(125, 211, 252, 0.88)",
          height: 18,
          type: MarkerType.ArrowClosed,
          width: 18,
        },
        data: {
          condition: text(templateEdge.condition),
          criticality: text(templateEdge.criticality),
          event: text(templateEdge.event),
          kind: architectureEdgeKindFromRole(role, "calls"),
          label: text(templateEdge.label),
          role,
          semanticProps: {
            ...(templateEdge.condition ? { condition: templateEdge.condition } : {}),
            ...(templateEdge.event ? { event: templateEdge.event } : {}),
            ...(templateEdge.criticality ? { criticality: templateEdge.criticality } : {}),
            role,
          },
        },
      };
    })
    .filter(Boolean);
  return { edges, nodes };
}

function architectureGroupDescendantIds(groupId, nodes) {
  const childrenByParent = new Map();
  jsonArray(nodes).forEach((node) => {
    const parentId = text(node.parentId);
    if (!parentId) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const ids = new Set();
  const visit = (parentId) => {
    (childrenByParent.get(parentId) || []).forEach((child) => {
      if (ids.has(child.id)) return;
      ids.add(child.id);
      visit(child.id);
    });
  };
  visit(groupId);
  return ids;
}

function architectureValidateSemanticGraph(graph, nodes, edges) {
  const warnings = [];
  const nodeById = new Map(jsonArray(nodes).map((node) => [node.id, node]));
  const edgesBySource = new Map();
  jsonArray(edges).forEach((edge) => {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source).push(edge);
  });
  const groups = jsonArray(nodes).filter((node) => node.type === "architectureGroup");
  groups.forEach((group) => {
    const intent = architectureGroupIntent(group.data?.intent);
    if (!["control-graph", "state-machine", "data-flow", "api-pathway", "dependency-graph"].includes(intent)) return;
    const descendantIds = architectureGroupDescendantIds(group.id, nodes);
    const groupNodes = [...descendantIds]
      .map((id) => nodeById.get(id))
      .filter((node) => node && node.type !== "architectureGroup");
    const groupEdges = jsonArray(edges).filter((edge) => descendantIds.has(edge.source) && descendantIds.has(edge.target));
    const title = text(group.data?.title, architectureGroupIntentLabel(intent));
    if (!groupNodes.length) {
      warnings.push(`${title}: add nodes for this ${architectureGroupIntentLabel(intent).toLowerCase()}.`);
      return;
    }
    if (intent === "control-graph" || intent === "state-machine") {
      const startNodes = groupNodes.filter((node) => text(node.data?.lifecycle) === "start" || text(node.data?.role) === "start");
      const terminalNodes = groupNodes.filter((node) => text(node.data?.lifecycle) === "terminal" || text(node.data?.role) === "terminal");
      if (!startNodes.length) warnings.push(`${title}: mark one state as lifecycle start.`);
      if (!terminalNodes.length) warnings.push(`${title}: mark at least one terminal state.`);
      const decisionNodes = groupNodes.filter((node) => architectureNodeRole(node.data?.role) === "decision");
      decisionNodes.forEach((decision) => {
        const outgoing = groupEdges.filter((edge) => edge.source === decision.id);
        const unlabeled = outgoing.filter((edge) => !text(edge.data?.label) && !text(edge.data?.condition));
        if (outgoing.length < 2) warnings.push(`${text(decision.data?.title, "Decision")}: decision should branch to at least two paths.`);
        if (unlabeled.length) warnings.push(`${text(decision.data?.title, "Decision")}: label or condition each decision edge.`);
      });
      if (startNodes.length) {
        const reachable = new Set(startNodes.map((node) => node.id));
        const queue = [...reachable];
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          (edgesBySource.get(queue[cursor]) || []).forEach((edge) => {
            if (!descendantIds.has(edge.target) || reachable.has(edge.target)) return;
            reachable.add(edge.target);
            queue.push(edge.target);
          });
        }
        const unreachable = groupNodes.filter((node) => !reachable.has(node.id));
        if (unreachable.length) warnings.push(`${title}: ${unreachable.length} state/control node${unreachable.length === 1 ? "" : "s"} unreachable from start.`);
      }
    }
    if (intent === "data-flow") {
      const hasDataEdge = groupEdges.some((edge) => ["reads", "writes", "publishes", "subscribes"].includes(architectureEdgeRole(edge.data?.role || edge.data?.kind)));
      if (!hasDataEdge) warnings.push(`${title}: use reads/writes/publishes/subscribes edges for the data path.`);
    }
    if (intent === "api-pathway") {
      const hasEndpoint = groupNodes.some((node) => ["api", "endpoint"].includes(architectureNodeRole(node.data?.role || node.data?.kind)));
      if (!hasEndpoint) warnings.push(`${title}: include an api or endpoint node.`);
    }
    if (intent === "dependency-graph") {
      const hasDepends = groupEdges.some((edge) => architectureEdgeRole(edge.data?.role || edge.data?.kind) === "depends-on");
      if (!hasDepends) warnings.push(`${title}: use depends-on edges to show dependency direction.`);
    }
  });
  return warnings.slice(0, 8);
}

function architectureTodoQueueStorageKey(workspaceId) {
  const safeWorkspaceId = text(workspaceId);
  return safeWorkspaceId ? `${ARCHITECTURE_TODO_QUEUE_STORAGE_PREFIX}.${safeWorkspaceId}` : "";
}

function architectureReadStoredTodoQueueItems(storageKey) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function architectureWriteStoredTodoQueueItems(storageKey, items) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(items.slice(-ARCHITECTURE_TODO_QUEUE_MAX_ITEMS)),
    );
  } catch {
    // Local queue persistence is best effort; the live event still covers mounted terminal views.
  }
}

function architectureNormalizedIdentityText(value) {
  return text(value).replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function architectureGraphIdentity(graph) {
  const graphId = text(graph?.id);
  const graphTitle = text(graph?.title, "Architecture graph");
  const graphFilePath = text(graph?.filePath || graph?.file_path);
  return {
    graphFilePath,
    graphId,
    graphKey: architectureNormalizedIdentityText(graphFilePath || graphId || graphTitle),
    graphTitle,
  };
}

function architectureAgentEditMarkersStorageKey(workspaceId, repoPath) {
  const safeWorkspaceId = architectureNormalizedIdentityText(workspaceId || "local");
  const safeRepoPath = architectureNormalizedIdentityText(repoPath);
  if (!safeWorkspaceId && !safeRepoPath) return "";
  return `${ARCHITECTURE_AGENT_EDIT_MARKERS_STORAGE_PREFIX}.${safeWorkspaceId || "local"}.${safeRepoPath || "repo"}`;
}

function architectureHashText(value) {
  const raw = text(value);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function architectureAgentLabel(value) {
  const raw = text(value);
  const normalized = raw.toLowerCase().replace(/[_\s]+/gu, "-");
  if (normalized.includes("claude")) return "Claude Code";
  if (normalized.includes("opencode")) return "OpenCode";
  if (normalized.includes("codex")) return "Codex";
  return raw || "Coding agent";
}

function architectureAgentColor(value, fallback = "") {
  const normalized = text(value).toLowerCase().replace(/[_\s]+/gu, "-");
  const directColor = ARCHITECTURE_AGENT_EDIT_AGENT_COLORS[normalized];
  if (directColor) return directColor;
  const matchedKey = Object.keys(ARCHITECTURE_AGENT_EDIT_AGENT_COLORS)
    .find((key) => normalized.includes(key));
  if (matchedKey) return ARCHITECTURE_AGENT_EDIT_AGENT_COLORS[matchedKey];
  const colors = ARCHITECTURE_AGENT_EDIT_FALLBACK_COLORS;
  return colors[architectureHashText(value || fallback) % colors.length];
}

function architectureNormalizeAgentEditMarker(marker) {
  if (!marker || typeof marker !== "object") return null;
  const identity = architectureGraphIdentity({
    filePath: marker.graphFilePath || marker.graph_file_path,
    id: marker.graphId || marker.graph_id,
    title: marker.graphTitle || marker.graph_title,
  });
  const commandId = text(marker.commandId || marker.command_id || marker.id);
  const createdAt = text(marker.createdAt || marker.created_at, new Date().toISOString());
  const status = text(marker.status || marker.state, "queued") === "editing" ? "editing" : "queued";
  if (!commandId || !identity.graphKey) return null;
  const agentId = text(marker.agentId || marker.agent_id || marker.codingAgent || marker.coding_agent);
  const agentLabel = architectureAgentLabel(marker.agentLabel || marker.agent_label || agentId);
  return {
    agentColor: text(marker.agentColor || marker.agent_color, architectureAgentColor(agentId || agentLabel, commandId)),
    agentId,
    agentLabel,
    commandId,
    createdAt,
    graphFilePath: identity.graphFilePath,
    graphId: identity.graphId,
    graphKey: identity.graphKey,
    graphTitle: identity.graphTitle,
    id: commandId,
    repoPath: text(marker.repoPath || marker.repo_path),
    status,
    taskId: text(marker.taskId || marker.task_id),
    updatedAt: text(marker.updatedAt || marker.updated_at, createdAt),
    workspaceId: text(marker.workspaceId || marker.workspace_id),
  };
}

function architectureReadStoredAgentEditMarkers(storageKey) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return jsonArray(parsed).map(architectureNormalizeAgentEditMarker).filter(Boolean);
  } catch {
    return [];
  }
}

function architectureWriteStoredAgentEditMarkers(storageKey, markers) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(jsonArray(markers).slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS)),
    );
  } catch {
    // Visual edit markers are best effort; the queued task still exists independently.
  }
}

function architectureTodoCommandId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `architecture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function architectureAgentTaskText({
  commandId,
  graph,
  prompt,
  repoPath,
}) {
  const identity = architectureGraphIdentity(graph);
  return [
    `Architecture graph request: ${prompt}`,
    "",
    commandId ? `Command id: ${commandId}` : "",
    `Current graph: ${identity.graphTitle}`,
    identity.graphFilePath ? `Graph file: ${identity.graphFilePath}` : identity.graphId ? `Graph id: ${identity.graphId}` : "",
    repoPath ? `Repo: ${repoPath}` : "",
    "",
    "Use coordination-kernel.architecture_context first, then update the existing .agents/architectures/graphs/*.arch DSL file for this graph. Keep each edit syntactically valid so the Architecture tab can hot-reload the graph as nodes, groups, and edges are added.",
    "Treat .arch as a general system graph: one graph may contain connected or disconnected groups for architecture, api-pathway, data-flow, control-graph, state-machine, dependency-graph, deployment, runtime, or subsystem slices.",
    "Preserve semantic props when editing. Groups should use intent. Nodes should use role, lifecycle, source, and status when useful. Edges should use role plus condition, event, and criticality when useful.",
    "Use compact actor nodes for people, users, customers, admins, agents, bots, browsers, CLI clients, and similar graph entrypoints: write `User [icon: users, role: actor, display: compact]` or `AI Agent [icon: ai, role: actor, display: compact]` and omit `desc` for those compact nodes.",
  ].filter(Boolean).join("\n");
}

function architectureQueueAgentTodo({
  graph,
  prompt,
  repoPath,
  workspaceId,
  workspaceName,
}) {
  const safeWorkspaceId = text(workspaceId);
  const commandId = architectureTodoCommandId();
  const now = new Date().toISOString();
  const identity = architectureGraphIdentity(graph);
  const architectureGraph = {
    filePath: identity.graphFilePath,
    graphKey: identity.graphKey,
    id: identity.graphId,
    repoPath: text(repoPath),
    title: identity.graphTitle,
  };
  const item = {
    architectureGraph,
    createdAt: now,
    id: commandId,
    kind: "todo",
    queueState: {
      phase: "queued",
      queuedAt: now,
      source: ARCHITECTURE_TODO_QUEUE_SOURCE,
      state: "queued",
      updatedAt: now,
    },
    remoteCommand: {
      architectureGraph,
      commandId,
      graphFilePath: identity.graphFilePath,
      graphId: identity.graphId,
      graphTitle: identity.graphTitle,
      source: "architecture-tab",
    },
    source: ARCHITECTURE_TODO_QUEUE_SOURCE,
    text: architectureAgentTaskText({ commandId, graph, prompt, repoPath }),
    workspaceId: safeWorkspaceId,
  };
  const storageKey = architectureTodoQueueStorageKey(safeWorkspaceId);
  if (storageKey) {
    const currentItems = architectureReadStoredTodoQueueItems(storageKey)
      .filter((candidate) => text(candidate?.id) !== commandId);
    architectureWriteStoredTodoQueueItems(storageKey, currentItems.concat([item]));
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(ARCHITECTURE_REMOTE_TODO_QUEUE_EVENT, {
      detail: {
        commandId,
        item,
        source: "architecture-tab",
        workspaceId: safeWorkspaceId,
        workspaceName: text(workspaceName),
      },
    }));
  }
  return item;
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
  if (["merged", "applied", "done", "completed", "complete", "success", "idle", "ready"].includes(status)) return "done";
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

function architectureTaskAgentId(task) {
  const terminalPlan = taskTerminalPlan(task);
  return text(
    taskAgentLabel(task)
      || terminalPlan?.agent_kind
      || terminalPlan?.agentKind
      || terminalPlan?.agent_id
      || terminalPlan?.agentId,
  );
}

function architectureAgentEditMarkerFromQueueItem(item) {
  const remoteCommand = jsonObject(item?.remoteCommand || item?.remote_command) || {};
  const graphMetadata = jsonObject(
    item?.architectureGraph
      || item?.architecture_graph
      || remoteCommand?.architectureGraph
      || remoteCommand?.architecture_graph,
  ) || {};
  const identity = architectureGraphIdentity({
    filePath: graphMetadata.filePath
      || graphMetadata.file_path
      || remoteCommand.graphFilePath
      || remoteCommand.graph_file_path,
    id: graphMetadata.id || graphMetadata.graphId || graphMetadata.graph_id || remoteCommand.graphId || remoteCommand.graph_id,
    title: graphMetadata.title || graphMetadata.graphTitle || graphMetadata.graph_title || remoteCommand.graphTitle || remoteCommand.graph_title,
  });
  const commandId = text(remoteCommand.commandId || remoteCommand.command_id || item?.id);
  if (!commandId || !identity.graphKey) return null;
  const agentId = text(
    item?.targetAgentId
      || item?.target_agent_id
      || remoteCommand.targetAgentId
      || remoteCommand.target_agent_id,
  );
  return architectureNormalizeAgentEditMarker({
    agentId,
    agentLabel: item?.targetAgentLabel || item?.target_agent_label || architectureAgentLabel(agentId),
    commandId,
    createdAt: item?.createdAt || item?.created_at,
    graphFilePath: identity.graphFilePath,
    graphId: identity.graphId,
    graphTitle: identity.graphTitle,
    repoPath: graphMetadata.repoPath || graphMetadata.repo_path,
    status: "queued",
    updatedAt: item?.updatedAt || item?.updated_at || item?.createdAt || item?.created_at,
    workspaceId: item?.workspaceId || item?.workspace_id,
  });
}

function architectureAgentEditMarkersEqual(left, right) {
  return JSON.stringify(jsonArray(left)) === JSON.stringify(jsonArray(right));
}

function architectureGraphMatchesAgentEditMarker(graph, marker) {
  const identity = architectureGraphIdentity(graph);
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!identity.graphKey || !normalizedMarker) return false;
  if (identity.graphKey === normalizedMarker.graphKey) return true;
  if (identity.graphId && normalizedMarker.graphId && identity.graphId === normalizedMarker.graphId) return true;
  if (
    identity.graphFilePath
    && normalizedMarker.graphFilePath
    && architectureNormalizedIdentityText(identity.graphFilePath)
      === architectureNormalizedIdentityText(normalizedMarker.graphFilePath)
  ) {
    return true;
  }
  return Boolean(
    identity.graphTitle
      && normalizedMarker.graphTitle
      && architectureNormalizedIdentityText(identity.graphTitle)
        === architectureNormalizedIdentityText(normalizedMarker.graphTitle),
  );
}

function architectureAgentEditMarkersGraphMatch(left, right) {
  const normalizedLeft = architectureNormalizeAgentEditMarker(left);
  const normalizedRight = architectureNormalizeAgentEditMarker(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.graphKey && normalizedRight.graphKey && normalizedLeft.graphKey === normalizedRight.graphKey) return true;
  if (normalizedLeft.graphId && normalizedRight.graphId && normalizedLeft.graphId === normalizedRight.graphId) return true;
  if (
    normalizedLeft.graphFilePath
    && normalizedRight.graphFilePath
    && architectureNormalizedIdentityText(normalizedLeft.graphFilePath)
      === architectureNormalizedIdentityText(normalizedRight.graphFilePath)
  ) {
    return true;
  }
  return false;
}

function architectureTaskSearchText(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  const parts = [
    taskPlanTaskId(task),
    taskDisplayTitle(task),
    taskBody(task),
    taskStatus(task),
    architectureTaskAgentId(task),
    task?.id,
    task?.taskId,
    task?.task_id,
    task?.remote_command_id,
    task?.remoteCommandId,
    terminalPlan?.task_id,
    terminalPlan?.taskId,
    terminalPlan?.title,
    terminalPlan?.description,
    ...taskInputBlocks(task).map((block) => block.content),
  ];
  try {
    if (metadata) parts.push(JSON.stringify(metadata));
    if (terminalPlan) parts.push(JSON.stringify(terminalPlan));
  } catch {
    // Some task payloads may contain unserializable values; field-level matching above is enough.
  }
  return parts.map((part) => text(part)).filter(Boolean).join("\n").toLowerCase();
}

function architectureTaskMatchesAgentEditMarker(task, marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!task || !normalizedMarker) return false;
  const haystack = architectureTaskSearchText(task);
  const normalizedHaystack = architectureNormalizedIdentityText(haystack);
  const commandId = text(normalizedMarker.commandId).toLowerCase();
  if (commandId && haystack.includes(commandId)) return true;
  const graphFilePath = architectureNormalizedIdentityText(normalizedMarker.graphFilePath);
  if (graphFilePath && normalizedHaystack.includes(graphFilePath)) return true;
  const graphId = text(normalizedMarker.graphId).toLowerCase();
  if (graphId && haystack.includes(graphId)) return true;
  const graphTitle = text(normalizedMarker.graphTitle).toLowerCase();
  return Boolean(
    graphTitle.length >= 8
      && haystack.includes(graphTitle)
      && (haystack.includes("architecture graph") || haystack.includes(".arch")),
  );
}

function architectureFindAgentEditTask(marker, tasks) {
  const commandId = text(marker?.commandId).toLowerCase();
  return jsonArray(tasks)
    .map((task, index) => {
      if (!architectureTaskMatchesAgentEditMarker(task, marker)) return null;
      const haystack = architectureTaskSearchText(task);
      return {
        commandMatch: commandId && haystack.includes(commandId) ? 1 : 0,
        index,
        task,
        updatedMs: taskUpdatedMs(task),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.commandMatch - left.commandMatch
        || right.updatedMs - left.updatedMs
        || right.index - left.index
    ))[0]?.task || null;
}

function architectureGraphUpdatedAfterAgentEditMarker(graph, marker) {
  const graphUpdatedMs = parseTimeMs(graph?.updatedAt || graph?.updated_at);
  const markerCreatedMs = parseTimeMs(marker?.createdAt || marker?.created_at);
  return Boolean(graphUpdatedMs && markerCreatedMs && graphUpdatedMs > markerCreatedMs + 500);
}

function architectureDeriveAgentEditMarker(marker, tasks, graphs) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return null;
  const createdMs = parseTimeMs(normalizedMarker.createdAt);
  if (createdMs && Date.now() - createdMs > ARCHITECTURE_AGENT_EDIT_MARKER_MAX_AGE_MS) {
    return null;
  }
  const task = architectureFindAgentEditTask(normalizedMarker, tasks);
  if (task) {
    const statusKind = taskStatusKind(task);
    if (ARCHITECTURE_AGENT_EDIT_DONE_STATUSES.has(statusKind)) return null;
    const agentId = architectureTaskAgentId(task) || normalizedMarker.agentId;
    const agentLabel = architectureAgentLabel(agentId || normalizedMarker.agentLabel);
    return {
      ...normalizedMarker,
      agentColor: architectureAgentColor(agentId || agentLabel, normalizedMarker.commandId),
      agentId,
      agentLabel,
      status: statusKind === "queued" ? "queued" : "editing",
      taskId: taskPlanTaskId(task, normalizedMarker.taskId),
      updatedAt: taskUpdatedMs(task) ? new Date(taskUpdatedMs(task)).toISOString() : normalizedMarker.updatedAt,
    };
  }
  const graph = jsonArray(graphs).find((candidate) => architectureGraphMatchesAgentEditMarker(candidate, normalizedMarker));
  if (graph && architectureGraphUpdatedAfterAgentEditMarker(graph, normalizedMarker)) {
    return {
      ...normalizedMarker,
      status: "editing",
      updatedAt: text(graph.updatedAt || graph.updated_at, normalizedMarker.updatedAt),
    };
  }
  return normalizedMarker;
}

function architectureVisibleAgentEditMarkers(markers, tasks, graphs) {
  const nextMarkers = [];
  jsonArray(markers).forEach((marker) => {
    const nextMarker = architectureDeriveAgentEditMarker(marker, tasks, graphs);
    if (!nextMarker) return;
    const existingIndex = nextMarkers.findIndex((candidate) => candidate.commandId === nextMarker.commandId);
    if (existingIndex >= 0) {
      nextMarkers[existingIndex] = nextMarker;
      return;
    }
    nextMarkers.push(nextMarker);
  });
  return nextMarkers
    .sort((left, right) => parseTimeMs(left.createdAt) - parseTimeMs(right.createdAt))
    .slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS);
}

function architectureAgentEditMarkerForGraph(graph, markers) {
  return jsonArray(markers)
    .filter((marker) => architectureGraphMatchesAgentEditMarker(graph, marker))
    .sort((left, right) => (
      parseTimeMs(right.updatedAt || right.createdAt) - parseTimeMs(left.updatedAt || left.createdAt)
    ))[0] || null;
}

function architectureAgentEditMarkerBlurb(marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return "";
  const action = normalizedMarker.status === "editing" ? "editing" : "queued edit";
  return `${normalizedMarker.agentLabel} ${action}`;
}

function architectureAgentEditMarkerTitle(marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return "";
  return `${architectureAgentEditMarkerBlurb(normalizedMarker)} for ${normalizedMarker.graphTitle}`;
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
  const activeWorkspaceId = workspace?.id || "";
  const activeWorkspaceName = workspace?.name || "";
  const repoPath = activeWorkspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
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
    if (!repoPath || !activeWorkspaceId) {
      return undefined;
    }

    let cancelled = false;
    let unlistenTaskHistory = null;
    listen("cloud-mcp-task-history-updated", (event) => {
      if (cancelled) return;
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const eventRepoPath = text(payload.repoPath || payload.repo_path);
      const eventWorkspaceId = text(payload.workspaceId || payload.workspace_id);
      if (
        eventWorkspaceId
        && activeWorkspaceId
        && eventWorkspaceId !== activeWorkspaceId
      ) {
        return;
      }
      if (
        eventRepoPath
        && repoPath
        && eventRepoPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
          !== repoPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
      ) {
        return;
      }
      const taskHistory = payload.taskHistory || payload.task_history || payload.data || null;
      if (taskHistory && typeof taskHistory === "object") {
        setLocalArchitectureSnapshot(taskHistory);
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenTaskHistory = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenTaskHistory) {
        unlistenTaskHistory();
      }
    };
  }, [activeWorkspaceId, repoPath]);

  useEffect(() => {
    setFinishedPlanTaskIds(new Set());
    setFinishPlanState({ error: "", taskId: "" });
  }, [repoPath, activeWorkspaceId]);

  const refreshTaskHistorySnapshot = useCallback(() => {
    if (!repoPath || !activeWorkspaceId) {
      return Promise.resolve(null);
    }
    return invoke("cloud_mcp_get_task_history", {
      repoPath,
      workspaceId: activeWorkspaceId,
      workspaceName: activeWorkspaceName,
    }).then((result) => {
      setLocalArchitectureSnapshot(result);
      return result;
    });
  }, [repoPath, activeWorkspaceId, activeWorkspaceName]);

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
        workspace_id: activeWorkspaceId,
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
  }, [refreshTaskHistorySnapshot, repoPath, activeWorkspaceId]);

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
          queueWorkspaceId={activeWorkspaceId}
          queueWorkspaceName={activeWorkspaceName}
          repoLabel={repoLabel}
          repoPath={repoPath}
          tasks={visibleTasks}
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

function ArchitecturesPanel({
  queueWorkspaceId = "",
  queueWorkspaceName = "",
  repoLabel,
  repoPath,
  tasks = [],
}) {
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
  const [draftGraphTemplate, setDraftGraphTemplate] = useState("system");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [agentEditMarkers, setAgentEditMarkers] = useState([]);

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
    }, ARCHITECTURE_GRAPH_LIST_REFRESH_MS);
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
    }, ARCHITECTURE_SELECTED_GRAPH_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [creatingGraph, saveState, selectedGraphId, selectedRepoPath]);

  const selectedRepo = repositories.find((repo) => repo.path === selectedRepoPath) || null;
  const agentEditMarkersStorageKey = useMemo(
    () => architectureAgentEditMarkersStorageKey(queueWorkspaceId, selectedRepoPath || repoPath),
    [queueWorkspaceId, repoPath, selectedRepoPath],
  );
  const visibleAgentEditMarkers = useMemo(
    () => architectureVisibleAgentEditMarkers(agentEditMarkers, tasks, graphs),
    [agentEditMarkers, graphs, tasks],
  );
  const selectedAgentEditMarker = useMemo(
    () => architectureAgentEditMarkerForGraph(selectedGraph, visibleAgentEditMarkers),
    [selectedGraph, visibleAgentEditMarkers],
  );
  const isLoading = repoState === "loading" || graphState === "loading";
  const singleRepository = repositories.length <= 1;
  const treeRows = useMemo(() => architectureGraphTreeRows(graphs, singleRepository ? 0 : 1), [graphs, singleRepository]);
  const folderSuggestions = useMemo(() => (
    [...new Set(graphs.map((graph) => architectureFolderPathText(graph.groupPath)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
  ), [graphs]);

  useEffect(() => {
    if (!agentEditMarkersStorageKey) {
      setAgentEditMarkers([]);
      return;
    }
    setAgentEditMarkers(architectureReadStoredAgentEditMarkers(agentEditMarkersStorageKey));
  }, [agentEditMarkersStorageKey]);

  useEffect(() => {
    if (!agentEditMarkersStorageKey) return;
    if (architectureAgentEditMarkersEqual(agentEditMarkers, visibleAgentEditMarkers)) return;
    setAgentEditMarkers(visibleAgentEditMarkers);
    architectureWriteStoredAgentEditMarkers(agentEditMarkersStorageKey, visibleAgentEditMarkers);
  }, [agentEditMarkers, agentEditMarkersStorageKey, visibleAgentEditMarkers]);

  const recordAgentEditQueued = useCallback((queuedItem) => {
    const marker = architectureAgentEditMarkerFromQueueItem(queuedItem);
    if (!marker) return;
    setAgentEditMarkers((currentMarkers) => {
      const currentVisibleMarkers = architectureVisibleAgentEditMarkers(currentMarkers, tasks, graphs);
      const nextMarkers = currentVisibleMarkers
        .filter((candidate) => (
          candidate.commandId !== marker.commandId
            && !architectureAgentEditMarkersGraphMatch(candidate, marker)
        ))
        .concat([marker])
        .slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS);
      architectureWriteStoredAgentEditMarkers(agentEditMarkersStorageKey, nextMarkers);
      return nextMarkers;
    });
  }, [agentEditMarkersStorageKey, graphs, tasks]);

  const beginCreateGraph = useCallback((folderPath = "") => {
    const nextFolderPath = text(folderPath);
    setDraftTitle("Architecture graph");
    setDraftGraphTemplate("system");
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
      template: draftGraphTemplate,
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
        setDraftGraphTemplate("system");
        setDraftLocationMode("root");
        setDraftFolderPath("");
        setSaveState("idle");
        void loadGraphList(selectedRepoPath);
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to create architecture graph."));
      });
  }, [draftFolderPath, draftGraphTemplate, draftLocationMode, draftTitle, loadGraphList, selectedRepoPath]);

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
      {treeRows.map((row) => {
        if (row.kind === "folder") {
          return (
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
          );
        }

        const rowMarker = architectureAgentEditMarkerForGraph(row.graph, visibleAgentEditMarkers);
        const rowMarkerTitle = architectureAgentEditMarkerTitle(rowMarker);
        return (
          <ArchitectureTreeRow
            data-active={row.graph.id === selectedGraphId && !creatingGraph ? "true" : "false"}
            data-agent-edit={rowMarker ? rowMarker.status : undefined}
            data-kind="graph"
            key={`graph-${row.graph.id}`}
            onClick={() => {
              setSelectedGraphId(row.graph.id);
              setCreatingGraph(false);
            }}
            style={{ "--tree-depth": row.depth }}
            title={[row.graph.filePath, rowMarkerTitle].filter(Boolean).join("\n")}
            type="button"
          >
            <ArchitectureTreeGlyph data-kind="graph" aria-hidden="true" />
            <span>{row.graph.title}</span>
            {rowMarker && (
              <ArchitectureTreeAgentMarker
                aria-hidden="true"
                style={{ "--agent-edit-color": rowMarker.agentColor }}
                title={rowMarkerTitle}
              >
                <i />
                <strong>{rowMarker.status === "editing" ? "editing" : "queued"}</strong>
              </ArchitectureTreeAgentMarker>
            )}
            <em>{row.graph.nodeCount}</em>
          </ArchitectureTreeRow>
        );
      })}
      {graphState === "ready" && !graphs.length && (
        <ArchitectureTreeEmpty style={{ "--tree-depth": emptyDepth }}>No graphs yet</ArchitectureTreeEmpty>
      )}
    </>
  ), [
    beginCreateGraph,
    creatingGraph,
    graphState,
    graphs.length,
    selectedGraphId,
    treeRows,
    visibleAgentEditMarkers,
  ]);

  return (
    <ArchitecturesShell data-nav-collapsed={navCollapsed ? "true" : "false"}>
      {!navCollapsed && (
        <ArchitectureNavRail aria-label="Architecture repositories">
          <ArchitectureNavHeader>
            <strong>Architectures</strong>
            <ArchitectureNavHeaderActions>
              <ArchitectureCreateGraphButton
                aria-label="Create architecture graph"
                disabled={!selectedRepoPath || saveState === "saving"}
                onClick={() => beginCreateGraph()}
                title="Create architecture graph"
                type="button"
              >
                <Add aria-hidden="true" />
              </ArchitectureCreateGraphButton>
              <ArchitectureNavToggleButton
                aria-label="Hide architecture navigation"
                onClick={() => setNavCollapsed(true)}
                title="Hide architecture navigation"
                type="button"
              >
                &lt;&lt;
              </ArchitectureNavToggleButton>
            </ArchitectureNavHeaderActions>
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
      )}

      <ArchitectureEditorRegion>
        {error && <ArchitectureError>{error}</ArchitectureError>}
        <ArchitectureEditorContent>
          {navCollapsed && (
            <ArchitectureRestoreNavButton
              aria-label="Show architecture navigation"
              onClick={() => setNavCollapsed(false)}
              title="Show architecture navigation"
              type="button"
            >
              &gt;&gt;
            </ArchitectureRestoreNavButton>
          )}
          {creatingGraph || !selectedGraph ? (
            <ArchitectureCreateSurface
              canCancel={creatingGraph && Boolean(selectedGraph)}
              draftFolderPath={draftFolderPath}
              draftGraphTemplate={draftGraphTemplate}
              draftLocationMode={draftLocationMode}
              draftTitle={draftTitle}
              folderSuggestions={folderSuggestions}
              graphCount={graphs.length}
              isLoading={isLoading}
              onCancel={() => setCreatingGraph(false)}
              onCreate={createGraph}
              onDraftFolderPathChange={setDraftFolderPath}
              onDraftGraphTemplateChange={setDraftGraphTemplate}
              onDraftLocationModeChange={setDraftLocationMode}
              onDraftTitleChange={setDraftTitle}
              repoLabel={repoLabel}
              saveState={saveState}
              selectedRepo={selectedRepo}
            />
          ) : (
            <ArchitectureGraphEditor
              agentEditMarker={selectedAgentEditMarker}
              graph={selectedGraph}
              onAgentEditQueued={recordAgentEditQueued}
              onSave={saveGraph}
              queueWorkspaceId={queueWorkspaceId}
              queueWorkspaceName={queueWorkspaceName}
              saveState={saveState}
              selectedRepo={selectedRepo}
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
  draftGraphTemplate,
  draftLocationMode,
  draftTitle,
  folderSuggestions,
  graphCount,
  isLoading,
  onCancel,
  onCreate,
  onDraftFolderPathChange,
  onDraftGraphTemplateChange,
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
          <span>Starter</span>
          <ArchitectureSelect
            onChange={(event) => onDraftGraphTemplateChange(event.target.value)}
            value={draftGraphTemplate}
          >
            {ARCHITECTURE_GRAPH_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </ArchitectureSelect>
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

function ArchitectureGraphEditor({
  agentEditMarker = null,
  graph,
  onAgentEditQueued = () => {},
  onSave,
  queueWorkspaceId = "",
  queueWorkspaceName = "",
  saveState,
  selectedRepo,
}) {
  const initialFlow = useMemo(() => architectureGraphToFlow(graph), [graph]);
  const [nodes, setNodes, handleNodesChange] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, handleEdgesChange] = useEdgesState(initialFlow.edges);
  const [draftGraph, setDraftGraph] = useState(() => jsonObject(graph) || {});
  const [agentCommandDraft, setAgentCommandDraft] = useState("");
  const [agentCommandNotice, setAgentCommandNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [localError, setLocalError] = useState("");
  const [routingMode, setRoutingMode] = useState("settled");
  const routeCacheRef = useRef(new Map());
  const routeSettleTimerRef = useRef(null);
  const renderNodes = useMemo(() => architectureOrderFlowNodes(nodes), [nodes]);
  const renderEdges = useMemo(() => architectureEdgesWithRoutingData(edges, renderNodes, {
    interactive: routingMode === "interactive",
    routeCache: routeCacheRef.current,
  }), [edges, renderNodes, routingMode]);
  const semanticWarnings = useMemo(
    () => architectureValidateSemanticGraph(draftGraph, nodes, edges),
    [draftGraph, edges, nodes],
  );

  useEffect(() => {
    const nextFlow = architectureGraphToFlow(graph);
    routeCacheRef.current.clear();
    if (routeSettleTimerRef.current) {
      clearTimeout(routeSettleTimerRef.current);
      routeSettleTimerRef.current = null;
    }
    setRoutingMode("settled");
    setNodes(nextFlow.nodes);
    setEdges(nextFlow.edges);
    setDraftGraph(jsonObject(graph) || {});
    setSelectedNodes([]);
    setSelectedEdges([]);
    setDirty(false);
    setLocalError("");
    setAgentCommandDraft("");
    setAgentCommandNotice("");
  }, [graph, setEdges, setNodes]);

  useEffect(() => () => {
    if (routeSettleTimerRef.current) clearTimeout(routeSettleTimerRef.current);
  }, []);

  const onNodesChange = useCallback((changes) => {
    if (changes.some((change) => change.type !== "select")) setDirty(true);
    handleNodesChange(changes);
  }, [handleNodesChange]);

  const onEdgesChange = useCallback((changes) => {
    if (changes.some((change) => change.type !== "select")) setDirty(true);
    handleEdgesChange(changes);
  }, [handleEdgesChange]);

  const beginInteractiveRouting = useCallback(() => {
    if (routeSettleTimerRef.current) {
      clearTimeout(routeSettleTimerRef.current);
      routeSettleTimerRef.current = null;
    }
    setRoutingMode("interactive");
  }, []);

  const settleFullRouting = useCallback(() => {
    if (routeSettleTimerRef.current) clearTimeout(routeSettleTimerRef.current);
    routeSettleTimerRef.current = setTimeout(() => {
      routeSettleTimerRef.current = null;
      setRoutingMode("settled");
    }, ARCHITECTURE_ROUTE_SETTLE_DELAY_MS);
  }, []);

  const onConnect = useCallback((connection) => {
    const id = architectureEntityId("edge");
    setDirty(true);
    setEdges((currentEdges) => addReactFlowEdge({
      ...connection,
      id,
      zIndex: 0,
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
    const selectedGroup = selectedNodes.find((node) => node.type === "architectureGroup")
      || null;
    const count = nodes.filter((node) => node.type === "architectureGroup").length;
    const childSize = { height: 300, width: 460 };
    const childPosition = selectedGroup?.id
      ? { x: 58 + (count % 2) * 58, y: 98 + Math.floor(count / 2) * 48 }
      : { x: 120 + count * 34, y: 90 + count * 28 };
    setNodes((currentNodes) => {
      const expandedNodes = selectedGroup?.id
        ? architectureExpandParentNodesForChild(currentNodes, selectedGroup.id, childPosition, childSize)
        : currentNodes;
      return [
        ...expandedNodes,
        {
          id: architectureEntityId("group"),
          type: "architectureGroup",
          parentId: selectedGroup?.id,
          extent: selectedGroup?.id ? "parent" : undefined,
          position: childPosition,
          style: childSize,
          data: {
            icon: "box",
            kind: "group",
            subtitle: "Drag nodes into this area",
            title: `Group ${count + 1}`,
          },
        },
      ];
    });
    setDirty(true);
  }, [nodes, selectedNodes, setNodes]);

  const addSemanticSlice = useCallback((intent) => {
    const slice = architectureCreateSemanticSliceFlow(intent, {
      index: nodes.filter((node) => node.type === "architectureGroup").length,
    });
    setNodes((currentNodes) => [...currentNodes, ...slice.nodes]);
    setEdges((currentEdges) => [...currentEdges, ...slice.edges]);
    setDirty(true);
  }, [nodes, setEdges, setNodes]);

  const addNode = useCallback(() => {
    const selectedGroup = selectedNodes.find((node) => node.type === "architectureGroup")
      || null;
    const nodeCount = nodes.filter((node) => node.type !== "architectureGroup").length;
    const childSize = { height: 76, width: 184 };
    const childPosition = selectedGroup?.id
      ? { x: 58 + (nodeCount % 2) * 220, y: 98 + Math.floor(nodeCount / 2) * 116 }
      : { x: 140 + (nodeCount % 3) * 220, y: 130 + Math.floor(nodeCount / 3) * 128 };
    setNodes((currentNodes) => {
      const expandedNodes = selectedGroup?.id
        ? architectureExpandParentNodesForChild(currentNodes, selectedGroup.id, childPosition, childSize)
        : currentNodes;
      return [
        ...expandedNodes,
        {
          id: architectureEntityId("node"),
          type: "architectureNode",
          parentId: selectedGroup?.id,
          extent: selectedGroup?.id ? "parent" : undefined,
          position: childPosition,
          data: {
            icon: "server",
            kind: "service",
            subtitle: "",
            title: `Node ${nodeCount + 1}`,
          },
        },
      ];
    });
    setDirty(true);
  }, [nodes, selectedNodes, setNodes]);

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
        zIndex: 0,
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
    let expanded = true;
    while (expanded) {
      expanded = false;
      nodes.forEach((node) => {
        if (!nodeIds.has(node.id) && nodeIds.has(node.parentId)) {
          nodeIds.add(node.id);
          expanded = true;
        }
      });
    }
    setNodes((currentNodes) => currentNodes.filter((node) => !nodeIds.has(node.id)));
    setEdges((currentEdges) => currentEdges.filter((edge) => (
      !edgeIds.has(edge.id)
      && !nodeIds.has(edge.source)
      && !nodeIds.has(edge.target)
    )));
    setSelectedNodes([]);
    setSelectedEdges([]);
    setDirty(true);
  }, [nodes, selectedEdges, selectedNodes, setEdges, setNodes]);

  const save = useCallback(() => {
    const nextGraph = architectureGraphFromFlow(draftGraph, nodes, edges);
    setLocalError("");
    onSave(nextGraph)
      .then(() => setDirty(false))
      .catch((nextError) => {
        setLocalError(nextError?.message || String(nextError || "Unable to save graph."));
      });
  }, [draftGraph, edges, nodes, onSave]);

  const queueArchitectureAgentCommand = useCallback((event) => {
    event.preventDefault();
    const prompt = text(agentCommandDraft);
    if (!prompt) return;
    if (!queueWorkspaceId) {
      setLocalError("Open a workspace before queueing an architecture task.");
      return;
    }
    const queuedItem = architectureQueueAgentTodo({
      graph: draftGraph,
      prompt,
      repoPath: selectedRepo?.path || "",
      workspaceId: queueWorkspaceId,
      workspaceName: queueWorkspaceName,
    });
    setAgentCommandDraft("");
    setAgentCommandNotice(queuedItem ? "Queued for coding agents" : "Queued locally");
    if (queuedItem) onAgentEditQueued(queuedItem);
    setLocalError("");
  }, [agentCommandDraft, draftGraph, onAgentEditQueued, selectedRepo?.path, queueWorkspaceId, queueWorkspaceName]);
  const agentCommandReady = Boolean(text(agentCommandDraft));
  const agentCommandStatus = localError || agentCommandNotice || (dirty ? "Unsaved changes" : "Press Enter to queue");
  const agentEditBlurb = architectureAgentEditMarkerBlurb(agentEditMarker);
  const agentEditTitle = architectureAgentEditMarkerTitle(agentEditMarker);

  return (
    <ArchitectureEditorShell>
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
              zIndex: 0,
            }}
            edgeTypes={architectureEdgeTypes}
            edges={renderEdges}
            fitView
            maxZoom={1.7}
            minZoom={0.18}
            nodeTypes={architectureNodeTypes}
            nodes={renderNodes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={beginInteractiveRouting}
            onNodeDragStop={settleFullRouting}
            onNodesChange={onNodesChange}
            onSelectionChange={({ nodes: nextNodes, edges: nextEdges }) => {
              setSelectedNodes(nextNodes);
              setSelectedEdges(nextEdges);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(148, 163, 184, 0.22)" gap={22} size={1} />
          </ReactFlow>
          {agentEditMarker && (
            <ArchitectureAgentEditStatus
              aria-live="polite"
              role="status"
              style={{ "--agent-edit-color": agentEditMarker.agentColor }}
              title={agentEditTitle}
            >
              <i aria-hidden="true" />
              <span>{agentEditBlurb}</span>
            </ArchitectureAgentEditStatus>
          )}
          <ArchitectureSliceToolbar
            aria-label="Add architecture slice"
            data-has-agent-marker={agentEditMarker ? "true" : "false"}
          >
            {["api-pathway", "data-flow", "control-graph", "state-machine", "dependency-graph", "deployment"].map((intent) => (
              <ArchitectureSliceButton
                key={intent}
                onClick={() => addSemanticSlice(intent)}
                title={`Add ${architectureGroupIntentLabel(intent)}`}
                type="button"
              >
                {architectureGroupIntentLabel(intent)}
              </ArchitectureSliceButton>
            ))}
          </ArchitectureSliceToolbar>
          {semanticWarnings.length > 0 && (
            <ArchitectureValidationPanel title="Semantic graph warnings">
              <strong>{semanticWarnings.length} warning{semanticWarnings.length === 1 ? "" : "s"}</strong>
              {semanticWarnings.slice(0, 4).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </ArchitectureValidationPanel>
          )}
          <ArchitectureFloatingActions>
            <ArchitectureFloatingDangerButton
              disabled={!selectedNodes.length && !selectedEdges.length}
              onClick={deleteSelected}
              type="button"
            >
              Delete
            </ArchitectureFloatingDangerButton>
            <ArchitectureFloatingPrimaryButton
              disabled={!dirty || saveState === "saving"}
              onClick={save}
              type="button"
            >
              {saveState === "saving" ? "Saving..." : dirty ? "Save" : "Saved"}
            </ArchitectureFloatingPrimaryButton>
          </ArchitectureFloatingActions>
          <ArchitectureAgentCommandForm
            aria-label={agentCommandStatus}
            data-state={localError ? "error" : agentCommandNotice ? "notice" : dirty ? "dirty" : "idle"}
            onSubmit={queueArchitectureAgentCommand}
            title={agentCommandStatus}
          >
            <ArchitectureAgentCommandInput
              aria-label="Queue architecture task"
              onChange={(event) => {
                setAgentCommandDraft(event.target.value);
                if (agentCommandNotice) setAgentCommandNotice("");
              }}
              placeholder="Ask a coding agent to update this architecture graph..."
              value={agentCommandDraft}
            />
            <ArchitectureAgentCommandSubmitButton
              aria-label="Queue architecture task"
              data-ready={agentCommandReady ? "true" : undefined}
              disabled={!agentCommandReady}
              type="submit"
            >
              <ArchitectureAgentCommandSubmitIcon aria-hidden="true" />
            </ArchitectureAgentCommandSubmitButton>
          </ArchitectureAgentCommandForm>
        </ArchitectureCanvasViewport>
      </ArchitectureEditorBody>
    </ArchitectureEditorShell>
  );
}

function ArchitectureCanvasNode({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, data?.kind, data?.title);
  const IconComponent = icon.Icon;
  const direction = text(data?.flowDirection, "LR").toUpperCase();
  const display = architectureNodeDisplayMode(data || {});
  const compact = display === "compact";
  const role = architectureNodeRole(data?.role || data?.kind);
  const lifecycle = architectureSemanticSlug(data?.lifecycle);
  return (
    <ArchitectureCanvasNodeShell
      data-display={display}
      data-kind={text(data?.kind, "service")}
      data-lifecycle={lifecycle}
      data-role={role}
      data-selected={selected ? "true" : "false"}
    >
      <Handle position={architectureTargetHandlePosition(direction)} type="target" />
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
        {!compact && <span>{text(data?.subtitle, role.replace(/[-_]+/gu, " "))}</span>}
      </ArchitectureNodeText>
      <Handle position={architectureSourceHandlePosition(direction)} type="source" />
    </ArchitectureCanvasNodeShell>
  );
}

function ArchitectureCanvasGroup({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, "group", data?.title);
  const IconComponent = icon.Icon;
  const direction = text(data?.flowDirection, "LR").toUpperCase();
  const intent = architectureGroupIntent(data?.intent);
  return (
    <ArchitectureCanvasGroupShell data-intent={intent} data-selected={selected ? "true" : "false"}>
      <Handle position={architectureTargetHandlePosition(direction)} type="target" />
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
          <span>{text(data?.subtitle, architectureGroupIntentLabel(intent))}</span>
        </ArchitectureGroupText>
      </ArchitectureGroupHeader>
      <Handle position={architectureSourceHandlePosition(direction)} type="source" />
    </ArchitectureCanvasGroupShell>
  );
}

function architectureOrderFlowNodes(nodes) {
  const nodeList = jsonArray(nodes);
  const byId = new Map(nodeList.map((node) => [node.id, node]));
  const orderById = new Map(nodeList.map((node, index) => [node.id, index]));
  const childrenByParent = new Map();
  nodeList.forEach((node) => {
    const parentId = text(node?.parentId);
    const safeParentId = parentId && byId.has(parentId) ? parentId : "";
    if (!childrenByParent.has(safeParentId)) childrenByParent.set(safeParentId, []);
    childrenByParent.get(safeParentId).push(node);
  });

  const ordered = [];
  const seen = new Set();
  const visitChildren = (parentId) => {
    const children = [...(childrenByParent.get(parentId) || [])].sort((left, right) => {
      const leftGroup = left.type === "architectureGroup" ? 0 : 1;
      const rightGroup = right.type === "architectureGroup" ? 0 : 1;
      return leftGroup - rightGroup
        || (orderById.get(left.id) || 0) - (orderById.get(right.id) || 0);
    });
    children.forEach((child) => {
      if (seen.has(child.id)) return;
      seen.add(child.id);
      ordered.push(child);
      visitChildren(child.id);
    });
  };

  visitChildren("");
  nodeList.forEach((node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
  });
  return ordered;
}

function architectureNodeSize(node) {
  const isGroup = node?.type === "architectureGroup";
  const compact = !isGroup && architectureIsCompactNode(node?.data || {});
  return {
    height: numberValue(
      node?.style?.height,
      isGroup ? 280 : compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : ARCHITECTURE_NODE_CARD_HEIGHT,
    ),
    width: numberValue(
      node?.style?.width,
      isGroup ? 460 : compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : ARCHITECTURE_NODE_CARD_WIDTH,
    ),
  };
}

function architectureAbsoluteNodePosition(node, nodeById, cache) {
  const nodeId = text(node?.id);
  if (!nodeId) return { x: 0, y: 0 };
  if (cache.has(nodeId)) return cache.get(nodeId);
  const parentId = text(node?.parentId);
  const parentPosition = parentId && nodeById.has(parentId)
    ? architectureAbsoluteNodePosition(nodeById.get(parentId), nodeById, cache)
    : { x: 0, y: 0 };
  const position = {
    x: parentPosition.x + numberValue(node?.position?.x, 0),
    y: parentPosition.y + numberValue(node?.position?.y, 0),
  };
  cache.set(nodeId, position);
  return position;
}

function architectureNodeRect(node, nodeById, positionCache) {
  const position = architectureAbsoluteNodePosition(node, nodeById, positionCache);
  const size = architectureNodeSize(node);
  return {
    height: size.height,
    id: node.id,
    width: size.width,
    x: position.x,
    y: position.y,
  };
}

function architectureNodeHandlePoint(node, side, nodeById, positionCache) {
  const rect = architectureNodeRect(node, nodeById, positionCache);
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  if (side === "bottom") return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
}

function architectureEdgeRenderKey(edge, index = 0) {
  return text(edge?.id, `edge-${index}`);
}

function architectureEndpointFanOffset(index, count) {
  if (count <= 1) return 0;
  const offset = Math.round((index - (count - 1) / 2) * 18);
  return Math.max(-90, Math.min(90, offset));
}

function architectureEndpointFanOffsets(edges) {
  const bySource = new Map();
  const byTarget = new Map();
  const offsets = new Map();
  const addToGroup = (groupMap, key, entry) => {
    if (!key) return;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(entry);
  };

  edges.forEach((edge, index) => {
    const key = architectureEdgeRenderKey(edge, index);
    offsets.set(key, { source: 0, target: 0 });
    addToGroup(bySource, text(edge.source), { edge, index, key, sortKey: text(edge.target) });
    addToGroup(byTarget, text(edge.target), { edge, index, key, sortKey: text(edge.source) });
  });

  const assign = (groupMap, offsetKey) => {
    groupMap.forEach((items) => {
      const sorted = [...items].sort((left, right) => (
        left.sortKey.localeCompare(right.sortKey)
          || left.index - right.index
      ));
      sorted.forEach((item, index) => {
        const current = offsets.get(item.key) || { source: 0, target: 0 };
        current[offsetKey] = architectureEndpointFanOffset(index, sorted.length);
        offsets.set(item.key, current);
      });
    });
  };

  assign(bySource, "source");
  assign(byTarget, "target");
  return offsets;
}

function architectureRouteHashString(seed, value) {
  let hash = seed >>> 0;
  const raw = String(value ?? "");
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function architectureRouteHashNumber(seed, value) {
  return architectureRouteHashString(seed, Math.round(numberValue(value, 0)));
}

function architectureRectsRoutingHash(rects) {
  return jsonArray(rects).reduce((hash, rect) => {
    let nextHash = architectureRouteHashString(hash, rect?.id || "");
    nextHash = architectureRouteHashNumber(nextHash, rect?.x);
    nextHash = architectureRouteHashNumber(nextHash, rect?.y);
    nextHash = architectureRouteHashNumber(nextHash, rect?.width);
    nextHash = architectureRouteHashNumber(nextHash, rect?.height);
    return nextHash;
  }, 2166136261);
}

function architectureRouteSegmentsRoutingHash(seed, segments) {
  return jsonArray(segments).reduce((hash, segment) => {
    let nextHash = architectureRouteHashString(hash, segment?.orientation || "");
    nextHash = architectureRouteHashNumber(nextHash, segment?.x ?? segment?.x1);
    nextHash = architectureRouteHashNumber(nextHash, segment?.y ?? segment?.y1);
    nextHash = architectureRouteHashNumber(nextHash, segment?.x2);
    nextHash = architectureRouteHashNumber(nextHash, segment?.y2);
    return nextHash;
  }, seed >>> 0);
}

function architectureRouteCacheGet(routeCache, key) {
  if (!routeCache?.has?.(key)) return null;
  const routePoints = routeCache.get(key);
  routeCache.delete(key);
  routeCache.set(key, routePoints);
  return routePoints;
}

function architectureRouteCacheSet(routeCache, key, routePoints) {
  if (!routeCache?.set) return;
  routeCache.set(key, routePoints);
  while (routeCache.size > ARCHITECTURE_ROUTE_CACHE_MAX) {
    const firstKey = routeCache.keys().next().value;
    if (!firstKey) break;
    routeCache.delete(firstKey);
  }
}

function architectureEdgesWithRoutingData(edges, nodes, options = {}) {
  const interactive = Boolean(options.interactive);
  const routeCache = options.routeCache || null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const positionCache = new Map();
  const nodeRects = nodes
    .filter((node) => node.type !== "architectureGroup")
    .map((node) => architectureNodeRect(node, nodeById, positionCache));
  const groupHeaderRects = nodes
    .filter((node) => node.type === "architectureGroup")
    .map((node) => {
      const rect = architectureNodeRect(node, nodeById, positionCache);
      return {
        ...rect,
        height: 74,
        id: `${node.id}:header`,
      };
    });
  const obstacleRects = [...nodeRects, ...groupHeaderRects];
  const obstacleHash = architectureRectsRoutingHash(obstacleRects);
  const endpointFanOffsets = architectureEndpointFanOffsets(edges);
  const reservedSegments = [];
  let reservedHash = 2166136261;

  const routedEdges = edges.map((edge, index) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const edgeKey = architectureEdgeRenderKey(edge, index);
    const data = {
      ...(edge.data || {}),
      avoidanceRects: obstacleRects,
    };
    if (!sourceNode || !targetNode) {
      return {
        ...edge,
        data,
      };
    }

    const sourceSide = architectureEdgeSide(sourceNode.sourcePosition);
    const targetSide = architectureEdgeSide(targetNode.targetPosition);
    const sourcePoint = architectureNodeHandlePoint(sourceNode, sourceSide, nodeById, positionCache);
    const targetPoint = architectureNodeHandlePoint(targetNode, targetSide, nodeById, positionCache);
    const edgeFan = endpointFanOffsets.get(edgeKey) || { source: 0, target: 0 };
    const routeKey = [
      interactive ? "interactive" : "settled",
      edgeKey,
      edge.source,
      edge.target,
      sourceSide,
      targetSide,
      Math.round(sourcePoint.x),
      Math.round(sourcePoint.y),
      Math.round(targetPoint.x),
      Math.round(targetPoint.y),
      Math.round(edgeFan.source),
      Math.round(edgeFan.target),
      obstacleHash.toString(36),
      reservedHash.toString(36),
    ].join("|");
    let routePoints = architectureRouteCacheGet(routeCache, routeKey);
    if (!routePoints) {
      routePoints = interactive
        ? architecturePreviewEdgePoints({
          sourceFanOffset: edgeFan.source,
          sourcePosition: sourceNode.sourcePosition,
          sourceX: sourcePoint.x,
          sourceY: sourcePoint.y,
          targetFanOffset: edgeFan.target,
          targetPosition: targetNode.targetPosition,
          targetX: targetPoint.x,
          targetY: targetPoint.y,
        })
        : architectureOrthogonalEdgePoints({
          avoidanceRects: obstacleRects,
          edgeIndex: index,
          id: edge.id,
          reservedSegments,
          sourceFanOffset: edgeFan.source,
          sourcePosition: sourceNode.sourcePosition,
          sourceX: sourcePoint.x,
          sourceY: sourcePoint.y,
          targetFanOffset: edgeFan.target,
          targetPosition: targetNode.targetPosition,
          targetX: targetPoint.x,
          targetY: targetPoint.y,
        });
      architectureRouteCacheSet(routeCache, routeKey, routePoints);
    }
    const routeSegments = architectureRouteSegments(routePoints);
    routeSegments.forEach((segment) => {
      reservedSegments.push({ ...segment, edgeId: edgeKey });
    });
    reservedHash = architectureRouteSegmentsRoutingHash(reservedHash, routeSegments);

    return {
      ...edge,
      data: {
        ...data,
        routePoints,
      },
    };
  });
  const allRouteSegments = routedEdges.flatMap((edge, index) => (
    architectureRouteSegments(jsonArray(edge.data?.routePoints)).map((segment) => ({
      ...segment,
      edgeId: architectureEdgeRenderKey(edge, index),
    }))
  ));
  const labelRects = [];
  return routedEdges.map((edge, index) => {
    const edgeKey = architectureEdgeRenderKey(edge, index);
    const label = text(edge.data?.label);
    const ownRouteSegments = allRouteSegments.filter((segment) => segment.edgeId === edgeKey);
    const otherRouteSegments = allRouteSegments.filter((segment) => segment.edgeId !== edgeKey);
    const labelPlacement = label
      ? architectureEdgeLabelPlacement(jsonArray(edge.data?.routePoints), {
        avoidanceRects: [...obstacleRects, ...labelRects],
        label,
        nodeAvoidanceRects: obstacleRects,
        ownRouteSegments,
        routeSegments: otherRouteSegments,
      })
      : null;
    if (labelPlacement) {
      labelRects.push({
        ...architectureLabelRect(
          labelPlacement,
          labelPlacement.width,
          ARCHITECTURE_EDGE_LABEL_HEIGHT,
        ),
        id: `${edgeKey}:label`,
      });
    }
    return {
      ...edge,
      data: {
        ...(edge.data || {}),
        labelAvoidanceSegments: allRouteSegments,
        labelPlacement,
      },
    };
  });
}

function architectureEdgeSide(position) {
  const normalized = String(position || "").toLowerCase();
  if (normalized.includes("left")) return "left";
  if (normalized.includes("right")) return "right";
  if (normalized.includes("top")) return "top";
  if (normalized.includes("bottom")) return "bottom";
  return "right";
}

function architectureEdgeOffsetPoint(x, y, side, distance) {
  if (side === "left") return { x: x - distance, y };
  if (side === "right") return { x: x + distance, y };
  if (side === "top") return { x, y: y - distance };
  if (side === "bottom") return { x, y: y + distance };
  return { x, y };
}

function architectureDedupEdgePoints(points) {
  return jsonArray(points).map((point) => ({
    x: Math.round(numberValue(point?.x, 0)),
    y: Math.round(numberValue(point?.y, 0)),
  })).filter((point, index, cleanPoints) => {
    if (!index) return true;
    const previous = cleanPoints[index - 1];
    return previous.x !== point.x || previous.y !== point.y;
  });
}

function architectureEdgeHashOffset(id) {
  const raw = text(id);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 997;
  }
  return (hash % 5 - 2) * 6;
}

function architectureEdgeLaneOffsets(edgeIndex = 0, hashOffset = 0) {
  const nudge = ((edgeIndex % 3) - 1) * 4 + hashOffset;
  return [0, 28, -28, 56, -56, 84, -84, 112, -112, 140, -140]
    .map((offset) => offset + nudge);
}

function architectureSegmentIntersectsRect(start, end, rect, padding = ARCHITECTURE_ROUTE_NODE_CLEARANCE) {
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  if (Math.round(start.x) === Math.round(end.x)) {
    const x = start.x;
    if (x < left || x > right) return false;
    return Math.max(start.y, end.y) >= top && Math.min(start.y, end.y) <= bottom;
  }
  if (Math.round(start.y) === Math.round(end.y)) {
    const y = start.y;
    if (y < top || y > bottom) return false;
    return Math.max(start.x, end.x) >= left && Math.min(start.x, end.x) <= right;
  }
  return false;
}

function architectureRouteSegment(start, end) {
  const x1 = Math.round(start.x);
  const y1 = Math.round(start.y);
  const x2 = Math.round(end.x);
  const y2 = Math.round(end.y);
  if (x1 === x2 && y1 !== y2) {
    return {
      orientation: "vertical",
      x: x1,
      y1: Math.min(y1, y2),
      y2: Math.max(y1, y2),
    };
  }
  if (y1 === y2 && x1 !== x2) {
    return {
      orientation: "horizontal",
      y: y1,
      x1: Math.min(x1, x2),
      x2: Math.max(x1, x2),
    };
  }
  return null;
}

function architectureRouteSegments(points) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = architectureRouteSegment(points[index - 1], points[index]);
    if (segment) segments.push(segment);
  }
  return segments;
}

function architecturePointInsideRect(point, rect, padding = ARCHITECTURE_ROUTE_NODE_CLEARANCE) {
  const x = Math.round(numberValue(point?.x, 0));
  const y = Math.round(numberValue(point?.y, 0));
  return x >= rect.x - padding
    && x <= rect.x + rect.width + padding
    && y >= rect.y - padding
    && y <= rect.y + rect.height + padding;
}

function architecturePointClearOfRects(point, rects, padding = ARCHITECTURE_ROUTE_NODE_CLEARANCE) {
  return !jsonArray(rects).some((rect) => architecturePointInsideRect(point, rect, padding));
}

function architectureSegmentClearOfRects(start, end, rects, padding = ARCHITECTURE_ROUTE_NODE_CLEARANCE) {
  return !jsonArray(rects).some((rect) => architectureSegmentIntersectsRect(start, end, rect, padding));
}

function architecturePointOnRouteSegment(point, segment) {
  if (!point || !segment) return false;
  const x = Math.round(numberValue(point.x, 0));
  const y = Math.round(numberValue(point.y, 0));
  if (segment.orientation === "vertical") {
    return x === segment.x && y >= segment.y1 && y <= segment.y2;
  }
  if (segment.orientation === "horizontal") {
    return y === segment.y && x >= segment.x1 && x <= segment.x2;
  }
  return false;
}

function architectureRouteSegmentIntersectionPoint(leftStart, leftEnd, rightStart, rightEnd) {
  const left = architectureRouteSegment(leftStart, leftEnd);
  const right = architectureRouteSegment(rightStart, rightEnd);
  if (!left || !right) return null;
  if (left.orientation !== right.orientation) {
    const vertical = left.orientation === "vertical" ? left : right;
    const horizontal = left.orientation === "horizontal" ? left : right;
    const point = { x: vertical.x, y: horizontal.y };
    return architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right)
      ? point
      : null;
  }
  if (left.orientation === "vertical") {
    if (left.x !== right.x) return null;
    const overlapStart = Math.max(left.y1, right.y1);
    const overlapEnd = Math.min(left.y2, right.y2);
    if (overlapEnd <= overlapStart) return null;
    const candidates = [
      { x: left.x, y: overlapStart },
      { x: left.x, y: overlapEnd },
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
    ].filter((point) => architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right));
    return candidates.sort((first, second) => (
      Math.abs(first.y - leftStart.y) - Math.abs(second.y - leftStart.y)
    ))[0] || null;
  }
  if (left.y !== right.y) return null;
  const overlapStart = Math.max(left.x1, right.x1);
  const overlapEnd = Math.min(left.x2, right.x2);
  if (overlapEnd <= overlapStart) return null;
  const candidates = [
    { x: overlapStart, y: left.y },
    { x: overlapEnd, y: left.y },
    leftStart,
    leftEnd,
    rightStart,
    rightEnd,
  ].filter((point) => architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right));
  return candidates.sort((first, second) => (
    Math.abs(first.x - leftStart.x) - Math.abs(second.x - leftStart.x)
  ))[0] || null;
}

function architectureRemoveCollinearEdgePoints(points) {
  const deduped = architectureDedupEdgePoints(points);
  return deduped.filter((point, index) => {
    if (!index || index === deduped.length - 1) return true;
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    const vertical = previous.x === point.x && point.x === next.x;
    const horizontal = previous.y === point.y && point.y === next.y;
    return !vertical && !horizontal;
  });
}

function architecturePruneSelfIntersectingEdgePoints(points) {
  const cleanPoints = architectureRemoveCollinearEdgePoints(points);
  for (let leftIndex = 0; leftIndex < cleanPoints.length - 3; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < cleanPoints.length - 1; rightIndex += 1) {
      const intersection = architectureRouteSegmentIntersectionPoint(
        cleanPoints[leftIndex],
        cleanPoints[leftIndex + 1],
        cleanPoints[rightIndex],
        cleanPoints[rightIndex + 1],
      );
      if (!intersection) continue;
      const leftEndKey = architecturePointKey(cleanPoints[leftIndex + 1]);
      const rightStartKey = architecturePointKey(cleanPoints[rightIndex]);
      const intersectionKey = architecturePointKey(intersection);
      if (rightIndex === leftIndex + 1 && intersectionKey === leftEndKey) continue;
      if (intersectionKey === leftEndKey && intersectionKey === rightStartKey) continue;
      return architectureDedupEdgePoints([
        ...cleanPoints.slice(0, leftIndex + 1),
        intersection,
        ...cleanPoints.slice(rightIndex + 1),
      ]);
    }
  }
  return cleanPoints;
}

function architecturePointsSignature(points) {
  return architectureDedupEdgePoints(points)
    .map((point) => `${point.x},${point.y}`)
    .join("|");
}

function architectureSimplifyEdgePoints(points) {
  let cleanPoints = architectureDedupEdgePoints(points);
  for (let pass = 0; pass < 6; pass += 1) {
    const previousSignature = architecturePointsSignature(cleanPoints);
    cleanPoints = architecturePruneSelfIntersectingEdgePoints(cleanPoints);
    cleanPoints = architectureRemoveCollinearEdgePoints(cleanPoints);
    if (architecturePointsSignature(cleanPoints) === previousSignature) break;
  }
  return cleanPoints;
}

function architectureSegmentOverlapLength(left, right) {
  if (!left || !right || left.orientation !== right.orientation) return 0;
  if (left.orientation === "vertical") {
    if (Math.abs(left.x - right.x) > 1) return 0;
    return Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  }
  if (Math.abs(left.y - right.y) > 1) return 0;
  return Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
}

function architectureSegmentsCross(left, right, epsilon = ARCHITECTURE_ROUTE_CROSSING_EPSILON) {
  if (!left || !right || left.orientation === right.orientation) return false;
  const vertical = left.orientation === "vertical" ? left : right;
  const horizontal = left.orientation === "horizontal" ? left : right;
  return vertical.x > horizontal.x1 + epsilon
    && vertical.x < horizontal.x2 - epsilon
    && horizontal.y > vertical.y1 + epsilon
    && horizontal.y < vertical.y2 - epsilon;
}

function architectureSegmentCloseOverlap(left, right, spacing = ARCHITECTURE_ROUTE_EDGE_CLEARANCE) {
  if (!left || !right || left.orientation !== right.orientation) {
    return { distance: Infinity, overlap: 0 };
  }
  if (left.orientation === "vertical") {
    const distance = Math.abs(left.x - right.x);
    if (distance > spacing) return { distance, overlap: 0 };
    return {
      distance,
      overlap: Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1)),
    };
  }
  const distance = Math.abs(left.y - right.y);
  if (distance > spacing) return { distance, overlap: 0 };
  return {
    distance,
    overlap: Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1)),
  };
}

function architectureRouteSegmentTooCloseToReserved(segment, reservedSegment, spacing = ARCHITECTURE_ROUTE_EDGE_CLEARANCE) {
  const closeOverlap = architectureSegmentCloseOverlap(segment, reservedSegment, spacing);
  return closeOverlap.overlap > 0;
}

function architectureRouteSegmentClearOfReserved(start, end, reservedSegments, spacing = ARCHITECTURE_ROUTE_EDGE_CLEARANCE) {
  const segment = architectureRouteSegment(start, end);
  if (!segment) return true;
  return !jsonArray(reservedSegments).some((reservedSegment) => (
    architectureRouteSegmentTooCloseToReserved(segment, reservedSegment, spacing)
    || architectureSegmentsCross(segment, reservedSegment)
  ));
}

function architectureRouteConflictPenalty(points, reservedSegments) {
  const segments = architectureRouteSegments(points);
  let penalty = 0;
  segments.forEach((segment, index) => {
    const nearEndpoint = index < 2 || index > segments.length - 3;
    reservedSegments.forEach((reservedSegment) => {
      const overlap = architectureSegmentOverlapLength(segment, reservedSegment);
      if (overlap > 0) {
        penalty += (nearEndpoint ? 4500 : 18000) + overlap * 180;
      } else {
        const closeOverlap = architectureSegmentCloseOverlap(segment, reservedSegment);
        if (closeOverlap.overlap > 0) {
          const closeness = Math.max(1, ARCHITECTURE_ROUTE_EDGE_CLEARANCE - closeOverlap.distance + 1);
          penalty += (nearEndpoint ? 1800 : 9000) + closeOverlap.overlap * closeness * 18;
        }
      }
      if (architectureSegmentsCross(segment, reservedSegment)) {
        penalty += nearEndpoint ? 4500 : 32000;
      }
    });
  });
  return penalty;
}

function architectureEdgePathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x)
      + Math.abs(points[index].y - points[index - 1].y);
  }
  return length;
}

function architectureEndpointBacktrackPenalty(points, sourceSide, targetSide, sourceX, targetX, sourceY, targetY) {
  const second = points[2] || points[1] || points[0];
  const beforeTarget = points.at(-3) || points.at(-2) || points.at(-1);
  let penalty = 0;
  if (sourceSide === "right" && second.x < sourceX) penalty += 2400;
  if (sourceSide === "left" && second.x > sourceX) penalty += 2400;
  if (sourceSide === "bottom" && second.y < sourceY) penalty += 2400;
  if (sourceSide === "top" && second.y > sourceY) penalty += 2400;
  if (targetSide === "left" && beforeTarget.x > targetX) penalty += 1600;
  if (targetSide === "right" && beforeTarget.x < targetX) penalty += 1600;
  if (targetSide === "top" && beforeTarget.y > targetY) penalty += 1600;
  if (targetSide === "bottom" && beforeTarget.y < targetY) penalty += 1600;
  return penalty;
}

function architectureScoreEdgePoints(
  points,
  rects,
  sourceSide,
  targetSide,
  sourceX,
  targetX,
  sourceY,
  targetY,
  reservedSegments = [],
) {
  let collisions = 0;
  for (let index = 1; index < points.length; index += 1) {
    rects.forEach((rect) => {
      if (architectureSegmentIntersectsRect(points[index - 1], points[index], rect)) {
        collisions += 1;
      }
    });
  }
  return collisions * 10000
    + architectureRouteConflictPenalty(points, reservedSegments)
    + architectureEndpointBacktrackPenalty(points, sourceSide, targetSide, sourceX, targetX, sourceY, targetY)
    + architectureEdgePathLength(points);
}

function architectureEdgeBounds(sourceX, sourceY, targetX, targetY, rects) {
  const xs = [sourceX, targetX];
  const ys = [sourceY, targetY];
  rects.forEach((rect) => {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  });
  return {
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
  };
}

function architectureEdgeFanPoint(point, side, fanOffset) {
  if (side === "left" || side === "right") {
    return { x: point.x, y: point.y + fanOffset };
  }
  if (side === "top" || side === "bottom") {
    return { x: point.x + fanOffset, y: point.y };
  }
  return point;
}

function architectureSourceRoutePoints(x, y, side, fanOffset, stubDistance) {
  const start = { x, y };
  const portStub = architectureEdgeOffsetPoint(x, y, side, 12);
  const fanPoint = architectureEdgeFanPoint(portStub, side, fanOffset);
  const stub = architectureEdgeOffsetPoint(fanPoint.x, fanPoint.y, side, stubDistance);
  return {
    points: [start, portStub, fanPoint, stub],
    stub,
  };
}

function architectureTargetRoutePoints(x, y, side, fanOffset, stubDistance) {
  const end = { x, y };
  const portStub = architectureEdgeOffsetPoint(x, y, side, 12);
  const fanPoint = architectureEdgeFanPoint(portStub, side, fanOffset);
  const stub = architectureEdgeOffsetPoint(fanPoint.x, fanPoint.y, side, stubDistance);
  return {
    points: [stub, fanPoint, portStub, end],
    stub,
  };
}

function architecturePreviewEdgePoints({
  sourceFanOffset = 0,
  sourcePosition,
  sourceX,
  sourceY,
  targetFanOffset = 0,
  targetPosition,
  targetX,
  targetY,
}) {
  const sourceSide = architectureEdgeSide(sourcePosition);
  const targetSide = architectureEdgeSide(targetPosition);
  const sourceRoute = architectureSourceRoutePoints(
    sourceX,
    sourceY,
    sourceSide,
    sourceFanOffset,
    ARCHITECTURE_ROUTE_INTERACTIVE_STUB,
  );
  const targetRoute = architectureTargetRoutePoints(
    targetX,
    targetY,
    targetSide,
    targetFanOffset,
    ARCHITECTURE_ROUTE_INTERACTIVE_STUB,
  );
  const sourceStub = sourceRoute.stub;
  const targetStub = targetRoute.stub;
  const horizontal = sourceSide === "left"
    || sourceSide === "right"
    || targetSide === "left"
    || targetSide === "right";
  const middlePoints = horizontal
    ? [
      { x: Math.round((sourceStub.x + targetStub.x) / 2), y: sourceStub.y },
      { x: Math.round((sourceStub.x + targetStub.x) / 2), y: targetStub.y },
    ]
    : [
      { x: sourceStub.x, y: Math.round((sourceStub.y + targetStub.y) / 2) },
      { x: targetStub.x, y: Math.round((sourceStub.y + targetStub.y) / 2) },
    ];

  return architectureSimplifyEdgePoints([
    ...sourceRoute.points,
    ...middlePoints,
    ...targetRoute.points,
  ]);
}

function architectureLaneValues(values) {
  return [...new Set(values.map((value) => Math.round(numberValue(value, 0))))]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
}

function architecturePointKey(point) {
  return `${Math.round(numberValue(point?.x, 0))},${Math.round(numberValue(point?.y, 0))}`;
}

function architectureGridRouteBounds(sourceStub, targetStub, rects, bendOffset = 0) {
  const bounds = architectureEdgeBounds(sourceStub.x, sourceStub.y, targetStub.x, targetStub.y, rects);
  const outside = 154 + Math.abs(bendOffset);
  return {
    bottom: bounds.bottom + outside,
    left: bounds.left - outside,
    right: bounds.right + outside,
    top: bounds.top - outside,
  };
}

function architectureGridSpacingForBounds(bounds) {
  let spacing = ARCHITECTURE_ROUTE_GRID_CELL;
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  while (
    Math.ceil(width / spacing) * Math.ceil(height / spacing) > ARCHITECTURE_ROUTE_GRID_MAX_POINTS
    && spacing < 96
  ) {
    spacing += 8;
  }
  return spacing;
}

function architectureRegularAxisValues(min, max, spacing) {
  const values = [];
  const start = Math.floor(min / spacing) * spacing;
  for (let value = start; value <= max + spacing; value += spacing) {
    if (value >= min && value <= max) values.push(value);
  }
  return values;
}

function architectureGridRouteLanes(sourceStub, targetStub, rects, edgeIndex = 0, bendOffset = 0) {
  const bounds = architectureGridRouteBounds(sourceStub, targetStub, rects, bendOffset);
  const spacing = architectureGridSpacingForBounds(bounds);
  const lanePads = [
    ARCHITECTURE_ROUTE_NODE_CLEARANCE + 8,
    ARCHITECTURE_ROUTE_NODE_CLEARANCE + spacing + 8,
    ARCHITECTURE_ROUTE_NODE_CLEARANCE + spacing * 2 + 8,
  ];
  const xValues = [
    sourceStub.x,
    targetStub.x,
    bounds.left,
    bounds.right,
    (sourceStub.x + targetStub.x) / 2,
    ...architectureRegularAxisValues(bounds.left, bounds.right, spacing),
  ];
  const yValues = [
    sourceStub.y,
    targetStub.y,
    bounds.top,
    bounds.bottom,
    (sourceStub.y + targetStub.y) / 2,
    ...architectureRegularAxisValues(bounds.top, bounds.bottom, spacing),
  ];
  const nudges = architectureEdgeLaneOffsets(edgeIndex, bendOffset).slice(0, 5);
  rects.forEach((rect) => {
    lanePads.forEach((lanePad) => {
      xValues.push(rect.x - lanePad, rect.x + rect.width + lanePad);
      yValues.push(rect.y - lanePad, rect.y + rect.height + lanePad);
    });
  });
  nudges.forEach((nudge) => {
    xValues.push(sourceStub.x + nudge, targetStub.x + nudge);
    yValues.push(sourceStub.y + nudge, targetStub.y + nudge);
  });
  return {
    xValues: architectureLaneValues(xValues),
    yValues: architectureLaneValues(yValues),
  };
}

function architectureSegmentDirection(segment) {
  if (!segment) return "";
  return segment.orientation;
}

function architectureNeighborRouteCost(current, neighbor, currentDirection, reservedSegments) {
  const segment = architectureRouteSegment(current, neighbor);
  const length = Math.abs(neighbor.x - current.x) + Math.abs(neighbor.y - current.y);
  const nextDirection = architectureSegmentDirection(segment);
  let cost = length || 1;
  if (currentDirection && nextDirection && currentDirection !== nextDirection) {
    cost += 34;
  }
  cost += architectureRouteConflictPenalty([current, neighbor], reservedSegments);
  return cost;
}

function architectureRouteHeuristic(point, target) {
  return Math.abs(target.x - point.x) + Math.abs(target.y - point.y);
}

function architectureRouteStateKey(pointKey, direction = "") {
  return `${pointKey}|${direction || "start"}`;
}

function architecturePointKeyFromRouteStateKey(stateKey) {
  return String(stateKey || "").split("|")[0] || "";
}

function architectureDirectionFromRouteStateKey(stateKey) {
  const direction = String(stateKey || "").split("|")[1] || "";
  return direction === "start" ? "" : direction;
}

function architectureRouteHeapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex].priority <= item.priority) break;
    heap[index] = heap[parentIndex];
    index = parentIndex;
  }
  heap[index] = item;
}

function architectureRouteHeapPop(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= heap.length) break;
      const childIndex = rightIndex < heap.length && heap[rightIndex].priority < heap[leftIndex].priority
        ? rightIndex
        : leftIndex;
      if (heap[childIndex].priority >= last.priority) break;
      heap[index] = heap[childIndex];
      index = childIndex;
    }
    heap[index] = last;
  }
  return first;
}

function architectureGridRoutePoints({
  avoidReservedSegments = true,
  bendOffset = 0,
  edgeIndex = 0,
  rects = [],
  reservedSegments = [],
  sourceStub,
  targetStub,
}) {
  const cleanRects = jsonArray(rects);
  const start = { x: Math.round(sourceStub.x), y: Math.round(sourceStub.y) };
  const target = { x: Math.round(targetStub.x), y: Math.round(targetStub.y) };
  const lanes = architectureGridRouteLanes(start, target, cleanRects, edgeIndex, bendOffset);
  const points = [];
  const pointByKey = new Map();
  const addPoint = (point, force = false) => {
    const candidate = { x: Math.round(point.x), y: Math.round(point.y) };
    if (!force && !architecturePointClearOfRects(candidate, cleanRects)) return;
    const key = architecturePointKey(candidate);
    if (pointByKey.has(key)) return;
    pointByKey.set(key, candidate);
    points.push(candidate);
  };

  lanes.xValues.forEach((x) => {
    lanes.yValues.forEach((y) => addPoint({ x, y }));
  });
  addPoint(start, true);
  addPoint(target, true);

  const startKey = architecturePointKey(start);
  const targetKey = architecturePointKey(target);
  const rowMap = new Map();
  const columnMap = new Map();
  points.forEach((point) => {
    const rowKey = String(Math.round(point.y));
    const columnKey = String(Math.round(point.x));
    if (!rowMap.has(rowKey)) rowMap.set(rowKey, []);
    if (!columnMap.has(columnKey)) columnMap.set(columnKey, []);
    rowMap.get(rowKey).push(point);
    columnMap.get(columnKey).push(point);
  });
  rowMap.forEach((rowPoints) => rowPoints.sort((left, right) => left.x - right.x));
  columnMap.forEach((columnPoints) => columnPoints.sort((left, right) => left.y - right.y));

  const neighborsByKey = new Map();
  const connect = (left, right) => {
    if (!architectureSegmentClearOfRects(left, right, cleanRects)) return;
    if (
      avoidReservedSegments
      && !architectureRouteSegmentClearOfReserved(left, right, reservedSegments)
    ) {
      return;
    }
    const leftKey = architecturePointKey(left);
    const rightKey = architecturePointKey(right);
    if (!neighborsByKey.has(leftKey)) neighborsByKey.set(leftKey, []);
    if (!neighborsByKey.has(rightKey)) neighborsByKey.set(rightKey, []);
    neighborsByKey.get(leftKey).push(right);
    neighborsByKey.get(rightKey).push(left);
  };
  const connectAdjacent = (linePoints) => {
    for (let index = 1; index < linePoints.length; index += 1) {
      connect(linePoints[index - 1], linePoints[index]);
    }
  };
  rowMap.forEach(connectAdjacent);
  columnMap.forEach(connectAdjacent);

  const startStateKey = architectureRouteStateKey(startKey);
  const distances = new Map([[startStateKey, 0]]);
  const previousByStateKey = new Map();
  const visited = new Set();
  const heap = [];
  architectureRouteHeapPush(heap, {
    key: startStateKey,
    priority: architectureRouteHeuristic(start, target),
  });
  let bestTargetStateKey = "";
  while (heap.length) {
    const item = architectureRouteHeapPop(heap);
    if (!item || visited.has(item.key)) continue;
    visited.add(item.key);
    const currentPointKey = architecturePointKeyFromRouteStateKey(item.key);
    if (currentPointKey === targetKey) {
      bestTargetStateKey = item.key;
      break;
    }
    const current = pointByKey.get(currentPointKey);
    if (!current) continue;
    const currentDirection = architectureDirectionFromRouteStateKey(item.key);
    const currentDistance = distances.get(item.key) ?? Infinity;
    (neighborsByKey.get(currentPointKey) || []).forEach((neighbor) => {
      const neighborSegment = architectureRouteSegment(current, neighbor);
      const neighborDirection = architectureSegmentDirection(neighborSegment);
      const neighborPointKey = architecturePointKey(neighbor);
      const neighborStateKey = architectureRouteStateKey(neighborPointKey, neighborDirection);
      if (visited.has(neighborStateKey)) return;
      const nextDistance = currentDistance
        + architectureNeighborRouteCost(current, neighbor, currentDirection, reservedSegments);
      if (nextDistance < (distances.get(neighborStateKey) ?? Infinity)) {
        distances.set(neighborStateKey, nextDistance);
        previousByStateKey.set(neighborStateKey, item.key);
        architectureRouteHeapPush(heap, {
          key: neighborStateKey,
          priority: nextDistance + architectureRouteHeuristic(neighbor, target),
        });
      }
    });
  }

  if (!bestTargetStateKey) return [];
  const route = [];
  let cursor = bestTargetStateKey;
  while (cursor) {
    const point = pointByKey.get(architecturePointKeyFromRouteStateKey(cursor));
    if (point) route.push(point);
    if (cursor === startStateKey) break;
    cursor = previousByStateKey.get(cursor);
  }
  if (architecturePointKey(route.at(-1)) !== startKey) return [];
  return architectureSimplifyEdgePoints(route.reverse());
}

function architectureOrthogonalEdgePoints({
  avoidanceRects = [],
  edgeIndex = 0,
  id,
  reservedSegments = [],
  sourceFanOffset = 0,
  sourcePosition,
  sourceX,
  sourceY,
  targetFanOffset = 0,
  targetPosition,
  targetX,
  targetY,
}) {
  const sourceSide = architectureEdgeSide(sourcePosition);
  const targetSide = architectureEdgeSide(targetPosition);
  const horizontal = sourceSide === "left"
    || sourceSide === "right"
    || targetSide === "left"
    || targetSide === "right";
  const offset = ARCHITECTURE_ROUTE_ENDPOINT_STUB;
  const bendOffset = architectureEdgeHashOffset(id);
  const sourceRoute = architectureSourceRoutePoints(sourceX, sourceY, sourceSide, sourceFanOffset, offset);
  const targetRoute = architectureTargetRoutePoints(targetX, targetY, targetSide, targetFanOffset, offset);
  const sourceStub = sourceRoute.stub;
  const targetStub = targetRoute.stub;
  const rects = jsonArray(avoidanceRects).filter((rect) => text(rect?.id) !== text(id));
  let gridRoute = architectureGridRoutePoints({
    bendOffset,
    edgeIndex,
    rects,
    reservedSegments,
    sourceStub,
    targetStub,
  });
  if (gridRoute.length < 2) {
    gridRoute = architectureGridRoutePoints({
      avoidReservedSegments: false,
      bendOffset,
      edgeIndex,
      rects,
      reservedSegments,
      sourceStub,
      targetStub,
    });
  }
  if (gridRoute.length >= 2) {
    return architectureSimplifyEdgePoints([
      ...sourceRoute.points,
      ...gridRoute,
      ...targetRoute.points,
    ]);
  }
  const bounds = architectureEdgeBounds(sourceX, sourceY, targetX, targetY, rects);
  const outsideOffset = 76 + Math.abs(bendOffset);
  const leftLane = bounds.left - outsideOffset;
  const rightLane = bounds.right + outsideOffset;
  const topLane = bounds.top - outsideOffset;
  const bottomLane = bounds.bottom + outsideOffset;
  const laneOffsets = architectureEdgeLaneOffsets(edgeIndex, bendOffset);
  const candidates = [];
  const pushCandidate = (middlePoints) => {
    candidates.push(architectureDedupEdgePoints([
      ...sourceRoute.points,
      ...middlePoints,
      ...targetRoute.points,
    ]));
  };

  if (horizontal) {
    laneOffsets.forEach((laneOffset) => {
      const midX = Math.round((sourceStub.x + targetStub.x) / 2 + laneOffset);
      pushCandidate([
        { x: midX, y: sourceStub.y },
        { x: midX, y: targetStub.y },
      ]);
    });
    laneOffsets.forEach((laneOffset) => {
      [leftLane - Math.abs(laneOffset), rightLane + Math.abs(laneOffset)].forEach((laneX) => {
        pushCandidate([
          { x: laneX, y: sourceStub.y },
          { x: laneX, y: targetStub.y },
        ]);
      });
      [topLane - Math.abs(laneOffset), bottomLane + Math.abs(laneOffset)].forEach((laneY) => {
        pushCandidate([
          { x: sourceStub.x, y: laneY },
          { x: targetStub.x, y: laneY },
        ]);
      });
    });
  } else {
    laneOffsets.forEach((laneOffset) => {
      const midY = Math.round((sourceStub.y + targetStub.y) / 2 + laneOffset);
      pushCandidate([
        { x: sourceStub.x, y: midY },
        { x: targetStub.x, y: midY },
      ]);
    });
    laneOffsets.forEach((laneOffset) => {
      [topLane - Math.abs(laneOffset), bottomLane + Math.abs(laneOffset)].forEach((laneY) => {
        pushCandidate([
          { x: sourceStub.x, y: laneY },
          { x: targetStub.x, y: laneY },
        ]);
      });
      [leftLane - Math.abs(laneOffset), rightLane + Math.abs(laneOffset)].forEach((laneX) => {
        pushCandidate([
          { x: laneX, y: sourceStub.y },
          { x: laneX, y: targetStub.y },
        ]);
      });
    });
  }

  return candidates
    .sort((left, right) => (
      architectureScoreEdgePoints(left, rects, sourceSide, targetSide, sourceX, targetX, sourceY, targetY, reservedSegments)
        - architectureScoreEdgePoints(right, rects, sourceSide, targetSide, sourceX, targetX, sourceY, targetY, reservedSegments)
    ))[0] || [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
}

function architecturePointTowardPoint(from, to, distance) {
  const xDelta = Math.round(numberValue(to?.x, 0)) - Math.round(numberValue(from?.x, 0));
  const yDelta = Math.round(numberValue(to?.y, 0)) - Math.round(numberValue(from?.y, 0));
  if (xDelta !== 0) {
    return {
      x: Math.round(numberValue(from?.x, 0)) + Math.sign(xDelta) * distance,
      y: Math.round(numberValue(from?.y, 0)),
    };
  }
  if (yDelta !== 0) {
    return {
      x: Math.round(numberValue(from?.x, 0)),
      y: Math.round(numberValue(from?.y, 0)) + Math.sign(yDelta) * distance,
    };
  }
  return {
    x: Math.round(numberValue(from?.x, 0)),
    y: Math.round(numberValue(from?.y, 0)),
  };
}

function architectureEdgePathFromPoints(points) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  if (!cleanPoints.length) return "";
  if (cleanPoints.length === 1) return `M ${cleanPoints[0].x} ${cleanPoints[0].y}`;
  const commands = [`M ${cleanPoints[0].x} ${cleanPoints[0].y}`];
  const cornerRadius = 14;
  for (let index = 1; index < cleanPoints.length - 1; index += 1) {
    const previous = cleanPoints[index - 1];
    const point = cleanPoints[index];
    const next = cleanPoints[index + 1];
    const previousLength = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const nextLength = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const isCorner = (previous.x === point.x || previous.y === point.y)
      && (point.x === next.x || point.y === next.y)
      && !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
    const radius = Math.min(cornerRadius, Math.floor(previousLength / 2), Math.floor(nextLength / 2));
    if (!isCorner || radius < 3) {
      commands.push(`L ${point.x} ${point.y}`);
      continue;
    }
    const beforeCorner = architecturePointTowardPoint(point, previous, radius);
    const afterCorner = architecturePointTowardPoint(point, next, radius);
    commands.push(`L ${beforeCorner.x} ${beforeCorner.y}`);
    commands.push(`Q ${point.x} ${point.y} ${afterCorner.x} ${afterCorner.y}`);
  }
  const lastPoint = cleanPoints.at(-1);
  commands.push(`L ${lastPoint.x} ${lastPoint.y}`);
  return commands.join(" ");
}

function architectureLabelRect(center, width, height) {
  return {
    height,
    width,
    x: Math.round(numberValue(center?.x, 0) - width / 2),
    y: Math.round(numberValue(center?.y, 0) - height / 2),
  };
}

function architectureRectsOverlap(left, right, padding = 0) {
  if (!left || !right) return false;
  return left.x - padding < right.x + right.width
    && left.x + left.width + padding > right.x
    && left.y - padding < right.y + right.height
    && left.y + left.height + padding > right.y;
}

function architectureSegmentIntersectsLabelRect(segment, rect, padding = 0) {
  if (!segment || !rect) return false;
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  if (segment.orientation === "vertical") {
    return segment.x >= left
      && segment.x <= right
      && segment.y2 >= top
      && segment.y1 <= bottom;
  }
  if (segment.orientation === "horizontal") {
    return segment.y >= top
      && segment.y <= bottom
      && segment.x2 >= left
      && segment.x1 <= right;
  }
  return false;
}

function architectureEdgeLabelSize(label) {
  const raw = text(label);
  return {
    height: ARCHITECTURE_EDGE_LABEL_HEIGHT,
    width: Math.round(clampNumber(
      raw.length * 6.2 + 24,
      ARCHITECTURE_EDGE_LABEL_MIN_WIDTH,
      ARCHITECTURE_EDGE_LABEL_MAX_WIDTH,
    )),
  };
}

function architecturePointAlongAxisSegment(start, end, distance) {
  const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  if (!length) return { x: Math.round(start.x), y: Math.round(start.y) };
  const ratio = clampNumber(distance / length, 0, 1);
  return {
    x: Math.round(start.x + (end.x - start.x) * ratio),
    y: Math.round(start.y + (end.y - start.y) * ratio),
  };
}

function architectureEdgeLabelCollisionScore(
  rect,
  routeSegments,
  avoidanceRects,
  ownRouteSegments = [],
  nodeAvoidanceRects = [],
) {
  if (jsonArray(nodeAvoidanceRects).some((obstacle) => (
    architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING)
  ))) {
    return Infinity;
  }

  let score = 0;
  jsonArray(avoidanceRects).forEach((obstacle) => {
    if (architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_PADDING)) {
      score += 260000;
    } else if (architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_PADDING + 16)) {
      score += 12000;
    }
  });
  jsonArray(routeSegments).forEach((segment) => {
    if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING)) {
      score += 90000;
    } else if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING + 12)) {
      score += 9000;
    }
  });
  jsonArray(ownRouteSegments).forEach((segment) => {
    if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING)) {
      score += 14000;
    } else if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING + 4)) {
      score += 700;
    }
  });
  return score;
}

function architectureEdgeLabelFallbackPoint(points) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  let bestStart = cleanPoints[0] || { x: 0, y: 0 };
  let bestEnd = cleanPoints[1] || bestStart;
  let bestLength = -1;
  for (let index = 1; index < cleanPoints.length; index += 1) {
    const nearEndpoint = index <= 2 || index >= cleanPoints.length - 2;
    const start = cleanPoints[index - 1];
    const end = cleanPoints[index];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (!nearEndpoint && length > bestLength) {
      bestStart = start;
      bestEnd = end;
      bestLength = length;
    }
  }
  if (bestLength < 0) {
    const labelSegmentIndex = Math.max(0, Math.min(cleanPoints.length - 2, Math.floor((cleanPoints.length - 1) / 2)));
    bestStart = cleanPoints[labelSegmentIndex] || bestStart;
    bestEnd = cleanPoints[labelSegmentIndex + 1] || bestStart;
  }
  return {
    x: Math.round((bestStart.x + bestEnd.x) / 2),
    y: Math.round((bestStart.y + bestEnd.y) / 2),
  };
}

function architectureEdgeLabelPlacement(points, options = {}) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  const labelSize = architectureEdgeLabelSize(options.label);
  const nodeAvoidanceRects = jsonArray(options.nodeAvoidanceRects);
  const ownRouteSegments = jsonArray(options.ownRouteSegments);
  const routeSegments = jsonArray(options.routeSegments);
  const avoidanceRects = jsonArray(options.avoidanceRects);
  let bestCandidate = null;
  let routeLength = 0;
  const segmentEntries = [];

  for (let index = 1; index < cleanPoints.length; index += 1) {
    const start = cleanPoints[index - 1];
    const end = cleanPoints[index];
    const horizontal = start.y === end.y;
    const vertical = start.x === end.x;
    if (!horizontal && !vertical) continue;
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (length <= 0) continue;

    segmentEntries.push({
      end,
      horizontal,
      index,
      length,
      pathStart: routeLength,
      start,
      vertical,
    });
    routeLength += length;
  }

  segmentEntries.forEach((entry) => {
    const { end, horizontal, index, length, pathStart, start } = entry;

    const nearEndpoint = index <= 2 || index >= cleanPoints.length - 2;
    const inset = Math.min(
      ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP,
      Math.max(0, Math.floor(length / 2) - 1),
    );
    const distances = [...new Set([0.5, 0.36, 0.64, 0.24, 0.76].map((ratio) => (
      Math.round(clampNumber(length * ratio, inset, Math.max(inset, length - inset)))
    )))];
    const offsetDistances = [
      ARCHITECTURE_EDGE_LABEL_OFFSET,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 4,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 9,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 18,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 30,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 44,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 64,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 88,
    ];
    const sideOrder = index % 2 ? [-1, 1] : [1, -1];

    distances.forEach((distance) => {
      const basePoint = architecturePointAlongAxisSegment(start, end, distance);
      offsetDistances.forEach((offsetDistance) => {
        sideOrder.forEach((side) => {
          const center = horizontal
            ? { x: basePoint.x, y: basePoint.y + side * offsetDistance }
            : { x: basePoint.x + side * offsetDistance, y: basePoint.y };
          const rect = architectureLabelRect(center, labelSize.width, labelSize.height);
          const endpointGap = Math.min(distance, length - distance);
          const pathDistance = pathStart + distance;
          const score = architectureEdgeLabelCollisionScore(
            rect,
            routeSegments,
            avoidanceRects,
            ownRouteSegments,
            nodeAvoidanceRects,
          )
            + (horizontal ? 0 : 18000)
            + (nearEndpoint ? 3200 : 0)
            + Math.max(0, ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP - endpointGap) * 70
            + Math.max(0, labelSize.width + 28 - length) * 120
            + Math.abs(distance - length / 2) * 5
            + Math.abs(pathDistance - routeLength / 2) * 4
            + Math.abs(index - cleanPoints.length / 2) * 120
            + (offsetDistance - ARCHITECTURE_EDGE_LABEL_OFFSET) * 180
            - Math.min(length, 220) * 2;
          if (Number.isFinite(score) && (!bestCandidate || score < bestCandidate.score)) {
            bestCandidate = {
              center,
              orientation: horizontal ? "horizontal" : "vertical",
              score,
            };
          }
        });
      });
    });
  });
  const fallback = architectureEdgeLabelFallbackPoint(cleanPoints);
  const fallbackBlocked = Boolean(
    !bestCandidate
    && nodeAvoidanceRects.length
    && jsonArray(nodeAvoidanceRects).some((obstacle) => (
      architectureRectsOverlap(
        architectureLabelRect(fallback, labelSize.width, labelSize.height),
        obstacle,
        ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING,
      )
    )),
  );
  return {
    hidden: fallbackBlocked,
    orientation: bestCandidate?.orientation || "horizontal",
    width: labelSize.width,
    x: Math.round(bestCandidate?.center?.x ?? fallback.x),
    y: Math.round(bestCandidate?.center?.y ?? fallback.y),
  };
}

function architectureOrthogonalEdgePath({
  avoidanceRects = [],
  id,
  label = "",
  labelAvoidanceSegments = [],
  labelPlacement: providedLabelPlacement = null,
  routePoints = [],
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}) {
  const cleanPoints = jsonArray(routePoints).length >= 2
    ? architectureDedupEdgePoints(routePoints)
    : architectureOrthogonalEdgePoints({
      avoidanceRects,
      id,
      sourcePosition,
      sourceX,
      sourceY,
      targetPosition,
      targetX,
      targetY,
    });
  const labelPlacement = providedLabelPlacement || architectureEdgeLabelPlacement(cleanPoints, {
    avoidanceRects,
    label,
    routeSegments: labelAvoidanceSegments,
  });
  return [
    architectureEdgePathFromPoints(cleanPoints),
    labelPlacement.x,
    labelPlacement.y,
    labelPlacement,
  ];
}

function architectureEdgeStrokeColor(role, selected = false) {
  if (selected) return "rgba(251, 191, 36, 0.95)";
  const edgeRole = architectureEdgeRole(role);
  if (edgeRole === "writes" || edgeRole === "publishes") return "rgba(52, 211, 153, 0.86)";
  if (edgeRole === "reads" || edgeRole === "subscribes") return "rgba(251, 191, 36, 0.84)";
  if (edgeRole === "transitions" || edgeRole === "guards") return "rgba(167, 139, 250, 0.88)";
  if (edgeRole === "depends-on") return "rgba(244, 114, 182, 0.8)";
  if (edgeRole === "fails-to" || edgeRole === "retries") return "rgba(251, 113, 133, 0.86)";
  return "rgba(125, 211, 252, 0.8)";
}

function architectureEdgeStrokeDash(role, kind = "") {
  const edgeRole = architectureEdgeRole(role || kind);
  if (edgeRole === "depends-on" || kind === "depends") return "7 5";
  if (edgeRole === "subscribes" || edgeRole === "guards") return "2 6";
  if (edgeRole === "retries") return "5 4 1 4";
  return "0";
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
  const kind = text(data?.kind, "calls");
  const role = architectureEdgeRole(data?.role || kind);
  const label = text(data?.label);
  const [edgePath, labelX, labelY, labelPlacement] = architectureOrthogonalEdgePath({
    avoidanceRects: data?.avoidanceRects,
    id,
    label,
    labelAvoidanceSegments: data?.labelAvoidanceSegments,
    labelPlacement: data?.labelPlacement,
    routePoints: data?.routePoints,
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: architectureEdgeStrokeColor(role, selected),
          strokeDasharray: architectureEdgeStrokeDash(role, kind),
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeWidth: selected ? 3 : 2.2,
        }}
      />
      {label && !labelPlacement?.hidden && (
        <EdgeLabelRenderer>
          <ArchitectureEdgeLabel
            data-kind={role}
            data-orientation={labelPlacement?.orientation || "horizontal"}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              "--edge-label-max-width": `${labelPlacement?.width || ARCHITECTURE_EDGE_LABEL_MAX_WIDTH}px`,
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
  gap: 9px;
  min-width: 0;
  min-height: 38px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--forge-border);
  background: rgba(15, 23, 42, 0.34);
`;

const ViewToggleGroup = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.42);
`;

const ViewToggleButton = styled.button`
  min-height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(148, 163, 184, 0.14);
  }
`;

const ToolbarMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  &[data-nav-collapsed="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

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

const ArchitectureNavHeaderActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
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

const ArchitectureCreateGraphButton = styled(ArchitectureIconButton)`
  width: 22px;
  height: 22px;
  border-radius: 6px;

  svg {
    display: block;
    width: 14px;
    height: 14px;
  }
`;

const ArchitectureNavToggleButton = styled(ArchitectureIconButton)`
  border-color: rgba(148, 163, 184, 0.18);
  color: rgba(203, 213, 225, 0.8);
  background: rgba(15, 23, 42, 0.42);
  font-size: 10px;
  font-weight: 900;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    background: rgba(14, 165, 233, 0.14);
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
  grid-template-columns: 12px minmax(0, 1fr) auto auto;
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

  &[data-agent-edit] {
    border-color: rgba(125, 211, 252, 0.16);
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

const ArchitectureTreeAgentMarker = styled.span`
  display: inline-flex;
  max-width: 74px;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: rgba(226, 232, 240, 0.74);
  font-size: 8px;
  font-weight: 920;
  line-height: 1;
  text-transform: uppercase;

  i {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--agent-edit-color, #60a5fa);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 18%, transparent);
  }

  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  gap: 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
`;

const ArchitectureEditorContent = styled.div`
  position: relative;
  display: grid;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ArchitectureRestoreNavButton = styled.button`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 8px;
  color: rgba(224, 242, 254, 0.9);
  background: rgba(15, 23, 42, 0.72);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;

  &:hover,
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.46);
    background: rgba(14, 165, 233, 0.18);
  }
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
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
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

const ArchitectureEditorNoticeSlot = styled.div`
  min-width: 0;
  min-height: 0;
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
  display: block;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  @media (max-width: 900px) {
    overflow: hidden;
  }
`;

const ArchitectureCanvasViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.16), rgba(2, 6, 23, 0.18)),
    rgba(2, 6, 23, 0.36);

  .react-flow {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .react-flow__edge-path {
    shape-rendering: crispEdges;
  }

`;

const ArchitectureFloatingActions = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 8;
  display: flex;
  gap: 7px;
  pointer-events: auto;
  opacity: 0.72;
  transition: opacity 120ms ease, transform 120ms ease;

  ${ArchitectureCanvasViewport}:hover &,
  &:focus-within {
    opacity: 1;
    transform: translateY(0);
  }
`;

const ArchitectureAgentEditStatus = styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9;
  display: inline-flex;
  max-width: min(300px, calc(100% - 240px));
  min-width: 0;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--agent-edit-color, #60a5fa) 28%, rgba(148, 163, 184, 0.16));
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.9);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(10px);
  pointer-events: none;

  i {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--agent-edit-color, #60a5fa);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 18%, transparent),
      0 0 14px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 32%, transparent);
  }

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 10px;
    font-weight: 860;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    right: 12px;
    max-width: calc(100% - 24px);
  }
`;

const ArchitectureSliceToolbar = styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 8;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: min(620px, calc(100% - 220px));
  pointer-events: auto;
  opacity: 0.74;
  transition: opacity 120ms ease;

  &[data-has-agent-marker="true"] {
    top: 48px;
  }

  ${ArchitectureCanvasViewport}:hover &,
  &:focus-within {
    opacity: 1;
  }

  @media (max-width: 900px) {
    right: 12px;
    max-width: calc(100% - 24px);
  }
`;

const ArchitectureFloatingButton = styled.button`
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.88);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ArchitectureSliceButton = styled(ArchitectureFloatingButton)`
  height: 28px;
  padding: 0 9px;
  border-color: rgba(125, 211, 252, 0.2);
  color: rgba(224, 242, 254, 0.9);
  background: rgba(15, 23, 42, 0.68);
  font-size: 10px;
`;

const ArchitectureFloatingDangerButton = styled(ArchitectureFloatingButton)`
  border-color: rgba(251, 113, 133, 0.28);
  color: #fecdd3;
  background: rgba(69, 10, 10, 0.64);
`;

const ArchitectureFloatingPrimaryButton = styled(ArchitectureFloatingButton)`
  border-color: rgba(45, 212, 191, 0.3);
  color: #ccfbf1;
  background: rgba(13, 69, 63, 0.66);
`;

const ArchitectureValidationPanel = styled.div`
  position: absolute;
  left: 12px;
  bottom: 58px;
  z-index: 7;
  display: grid;
  gap: 4px;
  width: min(380px, calc(100% - 24px));
  max-height: 154px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 8px;
  color: rgba(254, 243, 199, 0.86);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  pointer-events: none;

  strong {
    color: rgba(254, 249, 195, 0.95);
    font-size: 11px;
    font-weight: 920;
  }

  span {
    overflow: hidden;
    color: rgba(253, 230, 138, 0.82);
    font-size: 10px;
    font-weight: 760;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ArchitectureAgentCommandForm = styled.form`
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 8;
  display: flex;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: min(520px, calc(100% - 28px));
  min-width: 0;
  min-height: 40px;
  padding: 5px 6px 5px 14px;
  border: 1px solid rgba(230, 236, 245, 0.11);
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.82);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(12px);
  transform: translateX(-50%);

  &:focus-within {
    border-color: rgba(125, 176, 255, 0.45);
    background: rgba(8, 12, 18, 0.92);
  }

  &[data-state="error"] {
    border-color: rgba(251, 113, 133, 0.36);
  }

  &[data-state="notice"] {
    border-color: rgba(45, 212, 191, 0.32);
  }
`;

const ArchitectureAgentCommandInput = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  border: 0;
  outline: none;
  color: #eef4ff;
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 680;
  line-height: 1.25;

  &::placeholder {
    color: #657386;
  }
`;

const ArchitectureAgentCommandSubmitButton = styled.button`
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  color: #8d9aac;
  background: rgba(21, 27, 36, 0.94);
  line-height: 1;
  outline: none;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:not(:disabled):hover {
    border-color: rgba(255, 255, 255, 0.42);
    color: #05070a;
    background: #ffffff;
  }

  &[data-ready="true"] {
    border-color: rgba(255, 255, 255, 0.5);
    color: #05070a;
    background: #ffffff;
  }

  &:disabled {
    cursor: default;
    opacity: 0.68;
  }
`;

const ArchitectureAgentCommandSubmitIcon = styled(North)`
  display: block;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
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
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: ${ARCHITECTURE_NODE_CARD_WIDTH}px;
  min-height: ${ARCHITECTURE_NODE_CARD_HEIGHT}px;
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

  &[data-role="state"] {
    border-color: rgba(167, 139, 250, 0.38);
    background: linear-gradient(180deg, rgba(124, 58, 237, 0.2), rgba(15, 23, 42, 0.86));
  }

  &[data-role="decision"] {
    border-color: rgba(251, 191, 36, 0.42);
    background: linear-gradient(180deg, rgba(217, 119, 6, 0.2), rgba(15, 23, 42, 0.86));
  }

  &[data-role="terminal"] {
    border-color: rgba(251, 113, 133, 0.42);
    background: linear-gradient(180deg, rgba(190, 18, 60, 0.18), rgba(15, 23, 42, 0.86));
  }

  &[data-role="dependency"],
  &[data-role="package"] {
    border-color: rgba(244, 114, 182, 0.34);
    background: linear-gradient(180deg, rgba(190, 24, 93, 0.16), rgba(15, 23, 42, 0.86));
  }

  &[data-lifecycle="start"] {
    box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.24), 0 12px 30px rgba(0, 0, 0, 0.22);
  }

  &[data-display="compact"],
  &[data-display="compact"][data-kind="client"],
  &[data-display="compact"][data-kind="database"],
  &[data-display="compact"][data-kind="external"],
  &[data-display="compact"][data-kind="queue"] {
    grid-template-columns: 1fr;
    align-content: center;
    justify-items: center;
    gap: 6px;
    width: ${ARCHITECTURE_NODE_COMPACT_WIDTH}px;
    min-height: ${ARCHITECTURE_NODE_COMPACT_HEIGHT}px;
    padding: 4px;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  &[data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.18), 0 12px 30px rgba(0, 0, 0, 0.24);
  }

  &[data-display="compact"][data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.42);
    background: rgba(15, 23, 42, 0.28);
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.12);
  }

  .react-flow__handle {
    width: 9px;
    height: 9px;
    border: 1px solid rgba(2, 6, 23, 0.9);
    background: rgba(125, 211, 252, 0.95);
  }

  &[data-display="compact"] .react-flow__handle {
    width: 7px;
    height: 7px;
  }
`;

const ArchitectureNodeIcon = styled.span`
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(125, 211, 252, 0.36);
  border-radius: 7px;
  color: rgba(248, 250, 252, 0.92);
  background: rgba(14, 165, 233, 0.18);
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
    border-color: rgba(226, 232, 240, 0.2);
    color: rgba(248, 250, 252, 0.96);
    background: rgba(248, 250, 252, 0.08);
    box-shadow: inset 0 0 0 1px rgba(248, 250, 252, 0.04), 0 5px 14px rgba(0, 0, 0, 0.14);
  }

  &[data-source="likec4"] svg {
    filter: brightness(0) invert(1);
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
    border-color: rgba(254, 240, 138, 0.26);
    background: rgba(217, 119, 6, 0.16);
  }

  &[data-kind="database"] {
    border-color: rgba(52, 211, 153, 0.44);
    border-radius: 50%;
    background: rgba(5, 150, 105, 0.22);
  }

  &[data-kind="database"][data-source="likec4"],
  &[data-kind="database"][data-source="styled"] {
    border-color: rgba(167, 243, 208, 0.28);
    background: rgba(5, 150, 105, 0.16);
  }

  &[data-kind="external"] {
    border-color: rgba(244, 114, 182, 0.42);
    background: rgba(190, 24, 93, 0.22);
  }

  &[data-kind="external"][data-source="likec4"],
  &[data-kind="external"][data-source="styled"] {
    border-color: rgba(251, 207, 232, 0.28);
    background: rgba(190, 24, 93, 0.16);
  }

  &[data-kind="queue"] {
    border-color: rgba(167, 139, 250, 0.42);
    background: rgba(109, 40, 217, 0.22);
  }

  &[data-kind="queue"][data-source="likec4"],
  &[data-kind="queue"][data-source="styled"] {
    border-color: rgba(221, 214, 254, 0.28);
    background: rgba(109, 40, 217, 0.16);
  }

  &[data-kind="group"] {
    border-radius: 7px;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & {
    width: 34px;
    height: 34px;
    border-radius: 11px;
    font-size: 8px;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] &[data-kind="database"] {
    border-radius: 50%;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & svg {
    width: 21px;
    height: 21px;
    max-width: 23px;
    max-height: 23px;
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

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & {
    justify-items: center;
    width: 100%;
    text-align: center;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & strong {
    max-width: ${ARCHITECTURE_NODE_COMPACT_WIDTH - 4}px;
    color: rgba(248, 250, 252, 0.94);
    font-size: 10px;
    font-weight: 860;
  }
`;

const ArchitectureCanvasGroupShell = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.88);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.28), rgba(2, 6, 23, 0.16)),
    rgba(15, 23, 42, 0.18);
  box-shadow: inset 0 0 0 1px rgba(248, 250, 252, 0.025);

  &[data-intent="api-pathway"] {
    border-color: rgba(125, 211, 252, 0.42);
    background:
      linear-gradient(180deg, rgba(14, 165, 233, 0.12), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-intent="data-flow"] {
    border-color: rgba(52, 211, 153, 0.38);
    background:
      linear-gradient(180deg, rgba(5, 150, 105, 0.12), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-intent="control-graph"] {
    border-color: rgba(251, 191, 36, 0.42);
    background:
      linear-gradient(180deg, rgba(217, 119, 6, 0.12), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-intent="state-machine"] {
    border-color: rgba(167, 139, 250, 0.42);
    background:
      linear-gradient(180deg, rgba(124, 58, 237, 0.12), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-intent="dependency-graph"] {
    border-color: rgba(244, 114, 182, 0.38);
    background:
      linear-gradient(180deg, rgba(190, 24, 93, 0.1), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-intent="deployment"] {
    border-color: rgba(45, 212, 191, 0.38);
    background:
      linear-gradient(180deg, rgba(13, 148, 136, 0.1), rgba(2, 6, 23, 0.16)),
      rgba(15, 23, 42, 0.18);
  }

  &[data-selected="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    background:
      linear-gradient(180deg, rgba(120, 53, 15, 0.16), rgba(2, 6, 23, 0.18)),
      rgba(15, 23, 42, 0.18);
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
  padding: 1px 0 0;
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
  max-width: var(--edge-label-max-width, 156px);
  padding: 3px 8px;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, 0.22);
  border-radius: 999px;
  color: rgba(224, 242, 254, 0.92);
  background: rgba(2, 6, 23, 0.76);
  box-shadow: 0 0 0 1px rgba(2, 6, 23, 0.38);
  font-size: 8.5px;
  font-weight: 850;
  line-height: 1.15;
  pointer-events: none;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;

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

  &[data-kind="transitions"],
  &[data-kind="guards"] {
    border-color: rgba(167, 139, 250, 0.28);
    color: rgba(237, 233, 254, 0.94);
  }

  &[data-kind="depends-on"] {
    border-color: rgba(244, 114, 182, 0.26);
    color: rgba(251, 207, 232, 0.92);
  }

  &[data-kind="fails-to"],
  &[data-kind="retries"] {
    border-color: rgba(251, 113, 133, 0.28);
    color: rgba(254, 205, 211, 0.94);
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
