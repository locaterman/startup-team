import assert from "node:assert/strict";
import test from "node:test";
import { all, api, setCsrf } from "../src/api.ts";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("paginates a filtered resource until the cursor is exhausted", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return json({
      items: [{ id: "a" }], next_cursor: "next-one",
    });
    return json({ items: [{ id: "b" }], next_cursor: null });
  };
  try {
    assert.deepEqual(await all("/startups?scope=public"), [{ id: "a" }, { id: "b" }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "/api/v1/startups?scope=public&limit=100");
    assert.equal(
      requests[1].url,
      "/api/v1/startups?scope=public&limit=100&cursor=next-one",
    );
    assert(requests.every((request) => request.options.credentials === "same-origin"));
  } finally {
    globalThis.fetch = previous;
  }
});

test("cursor cycles cause a bounded error instead of infinite requests", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => json({ items: [], next_cursor: "repeating" });
  try {
    await assert.rejects(all("/applications/mine"), /Повтор страницы данных/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("writes carry CSRF, revision and idempotency; reads do not", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  setCsrf("token-test-value");
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return json({ id: "created" }, 201);
  };
  try {
    await api("/startups", "POST", { title: "Example" }, 4);
    assert.equal(requests[0].options.headers["X-CSRF-Token"], "token-test-value");
    assert.equal(requests[0].options.headers["If-Match"], '"4"');
    assert.match(requests[0].options.headers["Idempotency-Key"], /^[a-f0-9-]{36}$/i);
    assert.equal(requests[0].options.credentials, "same-origin");
    await api("/auth/me");
    assert.equal(requests[1].options.headers["Idempotency-Key"], undefined);
    assert.equal(requests[1].options.headers["X-CSRF-Token"], undefined);
  } finally {
    setCsrf("");
    globalThis.fetch = previous;
  }
});

test("expired-session API errors are translated, rather than displayed as English", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => json(
    { error: { code: "SESSION_EXPIRED", message: "Session expired" } },
    401,
  );
  try {
    await assert.rejects(api("/auth/me"), /Сессия завершилась/);
  } finally {
    globalThis.fetch = previous;
  }
});
