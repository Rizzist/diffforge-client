import assert from "node:assert/strict";
import test from "node:test";
import {
  accountAuthMethodLabel,
  accountListPresentation,
  buildCommandSlots,
  credentialStatus,
  librarySnapshotNeedsRetry,
  modelGroupsFromLibrary,
  modelOptionCatalog,
  providerAuthOptions,
} from "./haiderClientContract.js";

test("command slots use the contract's exact five pair arrays", () => {
  assert.deepEqual(buildCommandSlots({
    providers: [{ provider: "openai" }],
    models: [{ provider: "openai", model: "gpt-test" }],
    accounts: [{ alias: "work", label: "Work account" }],
    efforts: ["high"],
    custom_commands: [{ name: "release", description: "Ship it" }],
  }), {
    providers: [["openai", "openai"]],
    models: [["openai/gpt-test", "openai · gpt-test"]],
    accounts: [["work", "Work account"]],
    efforts: [["high", "high"]],
    custom_commands: [["release", "Ship it"]],
  });
});

test("only a v3 pre-handshake catalog placeholder retries", () => {
  assert.equal(librarySnapshotNeedsRetry(null), true);
  assert.equal(librarySnapshotNeedsRetry({ version: 3, providers: null }), true);
  assert.equal(librarySnapshotNeedsRetry({ version: 3, providers: [] }), false);
  assert.equal(librarySnapshotNeedsRetry({ version: 2, models: [] }), false);
});

test("model groups retain unavailable providers even when they publish no models", () => {
  assert.deepEqual(modelGroupsFromLibrary({
    providers: [
      {
        provider: "available-provider",
        availability: "available",
        enabled: true,
        models: ["model-a"],
      },
      {
        provider: "empty-unavailable-provider",
        availability: "unavailable",
        enabled: true,
        models: [],
      },
      {
        provider: "disabled-provider",
        availability: "available",
        enabled: false,
        models: ["model-b"],
      },
    ],
    models: [
      { provider: "available-provider", model: "model-a", available: true },
      { provider: "disabled-provider", model: "model-b", available: false },
    ],
  }), [
    {
      provider: "available-provider",
      available: true,
      status: "ready",
      models: ["model-a"],
    },
    {
      provider: "disabled-provider",
      available: false,
      status: "unavailable",
      models: ["model-b"],
    },
    {
      provider: "empty-unavailable-provider",
      available: false,
      status: "unavailable",
      models: [],
    },
  ]);
});

test("account availability distinguishes empty from unavailable and legacy unknown", () => {
  assert.equal(accountListPresentation({
    descriptors: [],
    availability: { state: "available" },
  }).state, "empty");
  assert.equal(accountListPresentation({
    descriptors: [],
    availability: { state: "unavailable", reason: "vault_down" },
  }).state, "unavailable");
  assert.equal(accountListPresentation({ descriptors: [], revision: 0 }).state, "legacy_unknown");
  assert.equal(accountListPresentation({
    descriptors: [],
    availability: { state: "unknown" },
  }).state, "unknown");
});

test("account labels do not invent credential status or authentication method", () => {
  assert.equal(credentialStatus({}), "unknown");
  assert.equal(accountAuthMethodLabel({}), "Unknown authentication");
  assert.equal(accountAuthMethodLabel({ auth_method: "oauth" }), "OAuth");
  assert.equal(accountAuthMethodLabel({ auth_method: "api_key" }), "API key");
});

test("provider choices come only from provider.list auth_methods", () => {
  const library = {
    providers: [
      { provider: "oauth-provider", auth_methods: ["oauth"] },
      { provider: "key-provider", auth_methods: ["api_key"] },
      { provider: "unknown-provider" },
    ],
  };
  assert.deepEqual(providerAuthOptions(library, "oauth"), ["oauth-provider"]);
  assert.deepEqual(providerAuthOptions(library, "api_key"), ["key-provider"]);
});

test("composer catalogs come from the selected model detail verbatim", () => {
  const catalog = modelOptionCatalog({
    models: [{
      provider: "openai",
      model: "gpt-5.6-sol",
      supported_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      supported_speeds: ["normal", "fast", "warp"],
    }],
  }, "openai", "gpt-5.6-sol");

  assert.deepEqual(catalog, {
    effort: ["low", "medium", "high", "xhigh", "max", "ultra"],
    speed: ["normal", "fast", "warp"],
    speedApplicable: true,
  });
  assert.deepEqual(modelOptionCatalog({ models: [] }, "openai", "missing"), {
    effort: [],
    speed: [],
    speedApplicable: false,
  });
});
