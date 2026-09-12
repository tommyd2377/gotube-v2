import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/index.js";

const SYNC_KEY = "test-sync-key";
const SUPABASE_URL = "https://example.supabase.co";
const FUTURE_JWT_ERROR = {
  code: "PGRST303",
  details: "upstream detail sentinel",
  hint: "upstream hint sentinel",
  message: "JWT issued at future"
};
const SAFE_UNAVAILABLE_MESSAGE =
  "Saved data is temporarily unavailable. Your cached videos are still available; please try again shortly.";

function request() {
  return new Request("https://gotube.test/api/channels", {
    headers: { "x-gotube-sync-key": SYNC_KEY }
  });
}

function env(key) {
  return {
    GOTUBE_SYNC_KEY: SYNC_KEY,
    SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_URL
  };
}

async function withMockFetch(responses, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let responseIndex = 0;

  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;
    return response();
  };

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(data, status = 200) {
  return () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" }
    });
}

test("legacy service-role JWT is sent as apikey and bearer", async () => {
  const key = "eyJ.test.legacy";

  await withMockFetch([jsonResponse([])], async (calls) => {
    const response = await worker.fetch(request(), env(key));

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get("apikey"), key);
    assert.equal(headers.get("authorization"), `Bearer ${key}`);
  });
});

test("new Supabase secret key is sent only as apikey", async () => {
  const key = "sb_secret_test_key";

  await withMockFetch([jsonResponse([])], async (calls) => {
    const response = await worker.fetch(request(), env(key));

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get("apikey"), key);
    assert.equal(headers.get("authorization"), null);
  });
});

test("future-issued JWT is retried once when the next request succeeds", async () => {
  await withMockFetch([jsonResponse(FUTURE_JWT_ERROR, 401), jsonResponse([])], async (calls) => {
    const response = await worker.fetch(request(), env("eyJ.test.legacy"));

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
  });
});

for (const [name, status, body] of [
  ["wrong status", 403, FUTURE_JWT_ERROR],
  ["wrong code", 401, { ...FUTURE_JWT_ERROR, code: "OTHER" }],
  ["wrong message", 401, { ...FUTURE_JWT_ERROR, message: "Invalid JWT" }],
  ["non-JSON body", 401, "not json"]
]) {
  test(`does not retry a future-JWT near miss: ${name}`, async () => {
    const firstResponse =
      typeof body === "string"
        ? () => new Response(body, { status })
        : jsonResponse(body, status);

    await withMockFetch([firstResponse, jsonResponse([])], async (calls) => {
      const response = await worker.fetch(request(), env("eyJ.test.legacy"));

      assert.equal(response.status, 500);
      assert.equal(calls.length, 1);
    });
  });
}

test("persistent future-issued JWT returns a sanitized 503", async () => {
  const key = "eyJ.secret.sentinel";

  await withMockFetch(
    [jsonResponse(FUTURE_JWT_ERROR, 401), jsonResponse(FUTURE_JWT_ERROR, 401)],
    async (calls) => {
      const response = await worker.fetch(request(), env(key));
      const responseText = await response.text();

      assert.equal(response.status, 503);
      assert.equal(calls.length, 2);
      assert.deepEqual(JSON.parse(responseText), { error: SAFE_UNAVAILABLE_MESSAGE });
      for (const sensitiveText of [
        "PGRST303",
        "JWT issued",
        "upstream detail sentinel",
        "upstream hint sentinel",
        key
      ]) {
        assert.equal(responseText.includes(sensitiveText), false);
      }
    }
  );
});
