import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createCircuitWebWorker } from "@tscircuit/eval/worker";
import evalWebWorkerBlobUrl from "@tscircuit/eval/blob-url";
import manifoldModuleUrl from "manifold-3d/manifold.js?url";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import runframeStandalonePreviewUrl from "@tscircuit/runframe/standalone-preview?url";
import {
  normalizePcbElementContexts,
  resolvePcbPickedElementContext,
} from "./pcbElementContext.js";

export const PCB_VIEW_TABS = [
  { id: "pcb", label: "PCB" },
  { id: "schematic", label: "Schematic" },
  { id: "cad", label: "3D" },
  { id: "assembly", label: "Assembly" },
  { id: "pinout", label: "Pinout" },
  { id: "analog_simulation", label: "Simulation" },
  { id: "bom", label: "BOM" },
  { id: "circuit_json", label: "JSON" },
  { id: "errors", label: "Errors" },
  { id: "render_log", label: "Render Log" },
  { id: "solvers", label: "Solvers" },
];
export const PCB_TABS = PCB_VIEW_TABS.map((tab) => tab.id);
export const PCB_STORE_CHANGED_EVENT = "pcb-store-changed";
const PCB_MAIN_FILE_PATH = "main.tsx";
const PCB_RENDER_TIMEOUT_MS = 30000;
const PCB_RENDER_CANCELLED_MESSAGE = "PCB render cancelled.";
const PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS = [250, 750];
const PCB_PARTS_ENGINE_FETCH_HOSTS = new Set([
  "jlcsearch.tscircuit.com",
  "easyeda.com",
  "modules.easyeda.com",
  "modelcdn.tscircuit.com",
  "kicad-mod-cache.tscircuit.com",
]);
const PCB_PARTS_ENGINE_CACHE_PREFIX = "diffforge:pcb:parts-engine:v2:";
const PCB_VENDOR_RESPONSE_CACHE_PREFIX = "diffforge:pcb:vendor-response:v1:";
const PCB_VENDOR_RESPONSE_CACHE_MAX_CHARS = 1_500_000;
const PCB_EASYEDA_PROXY_ENDPOINT_URL = "https://easyeda.com/api/diffforge-proxy";
const PCB_PARTS_ENGINE_FETCH_RETRY_SYMBOL = Symbol.for("diffforge.pcb.partsEngineFetchRetry");
const PCB_EVAL_WORKER_POLYFILL_SOURCE = `
(function () {
  function getIteratorPrototype() {
    if (typeof Iterator !== "undefined" && Iterator && Iterator.prototype) {
      return Iterator.prototype;
    }
    try {
      return Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    } catch {
      return null;
    }
  }
  var iteratorPrototype = getIteratorPrototype();
  if (!iteratorPrototype) {
    return;
  }
  function defineIteratorHelper(name, helper) {
    if (typeof iteratorPrototype[name] === "function") {
      return;
    }
    Object.defineProperty(iteratorPrototype, name, {
      configurable: true,
      writable: true,
      value: helper,
    });
  }
  defineIteratorHelper("map", function (callback) {
    var source = this;
    var index = 0;
    return (function* () {
      for (var value of source) {
        yield callback(value, index++);
      }
    })();
  });
  defineIteratorHelper("filter", function (callback) {
    var source = this;
    var index = 0;
    return (function* () {
      for (var value of source) {
        if (callback(value, index++)) {
          yield value;
        }
      }
    })();
  });
  defineIteratorHelper("toArray", function () {
    return Array.from(this);
  });
  defineIteratorHelper("flatMap", function (callback) {
    var source = this;
    var index = 0;
    return (function* () {
      for (var value of source) {
        var mapped = callback(value, index++);
        if (mapped == null) {
          continue;
        }
        if (typeof mapped[Symbol.iterator] === "function") {
          yield* mapped;
        } else {
          yield mapped;
        }
      }
    })();
  });
  defineIteratorHelper("some", function (callback) {
    var index = 0;
    for (var value of this) {
      if (callback(value, index++)) {
        return true;
      }
    }
    return false;
  });
  defineIteratorHelper("every", function (callback) {
    var index = 0;
    for (var value of this) {
      if (!callback(value, index++)) {
        return false;
      }
    }
    return true;
  });
  defineIteratorHelper("find", function (callback) {
    var index = 0;
    for (var value of this) {
      if (callback(value, index++)) {
        return value;
      }
    }
    return undefined;
  });
})();
`;
let patchedEvalWorkerBlobUrlPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFetchInputUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

function isPcbPartsEngineFetch(input) {
  const inputUrl = getFetchInputUrl(input);
  if (!inputUrl) {
    return false;
  }
  try {
    return PCB_PARTS_ENGINE_FETCH_HOSTS.has(new URL(inputUrl, window.location.href).hostname);
  } catch {
    return false;
  }
}

function shouldPreferNativePcbPartsEngineFetch(input) {
  const inputUrl = getFetchInputUrl(input);
  if (!inputUrl) {
    return false;
  }
  try {
    const url = new URL(inputUrl, window.location.href);
    return url.hostname === "easyeda.com" && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function shouldRetryPcbPartsEngineResponse(response) {
  return response?.status === 408 || response?.status === 425 || response?.status === 429 || response?.status >= 500;
}

function mergeFetchHeaders(input, init) {
  const headers = {};
  try {
    if (input && typeof input === "object" && input.headers) {
      new Headers(input.headers).forEach((value, key) => {
        headers[key] = value;
      });
    }
  } catch {}
  try {
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
    }
  } catch {}
  return headers;
}

function getHeaderValue(headers, name) {
  const wanted = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) {
      return value;
    }
  }
  return "";
}

function deleteHeader(headers, name) {
  const wanted = String(name || "").toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (String(key).toLowerCase() === wanted) {
      delete headers[key];
    }
  }
}

function setHeaderIfPresent(headers, name, value) {
  if (value == null || value === "") {
    return;
  }
  headers[name] = value;
}

async function getNativeFetchBody(init) {
  const body = init?.body;
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Blob) {
    return body.text();
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return String(body);
}

function normalizePcbVendorFetchRequest({ body, headers, method, url }) {
  const requestHeaders = { ...(headers || {}) };
  const targetUrl = getHeaderValue(requestHeaders, "x-target-url");
  if (targetUrl) {
    const senderOrigin = getHeaderValue(requestHeaders, "x-sender-origin");
    const senderReferer = getHeaderValue(requestHeaders, "x-sender-referer");
    const senderUserAgent = getHeaderValue(requestHeaders, "x-sender-user-agent");
    const senderCookie = getHeaderValue(requestHeaders, "x-sender-cookie");
    deleteHeader(requestHeaders, "x-target-url");
    deleteHeader(requestHeaders, "x-sender-origin");
    deleteHeader(requestHeaders, "x-sender-host");
    deleteHeader(requestHeaders, "x-sender-referer");
    deleteHeader(requestHeaders, "x-sender-user-agent");
    deleteHeader(requestHeaders, "x-sender-cookie");
    setHeaderIfPresent(requestHeaders, "origin", senderOrigin);
    setHeaderIfPresent(requestHeaders, "referer", senderReferer);
    setHeaderIfPresent(requestHeaders, "user-agent", senderUserAgent);
    setHeaderIfPresent(requestHeaders, "cookie", senderCookie);
  }
  return {
    body,
    headers: requestHeaders,
    method,
    url: targetUrl || url,
  };
}

async function createPcbVendorFetchRequest(input, init) {
  return normalizePcbVendorFetchRequest({
    body: await getNativeFetchBody(init),
    headers: mergeFetchHeaders(input, init),
    method: init?.method || input?.method || "GET",
    url: getFetchInputUrl(input),
  });
}

function shouldCachePcbVendorResponse(request) {
  try {
    const url = new URL(request?.url || "", window.location.href);
    if (url.hostname === "easyeda.com" && url.pathname.startsWith("/api/")) {
      return true;
    }
    return url.hostname === "jlcsearch.tscircuit.com";
  } catch {
    return false;
  }
}

function getPcbVendorResponseCacheKey(request) {
  if (!shouldCachePcbVendorResponse(request)) {
    return "";
  }
  const method = String(request?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return "";
  }
  return `${PCB_VENDOR_RESPONSE_CACHE_PREFIX}${hashString([
    method,
    request.url || "",
    request.body || "",
  ].join("\0"))}`;
}

function readPcbVendorResponseCache(cacheKey) {
  if (!cacheKey || typeof window === "undefined") {
    return null;
  }
  try {
    const cached = window.localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed.body !== "string") {
      return null;
    }
    return new Response(parsed.body, {
      headers: parsed.headers || {},
      status: parsed.status || 200,
      statusText: parsed.statusText || "OK",
    });
  } catch {
    return null;
  }
}

async function cachePcbVendorResponse(cacheKey, response) {
  if (!cacheKey || !response?.ok || typeof window === "undefined") {
    return;
  }
  try {
    const responseBody = await response.clone().text();
    if (responseBody.length > PCB_VENDOR_RESPONSE_CACHE_MAX_CHARS) {
      return;
    }
    const headers = {};
    response.headers?.forEach?.((value, key) => {
      headers[key] = value;
    });
    window.localStorage.setItem(cacheKey, JSON.stringify({
      body: responseBody,
      createdAt: Date.now(),
      headers,
      status: response.status,
      statusText: response.statusText,
    }));
  } catch {
    // Vendor response caching is an optimization; fetch failure handling below is the source of truth.
  }
}

async function fetchPcbPartsEngineViaNativeRequest(request) {
  const nativeResponse = await invoke("pcb_vendor_fetch", {
    request,
  });
  return new Response(nativeResponse?.body || "", {
    headers: nativeResponse?.headers || {},
    status: nativeResponse?.status || 200,
    statusText: nativeResponse?.statusText || "",
  });
}

function installPcbPartsEngineFetchRetry() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  if (window[PCB_PARTS_ENGINE_FETCH_RETRY_SYMBOL]) {
    return;
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!isPcbPartsEngineFetch(input)) {
      return originalFetch(input, init);
    }

    const nativeRequest = await createPcbVendorFetchRequest(input, init);
    const vendorResponseCacheKey = getPcbVendorResponseCacheKey(nativeRequest);
    const rememberResponse = async (response) => {
      await cachePcbVendorResponse(vendorResponseCacheKey, response);
      return response;
    };
    let lastError = null;
    const preferNativeFetch = shouldPreferNativePcbPartsEngineFetch(input);
    for (let attempt = 0; attempt <= PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = preferNativeFetch
          ? await fetchPcbPartsEngineViaNativeRequest(nativeRequest)
          : await originalFetch(input, init);
        if (!shouldRetryPcbPartsEngineResponse(response) || attempt === PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS.length) {
          return rememberResponse(response);
        }
      } catch (error) {
        lastError = error;
        if (!preferNativeFetch) {
          try {
            const nativeResponse = await fetchPcbPartsEngineViaNativeRequest(nativeRequest);
            if (!shouldRetryPcbPartsEngineResponse(nativeResponse) || attempt === PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS.length) {
              return rememberResponse(nativeResponse);
            }
          } catch (nativeError) {
            lastError = nativeError;
          }
        }
        if (attempt === PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS.length) {
          break;
        }
      }
      await sleep(PCB_PARTS_ENGINE_FETCH_RETRY_DELAYS_MS[attempt]);
    }
    const cachedResponse = readPcbVendorResponseCache(vendorResponseCacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw lastError ?? new Error(`PCB parts engine fetch failed for ${getFetchInputUrl(input) || "unknown URL"}`);
  };
  window[PCB_PARTS_ENGINE_FETCH_RETRY_SYMBOL] = true;
}

function stableSerializeFsMap(fsMap) {
  return Object.entries(fsMap || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, content]) => `${filePath}\0${typeof content === "string" ? content : JSON.stringify(content)}`)
    .join("\0");
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createPcbPartsEngineLocalCache(fsMap) {
  const namespace = `${PCB_PARTS_ENGINE_CACHE_PREFIX}${hashString(stableSerializeFsMap(fsMap))}:`;
  const memoryCache = new Map();
  const makeKey = (cacheKey) => `${namespace}${cacheKey}`;

  return {
    async getItem(cacheKey) {
      if (!cacheKey) {
        return null;
      }
      const key = makeKey(cacheKey);
      if (memoryCache.has(key)) {
        return memoryCache.get(key);
      }
      try {
        const value = window.localStorage.getItem(key);
        if (value != null) {
          memoryCache.set(key, value);
        }
        return value;
      } catch {
        return null;
      }
    },
    async setItem(cacheKey, value) {
      if (!cacheKey || typeof value !== "string") {
        return;
      }
      const key = makeKey(cacheKey);
      memoryCache.set(key, value);
      try {
        window.localStorage.setItem(key, value);
      } catch {}
    },
  };
}

function summarizeCircuitJsonIssues(circuitJson) {
  const errors = [];
  const warnings = [];
  for (const element of normalizeCircuitJsonPayload(circuitJson)) {
    const type = typeof element?.type === "string" ? element.type : "";
    if (/_error$/.test(type)) {
      errors.push(element);
    } else if (/_warning$/.test(type)) {
      warnings.push(element);
    }
  }
  return { errors, warnings };
}

function formatCircuitJsonIssueSummary(label, issues) {
  if (!issues.length) {
    return "";
  }
  const firstMessage = issues[0]?.message || issues[0]?.error || issues[0]?.type || "No message";
  const suffix = issues.length === 1 ? "" : ` and ${issues.length - 1} more`;
  return `${label}: ${firstMessage}${suffix}`;
}

function serializeJavaScriptLiteral(value) {
  return String(JSON.stringify(value) ?? "null")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function resolveRuntimeAssetUrl(assetUrl) {
  try {
    return new URL(assetUrl, import.meta.url).href;
  } catch {}
  if (typeof document !== "undefined") {
    try {
      return new URL(assetUrl, document.baseURI).href;
    } catch {}
  }
  if (typeof window !== "undefined") {
    try {
      return new URL(assetUrl, window.location.href).href;
    } catch {}
  }
  return assetUrl;
}

function getPatchedEvalWorkerBlobUrl() {
  if (!patchedEvalWorkerBlobUrlPromise) {
    patchedEvalWorkerBlobUrlPromise = fetch(evalWebWorkerBlobUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load tscircuit eval worker: ${response.status}`);
        }
        return response.text();
      })
      .then((workerSource) => URL.createObjectURL(new Blob([
        PCB_EVAL_WORKER_POLYFILL_SOURCE,
        "\n",
        workerSource,
      ], { type: "application/javascript" })));
  }
  return patchedEvalWorkerBlobUrlPromise;
}

function buildRunframePreviewBootstrapSource({
  circuitJson,
  previewProps,
  manifoldModuleUrl,
  manifoldWasmUrl,
}) {
  const embeddedCircuitJson = serializeJavaScriptLiteral(normalizeCircuitJsonPayload(circuitJson));
  const embeddedPreviewProps = serializeJavaScriptLiteral(sanitizeRunframePreviewProps(previewProps));
  const embeddedManifoldModuleUrl = serializeJavaScriptLiteral(manifoldModuleUrl);
  const embeddedManifoldWasmUrl = serializeJavaScriptLiteral(manifoldWasmUrl);

  return PCB_RUNFRAME_PREVIEW_BOOTSTRAP_SOURCE
    .replace(
      "(function () {",
      `(function () {\n  var embeddedCircuitJson = ${embeddedCircuitJson};\n  var embeddedPreviewProps = ${embeddedPreviewProps};\n  var embeddedManifoldModuleUrl = ${embeddedManifoldModuleUrl};\n  var embeddedManifoldWasmUrl = ${embeddedManifoldWasmUrl};`,
    )
    .replace(
      `  window.CIRCUIT_JSON = normalizeCircuitJson(readJsonScript("circuit-json", []));
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(readJsonScript("preview-props", {}));`,
      `  window.CIRCUIT_JSON = normalizeCircuitJson(embeddedCircuitJson);
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(embeddedPreviewProps);`,
    );
}

const PCB_RUNFRAME_PREVIEW_BOOTSTRAP_SOURCE = `
(function () {
  var noopScriptUrl = null;
  function readJsonScript(id, fallback) {
    var element = document.getElementById(id);
    if (!element) {
      return fallback;
    }
    try {
      return JSON.parse(element.textContent || "");
    } catch (error) {
      console.error("Failed to parse PCB preview payload", error);
      return fallback;
    }
  }
  function normalizeCircuitJson(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(value && value.circuitJson)) {
      return value.circuitJson;
    }
    if (Array.isArray(value && value.circuit_json)) {
      return value.circuit_json;
    }
    if (Array.isArray(value && value.elements)) {
      return value.elements;
    }
    return [];
  }
  function sanitizePreviewProps(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    delete value.circuitJson;
    delete value.circuit_json;
    delete value.elements;
    return value;
  }
  function releaseWebglContexts() {
    var canvases = document.querySelectorAll ? document.querySelectorAll("canvas") : [];
    for (var index = 0; index < canvases.length; index += 1) {
      var canvas = canvases[index];
      ["webgl2", "webgl", "experimental-webgl"].forEach(function (contextType) {
        try {
          var context = canvas.getContext && canvas.getContext(contextType);
          if (context && typeof context.isContextLost === "function" && context.isContextLost()) {
            return;
          }
          var extension = context && context.getExtension && context.getExtension("WEBGL_lose_context");
          if (extension && typeof extension.loseContext === "function") {
            extension.loseContext();
          }
        } catch {}
      });
    }
    try {
      window.TSCIRCUIT_3D_OBJECT_REF = undefined;
    } catch {}
  }
  window.addEventListener("pagehide", releaseWebglContexts);
  window.addEventListener("beforeunload", releaseWebglContexts);
  function isPostpigUrl(value) {
    try {
      return new URL(String(value), window.location.href).hostname === "postpig.tscircuit.com";
    } catch {
      return false;
    }
  }
  function getNoopScriptUrl() {
    if (!noopScriptUrl) {
      noopScriptUrl = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
    }
    return noopScriptUrl;
  }
  function resolveAssetUrl(value) {
    try {
      return new URL(value, window.location.href).href;
    } catch {}
    try {
      if (window.parent && window.parent !== window) {
        return new URL(value, window.parent.location.href).href;
      }
    } catch {}
    try {
      return new URL(value, document.baseURI).href;
    } catch {}
    return value;
  }
  var originalFetch = window.fetch && window.fetch.bind(window);
  if (originalFetch) {
    window.fetch = function (input, init) {
      var target = typeof input === "string" ? input : input && input.url;
      if (isPostpigUrl(target)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return originalFetch(input, init);
    };
  }
  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isPostpigUrl(url)) {
        return true;
      }
      return originalSendBeacon(url, data);
    };
  }
  if (window.XMLHttpRequest) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__diffforgeBlockedPostpig = isPostpigUrl(url);
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      if (this.__diffforgeBlockedPostpig) {
        return;
      }
      return originalSend.apply(this, arguments);
    };
  }
  if (window.HTMLScriptElement) {
    var srcDescriptor = Object.getOwnPropertyDescriptor(window.HTMLScriptElement.prototype, "src");
    var originalSetAttribute = window.HTMLScriptElement.prototype.setAttribute;
    if (srcDescriptor && srcDescriptor.set && srcDescriptor.get) {
      Object.defineProperty(window.HTMLScriptElement.prototype, "src", {
        configurable: true,
        enumerable: srcDescriptor.enumerable,
        get: function () {
          return srcDescriptor.get.call(this);
        },
        set: function (value) {
          return srcDescriptor.set.call(this, isPostpigUrl(value) ? getNoopScriptUrl() : value);
        },
      });
    }
    window.HTMLScriptElement.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "src" && isPostpigUrl(value)) {
        return originalSetAttribute.call(this, name, getNoopScriptUrl());
      }
      return originalSetAttribute.apply(this, arguments);
    };
  }
  if (!window.ManifoldModule) {
    window.ManifoldModule = function () {
      var localManifoldModuleUrl = resolveAssetUrl(embeddedManifoldModuleUrl);
      var localManifoldWasmUrl = resolveAssetUrl(embeddedManifoldWasmUrl);
      return import(localManifoldModuleUrl).then(function (module) {
        if (!module || typeof module.default !== "function") {
          throw new Error("Local Manifold module did not export a default initializer.");
        }
        return module.default({
          locateFile: function (path) {
            return String(path).endsWith(".wasm") ? localManifoldWasmUrl : resolveAssetUrl(path);
          },
        });
      });
    };
  }
  window.CIRCUIT_JSON = normalizeCircuitJson(readJsonScript("circuit-json", []));
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(readJsonScript("preview-props", {}));
})();
`;

let pcbRenderQueue = Promise.resolve();

function enqueuePcbRender(task) {
  const run = pcbRenderQueue.then(task, task);
  pcbRenderQueue = run.catch(() => {});
  return run;
}

function createPcbRenderCancelledError() {
  const error = new Error(PCB_RENDER_CANCELLED_MESSAGE);
  error.name = "AbortError";
  return error;
}

function isPcbRenderCancelledError(error) {
  return error?.name === "AbortError" && error?.message === PCB_RENDER_CANCELLED_MESSAGE;
}

function releasePreviewFrameWebGlContexts(frame) {
  let frameDocument = null;
  try {
    frameDocument = frame?.contentDocument || frame?.contentWindow?.document || null;
  } catch {
    frameDocument = null;
  }
  if (!frameDocument) {
    return;
  }
  const canvases = frameDocument.querySelectorAll?.("canvas") || [];
  canvases.forEach((canvas) => {
    ["webgl2", "webgl", "experimental-webgl"].forEach((contextType) => {
      try {
        const context = canvas.getContext?.(contextType);
        if (context && !context.isContextLost?.()) {
          context.getExtension?.("WEBGL_lose_context")?.loseContext?.();
        }
      } catch {
        // Losing old preview contexts is best-effort; the new frame is the source of truth.
      }
    });
  });
  try {
    if (frame?.contentWindow) {
      frame.contentWindow.TSCIRCUIT_3D_OBJECT_REF = undefined;
    }
  } catch {}
}

function resetPreviewFrame(frame) {
  if (!frame) {
    return;
  }
  releasePreviewFrameWebGlContexts(frame);
  try {
    frame.srcdoc = "<!doctype html><html><body></body></html>";
  } catch {}
  try {
    frame.removeAttribute("srcdoc");
  } catch {}
  try {
    frame.src = "about:blank";
  } catch {}
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizePcbTab(tab) {
  return PCB_TABS.includes(tab) ? tab : "pcb";
}

function normalizeCircuitJsonPayload(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.circuitJson)) {
    return value.circuitJson;
  }
  if (Array.isArray(value?.circuit_json)) {
    return value.circuit_json;
  }
  if (Array.isArray(value?.elements)) {
    return value.elements;
  }
  return [];
}

function sanitizeRunframePreviewProps(value) {
  const props = { ...(value || {}) };
  delete props.circuitJson;
  delete props.circuit_json;
  delete props.elements;
  return props;
}

function getErrorMessage(error) {
  if (!error) {
    return "Unknown renderer error";
  }
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "object" && "message" in error) {
    return String(error.message || error);
  }
  return String(error);
}

function getWorkerEventMessage(event) {
  if (event?.message) {
    return event.message;
  }
  if (event?.error) {
    return getErrorMessage(event.error);
  }
  return `PCB renderer worker failed${event?.type ? ` (${event.type})` : ""}`;
}

function withTimeout(promise, label, timeoutMs = PCB_RENDER_TIMEOUT_MS) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out while ${label}.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout])
    .finally(() => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    });
}

function buildPreviewSrcDoc({
  bootstrapUrl,
  scriptUrl,
}) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #ffffff;
      }
      [role="tablist"].rf-h-9,
      .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
        display: none !important;
      }
      .rf-min-h-\\[620px\\],
      .rf-min-h-\\[calc\\(100vh-240px\\)\\] {
        min-height: 0 !important;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="${escapeHtmlAttribute(bootstrapUrl)}"></script>
    <script src="${escapeHtmlAttribute(scriptUrl)}"></script>
  </body>
</html>`;
}

const PanelShell = styled.section`
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  width: 100%;
  background: #07101d;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  overflow: hidden;

  &[data-embedded="true"] {
    border: 0;
    border-radius: 0;
  }

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.4);
  }
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.6);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  flex: 0 0 auto;
`;

const PanelTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #a7f3d0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PanelActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
`;

const HeaderButton = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: #cbd5f5;
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #ffffff;
  }
`;

const PanelBody = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

const ViewTabRail = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 0 0 auto;
  min-width: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(3, 7, 18, 0.88);
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.35) transparent;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.35);
    border-radius: 999px;
  }
`;

const ViewTabButton = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.56);
  color: #aeb7c8;
  border-radius: 6px;
  height: 24px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
  cursor: pointer;

  &:hover {
    border-color: rgba(147, 197, 253, 0.45);
    color: #eef4ff;
    background: rgba(30, 41, 59, 0.86);
  }

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.62);
    background: rgba(37, 99, 235, 0.22);
    color: #dbeafe;
    box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.18);
  }
`;

const RunFrameSurface = styled.div`
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;

  [role="tablist"].rf-h-9,
  .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
    display: none !important;
  }

  .rf-min-h-\\[620px\\],
  .rf-min-h-\\[calc\\(100vh-240px\\)\\] {
    min-height: 0 !important;
  }

  .rf-h-full,
  .rf-flex-grow {
    min-height: 0;
  }
`;

const PreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #ffffff;
`;

function ManagedPreviewFrame({ onFrame = null, srcDoc, title }) {
  const frameRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const frame = frameRef.current;
    onFrameRef.current?.(frame);
    return () => {
      onFrameRef.current?.(null);
      resetPreviewFrame(frame);
    };
  }, []);

  return (
    <PreviewFrame
      ref={frameRef}
      srcDoc={srcDoc}
      title={title}
    />
  );
}

const RenderErrorBanner = styled.div`
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  right: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 6px;
  background: rgba(254, 242, 242, 0.96);
  color: #991b1b;
  font-size: 11px;
  line-height: 1.35;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);

  &[data-tone="warning"] {
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(255, 251, 235, 0.96);
    color: #92400e;
  }
`;

const PanelMessage = styled.div`
  margin: auto;
  padding: 16px;
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
  max-width: 80%;

  &[data-tone="error"] {
    color: #fca5a5;
  }
`;

export default function PcbPanel({
  board,
  embedded = false,
  repoPath,
  workspaceId = "",
  defaultTab = "pcb",
  isActive = false,
  onActivate,
  onClose,
  onElementPickerChange = null,
  onPopOut,
  showHeader = true,
}) {
  const boardPath = board?.path || "";
  const defaultTabId = normalizePcbTab(defaultTab);
  const [activeTab, setActiveTab] = useState(defaultTabId);
  const [source, setSource] = useState(null);
  const [circuitJson, setCircuitJson] = useState(null);
  const [runframePreviewBootstrap, setRunframePreviewBootstrap] = useState({ signature: "", url: "" });
  const [renderLog, setRenderLog] = useState(null);
  const [solverEvents, setSolverEvents] = useState([]);
  const [renderStatus, setRenderStatus] = useState("idle");
  const [renderError, setRenderError] = useState("");
  const [renderWarning, setRenderWarning] = useState("");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const readSeqRef = useRef(0);
  const renderSeqRef = useRef(0);
  // Element picker: the iframe owns hit-testing (bootstrap picker), the host
  // owns held selections — tab switches re-key the srcDoc and rebuild the
  // iframe, so picks are merged across iframe sessions here.
  const pickerFrameRef = useRef(null);
  const pickerEnabledRef = useRef(false);
  const pickerSessionIdsRef = useRef(new Set());
  const [pickerEnabled, setPickerEnabled] = useState(false);
  const [pickerThreeD, setPickerThreeD] = useState(false);
  const [pickerHeldSelections, setPickerHeldSelections] = useState([]);
  const normalizedRepoPath = useMemo(() => normalizeRepoIdentity(repoPath), [repoPath]);
  const fsMap = useMemo(() => {
    if (typeof source !== "string") {
      return null;
    }
    return { [PCB_MAIN_FILE_PATH]: source };
  }, [source]);
  const partsEngineLocalCache = useMemo(() => (
    fsMap ? createPcbPartsEngineLocalCache(fsMap) : null
  ), [fsMap]);
  const previewProps = useMemo(() => ({
    allowSelectingVersion: false,
    availableTabs: PCB_TABS,
    code: source || "",
    defaultActiveTab: activeTab,
    defaultTab: activeTab,
    errorMessage: null,
    errorStack: null,
    fsMap: fsMap || {},
    isRunningCode: false,
    isWebEmbedded: true,
    projectName: board?.name || boardPath || "PCB",
    renderLog: null,
    showCodeTab: false,
    showFileMenu: false,
    showImportAndFormatButtons: false,
    showRenderLogTab: true,
    showRightHeaderContent: false,
    showToggleFullScreen: false,
    solverEvents: [],
  }), [activeTab, board?.name, boardPath, fsMap, source]);
  const circuitJsonSignature = useMemo(() => (
    circuitJson ? hashString(serializeJavaScriptLiteral(normalizeCircuitJsonPayload(circuitJson))) : ""
  ), [circuitJson]);
  const previewPayloadSignature = useMemo(() => (
    circuitJsonSignature
      ? hashString(`${circuitJsonSignature}\0${serializeJavaScriptLiteral(previewProps)}`)
      : ""
  ), [circuitJsonSignature, previewProps]);
  const previewFrameKey = useMemo(() => (
    `${boardPath}:${previewPayloadSignature}`
  ), [boardPath, previewPayloadSignature]);
  const previewSrcDoc = useMemo(() => {
    if (
      !circuitJson
      || !previewPayloadSignature
      || !runframePreviewBootstrap.url
      || runframePreviewBootstrap.signature !== previewPayloadSignature
    ) {
      return "";
    }
    return buildPreviewSrcDoc({
      bootstrapUrl: runframePreviewBootstrap.url,
      scriptUrl: runframeStandalonePreviewUrl,
    });
  }, [circuitJson, previewPayloadSignature, runframePreviewBootstrap.signature, runframePreviewBootstrap.url]);

  useEffect(() => {
    setActiveTab(defaultTabId);
  }, [boardPath, defaultTabId]);

  useEffect(() => {
    if (!circuitJson || !previewPayloadSignature) {
      setRunframePreviewBootstrap({ signature: "", url: "" });
      return undefined;
    }
    const bootstrapUrl = URL.createObjectURL(new Blob(
      [buildRunframePreviewBootstrapSource({
        circuitJson,
        previewProps,
        manifoldModuleUrl: resolveRuntimeAssetUrl(manifoldModuleUrl),
        manifoldWasmUrl: resolveRuntimeAssetUrl(manifoldWasmUrl),
      })],
      { type: "text/javascript" },
    ));
    setRunframePreviewBootstrap({ signature: previewPayloadSignature, url: bootstrapUrl });
    return () => {
      URL.revokeObjectURL(bootstrapUrl);
    };
  }, [circuitJson, previewPayloadSignature, previewProps]);

  const postPickerAction = useCallback((action) => {
    pickerFrameRef.current?.contentWindow?.postMessage(
      { action, type: "diffforge:pcb:element-picker" },
      "*",
    );
  }, []);

  useEffect(() => {
    const handlePickerMessage = (event) => {
      const frame = pickerFrameRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== "diffforge:pcb:element-picker-state") {
        return;
      }
      setPickerThreeD(Boolean(data.capabilities?.threeD));
      const reason = String(data.reason || "");
      if (reason === "ready") {
        // Fresh iframe session (first load or tab-switch rebuild): its
        // selection list starts empty; re-arm if the user had the pointer on.
        pickerSessionIdsRef.current = new Set();
        if (pickerEnabledRef.current) {
          postPickerAction("enable");
        }
        return;
      }
      if (reason === "clear" || reason === "escape") {
        pickerSessionIdsRef.current = new Set();
        setPickerHeldSelections([]);
        if (reason === "escape") {
          pickerEnabledRef.current = false;
          setPickerEnabled(false);
        }
        return;
      }
      if (reason === "disable") {
        pickerEnabledRef.current = false;
        setPickerEnabled(false);
      } else if (reason === "enable") {
        pickerEnabledRef.current = true;
        setPickerEnabled(true);
      }
      const selections = (Array.isArray(data.selections) ? data.selections : [])
        .filter((item) => item && typeof item === "object" && item.id);
      const previousSessionIds = pickerSessionIdsRef.current;
      const messageIds = new Set(selections.map((item) => item.id));
      setPickerHeldSelections((current) => {
        // Items unpicked in the live iframe session drop; picks held from
        // earlier sessions stay; new picks append. Cap keeps latest 3.
        const kept = current.filter((item) => (
          !previousSessionIds.has(item.id) || messageIds.has(item.id)
        ));
        const knownIds = new Set(kept.map((item) => item.id));
        const next = [...kept, ...selections.filter((item) => !knownIds.has(item.id))];
        return next.length > 3 ? next.slice(next.length - 3) : next;
      });
      pickerSessionIdsRef.current = messageIds;
    };
    window.addEventListener("message", handlePickerMessage);
    return () => window.removeEventListener("message", handlePickerMessage);
  }, [postPickerAction]);

  useEffect(() => {
    pickerSessionIdsRef.current = new Set();
    setPickerHeldSelections([]);
    pickerEnabledRef.current = false;
    setPickerEnabled(false);
  }, [boardPath]);

  const togglePicker = useCallback(() => {
    if (pickerEnabledRef.current) {
      pickerEnabledRef.current = false;
      setPickerEnabled(false);
      postPickerAction("disable");
      return;
    }
    pickerEnabledRef.current = true;
    setPickerEnabled(true);
    postPickerAction("enable");
  }, [postPickerAction]);

  const clearPicker = useCallback(() => {
    pickerSessionIdsRef.current = new Set();
    setPickerHeldSelections([]);
    postPickerAction("clear");
  }, [postPickerAction]);

  const pickerContexts = useMemo(() => {
    if (!pickerHeldSelections.length) {
      return [];
    }
    return normalizePcbElementContexts(pickerHeldSelections
      .map((pick) => resolvePcbPickedElementContext(pick, {
        boardPath,
        boardTitle: board?.name || "",
        circuitJson,
        source,
      }))
      .filter(Boolean));
  }, [board?.name, boardPath, circuitJson, pickerHeldSelections, source]);

  useEffect(() => {
    if (typeof onElementPickerChange !== "function") {
      return;
    }
    onElementPickerChange({
      clear: clearPicker,
      contexts: pickerContexts,
      count: pickerContexts.length,
      enabled: pickerEnabled,
      threeD: pickerThreeD,
      toggle: togglePicker,
    });
  }, [clearPicker, onElementPickerChange, pickerContexts, pickerEnabled, pickerThreeD, togglePicker]);

  const readSource = useCallback(() => {
    const readSeq = readSeqRef.current + 1;
    readSeqRef.current = readSeq;
    if (!repoPath || !boardPath) {
      return;
    }
    invoke("pcb_document_read", { repoPath, boardPath, workspaceId })
      .then((doc) => {
        if (readSeqRef.current !== readSeq) {
          return;
        }
        setSource(typeof doc?.source === "string" ? doc.source : "");
        setCircuitJson(null);
        setRenderLog(null);
        setRenderError("");
        setRenderWarning("");
        setSolverEvents([]);
        setRenderStatus("idle");
        setStatus("ready");
        setError("");
      })
      .catch((err) => {
        if (readSeqRef.current !== readSeq) {
          return;
        }
        setError(String(err));
        setStatus("error");
      });
  }, [repoPath, boardPath, workspaceId]);

  useEffect(() => {
    setStatus("loading");
    setSource(null);
    setCircuitJson(null);
    setRenderLog(null);
    setRenderError("");
    setRenderWarning("");
    setSolverEvents([]);
    setRenderStatus("idle");
    readSource();
  }, [readSource]);

  useEffect(() => {
    if (!fsMap) {
      return undefined;
    }
    const renderSeq = renderSeqRef.current + 1;
    renderSeqRef.current = renderSeq;
    let cancelled = false;
    let worker = null;
    let abortRender = () => {};
    let cleanupWorkerErrorListeners = () => {};

    const isCurrent = () => !cancelled && renderSeqRef.current === renderSeq;
    const throwIfCancelled = () => {
      if (!isCurrent()) {
        throw createPcbRenderCancelledError();
      }
    };
    const updateRenderLog = (updater) => {
      if (!isCurrent()) {
        return;
      }
      setRenderLog((previous) => updater(previous || {
        debugOutputs: [],
        eventsProcessed: 0,
        progress: 0,
        renderEvents: [],
      }));
    };

    const renderBoard = async () => {
      if (!isCurrent()) {
        return;
      }
      const renderAbortPromise = new Promise((_, reject) => {
        abortRender = () => reject(createPcbRenderCancelledError());
      });
      let latestCircuitJson = null;
      setCircuitJson(null);
      setRenderError("");
      setRenderWarning("");
      setRenderLog({
        debugOutputs: [],
        eventsProcessed: 0,
        progress: 0,
        renderEvents: [],
      });
      setSolverEvents([]);
      setRenderStatus("rendering");
      try {
        installPcbPartsEngineFetchRetry();
        const patchedEvalWorkerBlobUrl = await withTimeout(
          Promise.race([getPatchedEvalWorkerBlobUrl(), renderAbortPromise]),
          "preparing PCB renderer worker",
        );
        throwIfCancelled();
        worker = await withTimeout(Promise.race([createCircuitWebWorker({
          easyEdaProxyConfig: {
            proxyEndpointUrl: PCB_EASYEDA_PROXY_ENDPOINT_URL,
          },
          enableFetchProxy: true,
          projectConfig: {
            ...(partsEngineLocalCache ? { localCacheEngine: partsEngineLocalCache } : {}),
            projectBaseUrl: normalizedRepoPath || repoPath || "",
          },
          verbose: false,
          webWorkerBlobUrl: patchedEvalWorkerBlobUrl,
        }), renderAbortPromise]), "starting PCB renderer worker");
        throwIfCancelled();
        const workerErrorPromise = new Promise((_, reject) => {
          const rawWorker = worker?.__rawWorker;
          if (!rawWorker?.addEventListener) {
            return;
          }
          const handleWorkerError = (event) => {
            reject(new Error(getWorkerEventMessage(event)));
          };
          rawWorker.addEventListener("error", handleWorkerError);
          rawWorker.addEventListener("messageerror", handleWorkerError);
          cleanupWorkerErrorListeners = () => {
            rawWorker.removeEventListener("error", handleWorkerError);
            rawWorker.removeEventListener("messageerror", handleWorkerError);
          };
        });
        const runWorkerStep = async (promise, label) => {
          const result = await withTimeout(Promise.race([promise, workerErrorPromise, renderAbortPromise]), label);
          throwIfCancelled();
          return result;
        };
        worker.on("board:renderPhaseStarted", (event) => {
          const entry = { ...event, createdAt: Date.now() };
          updateRenderLog((previous) => {
            const eventsProcessed = (previous.eventsProcessed || 0) + 1;
            return {
              ...previous,
              eventsProcessed,
              lastRenderEvent: entry,
              progress: Math.min(0.95, Math.max(previous.progress || 0, eventsProcessed / 30)),
              renderEvents: [...(previous.renderEvents || []), entry].slice(-250),
            };
          });
        });
        worker.on("debug:logOutput", (event) => {
          updateRenderLog((previous) => ({
            ...previous,
            debugOutputs: [
              ...(previous.debugOutputs || []),
              { content: event?.content, name: event?.name, type: "debug" },
            ].slice(-100),
          }));
        });
        worker.on("solver:started", (event) => {
          if (!isCurrent()) {
            return;
          }
          setSolverEvents((previous) => [...previous, event]);
        });

        await runWorkerStep(worker.executeWithFsMap({
          fsMap,
          mainComponentPath: PCB_MAIN_FILE_PATH,
        }), "executing PCB source");
        let settledError = null;
        const settled = runWorkerStep(worker.renderUntilSettled(), "settling PCB render")
          .catch((err) => {
            settledError = err;
          });
        const initialCircuitJson = await runWorkerStep(worker.getCircuitJson(), "reading initial PCB JSON");
        latestCircuitJson = normalizeCircuitJsonPayload(initialCircuitJson);
        if (isCurrent()) {
          setCircuitJson(latestCircuitJson);
          updateRenderLog((previous) => ({
            ...previous,
            progress: Math.max(previous.progress || 0, 0.55),
          }));
        }
        await settled;
        if (settledError) {
          throw settledError;
        }
        const finalCircuitJson = await runWorkerStep(worker.getCircuitJson(), "reading final PCB JSON");
        latestCircuitJson = normalizeCircuitJsonPayload(finalCircuitJson);
        const finalIssues = summarizeCircuitJsonIssues(latestCircuitJson);
        if (isCurrent()) {
          setCircuitJson(latestCircuitJson);
          if (finalIssues.errors.length > 0) {
            setRenderStatus("error");
            setRenderError(formatCircuitJsonIssueSummary("PCB design error", finalIssues.errors));
            setRenderWarning("");
          } else {
            setRenderStatus("ready");
            setRenderError("");
            setRenderWarning(formatCircuitJsonIssueSummary("PCB design warning", finalIssues.warnings));
          }
          updateRenderLog((previous) => ({
            ...previous,
            progress: 1,
          }));
        }
      } catch (err) {
        if (isPcbRenderCancelledError(err) || !isCurrent()) {
          return;
        }
        if (isCurrent()) {
          if (latestCircuitJson?.length) {
            setCircuitJson(latestCircuitJson);
            setRenderWarning(`Partial PCB render: ${getErrorMessage(err)}`);
            setRenderStatus("ready");
          } else {
            setRenderError(getErrorMessage(err));
            setRenderWarning("");
            setRenderStatus("error");
          }
          updateRenderLog((previous) => ({
            ...previous,
            progress: previous.progress || 1,
          }));
        }
      } finally {
        abortRender = () => {};
        cleanupWorkerErrorListeners();
        try {
          await worker?.clearEventListeners?.();
        } catch {
          // Best-effort cleanup; render errors above are the useful user signal.
        }
        try {
          await worker?.kill?.();
        } catch {
          // A newer render may have already replaced the global eval worker.
        }
      }
    };

    void enqueuePcbRender(renderBoard);

    return () => {
      cancelled = true;
      abortRender();
      try {
        Promise.resolve(worker?.kill?.()).catch(() => {});
      } catch {
        // Worker cleanup is best effort during live reload churn.
      }
    };
  }, [fsMap, normalizedRepoPath, partsEngineLocalCache, repoPath]);

  // Live reload: re-read when the watcher reports this board changed on disk.
  useEffect(() => {
    if (!boardPath) {
      return undefined;
    }
    let unlisten;
    let cancelled = false;
    listen(PCB_STORE_CHANGED_EVENT, (event) => {
      const paths = event?.payload?.paths;
      const eventRepo = normalizeRepoIdentity(event?.payload?.repoPath);
      const eventWorkspace = String(event?.payload?.workspaceId || event?.payload?.workspace_id || "").trim();
      if (eventRepo && eventRepo !== normalizedRepoPath) {
        return;
      }
      if (eventWorkspace && workspaceId && eventWorkspace !== workspaceId) {
        return;
      }
      if (Array.isArray(paths) && paths.includes(boardPath)) {
        readSource();
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [boardPath, normalizedRepoPath, readSource, repoPath, workspaceId]);

  return (
    <PanelShell
      data-active={isActive ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      onMouseDown={onActivate}
    >
      {showHeader ? (
        <PanelHeader>
          <PanelTitle title={boardPath}>{board?.name || "PCB"}</PanelTitle>
          <PanelActions>
            {onPopOut ? (
              <HeaderButton
                aria-label="Open in new window"
                onClick={() => onPopOut(board)}
                title="Open in new window"
                type="button"
              >
                ⤢
              </HeaderButton>
            ) : null}
            {onClose ? (
              <HeaderButton
                aria-label="Close board"
                onClick={() => onClose(board)}
                title="Close"
                type="button"
              >
                ×
              </HeaderButton>
            ) : null}
          </PanelActions>
        </PanelHeader>
      ) : null}
      <ViewTabRail aria-label="PCB view selector">
        {PCB_VIEW_TABS.map((tab) => (
          <ViewTabButton
            aria-pressed={activeTab === tab.id}
            data-active={activeTab === tab.id ? "true" : undefined}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            type="button"
          >
            {tab.label}
          </ViewTabButton>
        ))}
      </ViewTabRail>
      <PanelBody>
        {status === "error" ? (
          <PanelMessage data-tone="error">Could not load board: {error}</PanelMessage>
        ) : source == null ? (
          <PanelMessage>Loading board…</PanelMessage>
        ) : renderStatus === "error" && !circuitJson ? (
          <PanelMessage data-tone="error">Could not render board: {renderError}</PanelMessage>
        ) : !circuitJson || !previewSrcDoc ? (
          <PanelMessage>Rendering board…</PanelMessage>
        ) : (
          <RunFrameSurface>
            {renderError || renderWarning ? (
              <RenderErrorBanner data-tone={renderError ? "error" : "warning"}>
                {renderError ? "PCB renderer error" : "PCB renderer warning"}: {renderError || renderWarning}
              </RenderErrorBanner>
            ) : null}
            <ManagedPreviewFrame
              key={previewFrameKey}
              onFrame={(frame) => {
                pickerFrameRef.current = frame;
              }}
              srcDoc={previewSrcDoc}
              title={`${board?.name || "PCB"} renderer`}
            />
          </RunFrameSurface>
        )}
      </PanelBody>
    </PanelShell>
  );
}
