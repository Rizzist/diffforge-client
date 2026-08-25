import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SessionAvailabilityAffordance,
  sessionAvailabilityPresentation,
} from "./sessionAvailability.js";

const CATEGORIES = [
  {
    reason: "daemon-unavailable",
    label: "Daemon unavailable",
    detail: "Haider is unavailable, so this session could not be confirmed in the published roster.",
  },
  {
    reason: "not-published",
    label: "Not published",
    detail: "This local session has not been published by Haider yet.",
  },
  {
    reason: "legacy-provenance",
    label: "Legacy provenance",
    detail: "This session has legacy provenance, so Haider availability cannot be verified.",
  },
];

test("session availability keeps daemon, publication, and provenance failures distinct", () => {
  for (const expected of CATEGORIES) {
    assert.deepEqual(
      sessionAvailabilityPresentation({
        session_availability: "unavailable",
        session_availability_reason: expected.reason,
      }),
      {
        ...expected,
        ariaLabel: `Session unavailable: ${expected.label}`,
      },
    );
  }
});

test("availability affordance renders each categorical reason into visible and tooltip text", () => {
  const rendered = CATEGORIES.map(({ reason, label, detail }) => {
    const markup = renderToStaticMarkup(SessionAvailabilityAffordance({
      session: {
        session_availability: "unavailable",
        session_availability_reason: reason,
      },
    }));
    assert.match(markup, new RegExp(`data-session-availability="${reason}"`));
    assert.ok(markup.includes(`>${label}</span>`), `${reason} did not render its label`);
    assert.ok(markup.includes(`title="${detail}"`), `${reason} did not render its tooltip`);
    return markup;
  });
  assert.equal(new Set(rendered).size, CATEGORIES.length);
});

test("[pin] an absent reason is rendered as unknown, never fabricated into a category", () => {
  const presentation = sessionAvailabilityPresentation({
    session_availability: "unavailable",
    session_availability_reason: null,
  });
  assert.equal(presentation.reason, "unknown");
  assert.equal(presentation.ariaLabel, "Session unavailable: reason unknown");
  assert.equal(
    presentation.detail,
    "This session is unavailable; the daemon did not publish a reason.",
  );
  assert.notEqual(presentation.reason, "unavailable");
});

test("[pin] an unrecognized published reason token is carried verbatim, not rewritten", () => {
  const presentation = sessionAvailabilityPresentation({
    session_availability: "unavailable",
    session_availability_reason: "future-category-v9",
  });
  assert.equal(presentation.reason, "future-category-v9");
  assert.match(presentation.detail, /"future-category-v9"/);
  assert.doesNotMatch(presentation.detail, /future category v9/);
});

test("available sessions render no unavailable affordance", () => {
  assert.equal(
    renderToStaticMarkup(SessionAvailabilityAffordance({
      session: { session_availability: "available", session_availability_reason: null },
    })),
    "",
  );
});

test("rail and session surface render the shared categorical presentation", () => {
  const rail = readFileSync(new URL("./SessionsRail.jsx", import.meta.url), "utf8");
  const surface = readFileSync(new URL("./SessionSurface.jsx", import.meta.url), "utf8");

  assert.match(
    rail,
    /<RailAvailabilityAffordance\s+session=\{session\}\s*\/>/,
    "rail rows must render the typed availability affordance",
  );
  assert.match(
    surface,
    /const availability =[\s\S]*?sessionAvailabilityPresentation\(session\)[\s\S]*?data-session-availability=\{availability\?\.reason\}/,
    "active-session status pill must render the typed availability category",
  );
  assert.match(surface, /<span>\{availability\?\.label \|\| statusLine\}<\/span>/);
  assert.match(
    surface,
    /<HomeAvailabilityAffordance\s+session=\{session\}\s*\/>/,
    "Home/Continue rows must render the typed availability affordance",
  );
});
