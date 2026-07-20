import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmailProfileSaveRequest,
  describeEmailProfile,
  EMAIL_MODE_NATIVE,
  EMAIL_MODE_PROVIDER,
  EMAIL_PREFLIGHT_CHECK_LABELS,
  EMAIL_SMTP_SECURITY_IMPLICIT,
  EMAIL_SMTP_SECURITY_STARTTLS,
} from "./emailDeliveryContract.js";

test("provider save request derives TLS mode from standard ports", () => {
  const { request: starttls } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.gmail.com",
    smtp_port: "587",
  });
  assert.equal(starttls.smtp_security, EMAIL_SMTP_SECURITY_STARTTLS);

  const { request: implicit } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.gmail.com",
    smtp_port: "465",
  });
  assert.equal(implicit.smtp_security, EMAIL_SMTP_SECURITY_IMPLICIT);

  // Non-standard port with no explicit choice fails closed — plaintext is
  // never an option.
  const { error } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.example.com",
    smtp_port: "2525",
  });
  assert.match(error, /STARTTLS or implicit TLS/);
});

test("secret is write-only: absent key preserves, empty clears, value sets", () => {
  // Untouched form (no `secret` key): the request must NOT carry one, so
  // the backend keeps the stored secret (save-doesn't-blank).
  const { request: untouched } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.example.com",
    smtp_port: "587",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(untouched, "secret"),
    false,
  );

  // Explicit clear.
  const { request: cleared } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.example.com",
    smtp_port: "587",
    secret: "",
  });
  assert.equal(cleared.secret, "");

  // Deliberate set.
  const { request: set } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_PROVIDER,
    smtp_host: "smtp.example.com",
    smtp_port: "587",
    secret: "app-password",
  });
  assert.equal(set.secret, "app-password");
});

test("validation rejects malformed hosts, ports, and addresses", () => {
  assert.match(
    buildEmailProfileSaveRequest({ mode: EMAIL_MODE_PROVIDER }).error,
    /SMTP host/,
  );
  assert.match(
    buildEmailProfileSaveRequest({
      mode: EMAIL_MODE_PROVIDER,
      smtp_host: "smtp example.com",
    }).error,
    /spaces/,
  );
  assert.match(
    buildEmailProfileSaveRequest({
      mode: EMAIL_MODE_PROVIDER,
      smtp_host: "smtp.example.com",
      smtp_port: "70000",
    }).error,
    /between 1 and 65535/,
  );
  assert.match(
    buildEmailProfileSaveRequest({
      mode: EMAIL_MODE_PROVIDER,
      smtp_host: "smtp.example.com",
      smtp_port: "587",
      from_address: "not-an-address",
    }).error,
    /full email address/,
  );
});

test("native mode needs no SMTP endpoint", () => {
  const { request, error } = buildEmailProfileSaveRequest({
    mode: EMAIL_MODE_NATIVE,
    from_address: "ops@acme.example",
  });
  assert.equal(error, undefined);
  assert.equal(request.mode, EMAIL_MODE_NATIVE);
  assert.equal(request.smtp_host, null);
});

test("profile descriptors stay compact", () => {
  assert.equal(
    describeEmailProfile({
      mode: EMAIL_MODE_PROVIDER,
      from_address: "ops@acme.example",
      smtp_host: "smtp.gmail.com",
      smtp_port: 587,
    }),
    "ops@acme.example via smtp.gmail.com:587",
  );
  assert.equal(
    describeEmailProfile({ mode: EMAIL_MODE_NATIVE, from_address: "ops@acme.example" }),
    "Native · ops@acme.example",
  );
});

test("preflight label registry covers the closed 14-check set", () => {
  // email-v1 §10.2: exactly these 14 ids.
  const ids = Object.keys(EMAIL_PREFLIGHT_CHECK_LABELS);
  assert.equal(ids.length, 14);
  for (const id of [
    "public_ip",
    "static_ip",
    "port25_egress",
    "ptr_fcrdns",
    "helo_hostname",
    "dnsbl_clean",
    "always_on",
    "clock_skew",
    "journal_health",
    "credential_store",
    "spf_published",
    "dkim_published",
    "dmarc_published",
    "seed_test",
  ]) {
    assert.ok(ids.includes(id), id);
  }
});
