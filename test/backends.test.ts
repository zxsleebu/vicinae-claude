import { mock, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// CLI tests need a logged-in `claude`; skip them where it is missing (e.g. CI).
const hasClaude = (() => {
  try {
    execSync("command -v claude", { stdio: "ignore" });
    return !process.env.CI;
  } catch {
    return false;
  }
})();

const support = mkdtempSync(join(tmpdir(), "vc-"));
let prefs: any = {};
mock.module("@vicinae/api", () => ({
  environment: { supportPath: support },
  getPreferenceValues: () => prefs,
}));
const { streamChat } = await import("../src/lib/chat");

// Mock Anthropic SSE endpoint
let lastReq: any;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    lastReq = { url: req.url, headers: Object.fromEntries(req.headers), body: await req.json() };
    if (lastReq.body.model === "bad") return Response.json({ type: "error", error: { type: "not_found_error", message: "model: bad" } }, { status: 404 });
    const events = [
      ["message_start", { type: "message_start", message: { id: "m" } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }],
      ["ping", { type: "ping" }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo **world**" } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const stream = new ReadableStream({
      async start(c) {
        for (const [e, d] of events) {
          // split writes mid-event to exercise buffering
          const s = `event: ${e}\r\ndata: ${JSON.stringify(d)}\r\n\r\n`;
          c.enqueue(new TextEncoder().encode(s.slice(0, 7)));
          c.enqueue(new TextEncoder().encode(s.slice(7)));
          await Bun.sleep(5);
        }
        c.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});

test("api backend streams via proxy base url", async () => {
  prefs = { backend: "api", model: "claude-sonnet-5", apiKey: "k", baseUrl: `http://127.0.0.1:${server.port}/v1/`, maxTokens: "100", systemPrompt: "sys" };
  const deltas: string[] = [];
  const r = await streamChat([{ role: "user", content: "hi" }], (d) => deltas.push(d), new AbortController().signal);
  expect(r.text).toBe("Hello **world**");
  expect(deltas).toEqual(["Hel", "lo **world**"]);
  expect(new URL(lastReq.url).pathname).toBe("/v1/messages");
  expect(lastReq.body).toMatchObject({ model: "claude-sonnet-5", max_tokens: 100, stream: true, system: "sys" });
  expect(lastReq.headers["x-api-key"]).toBe("k");
  expect(lastReq.headers["authorization"]).toBe("Bearer k");
});

test("api backend surfaces errors", async () => {
  prefs = { backend: "api", model: "bad", apiKey: "k", baseUrl: `http://127.0.0.1:${server.port}` };
  await expect(streamChat([{ role: "user", content: "hi" }], () => {}, new AbortController().signal)).rejects.toThrow("404: model: bad");
});

test("api backend requires key for official url", async () => {
  prefs = { backend: "api", model: "x", baseUrl: "https://api.anthropic.com" };
  await expect(streamChat([{ role: "user", content: "hi" }], () => {}, new AbortController().signal)).rejects.toThrow(/API key/);
});

const H = "claude-haiku-4-5-20251001";
test.skipIf(!hasClaude)("cli backend streams, resumes, falls back", async () => {
  prefs = { backend: "cli", model: H };
  const deltas: string[] = [];
  const r1 = await streamChat([{ role: "user", content: "The codeword is MANGO. Reply with just OK." }], (d) => deltas.push(d), new AbortController().signal);
  console.log("r1", r1, "deltas", deltas.length);
  expect(r1.sessionId).toBeTruthy();
  expect(deltas.join("")).toBe(r1.text);
  const msgs: any[] = [{ role: "user", content: "The codeword is MANGO. Reply with just OK." }, { role: "assistant", content: r1.text }, { role: "user", content: "What is the codeword? One word." }];
  const r2 = await streamChat(msgs, () => {}, new AbortController().signal, { sessionId: r1.sessionId });
  console.log("r2", r2);
  expect(r2.text).toContain("MANGO");
  expect(r2.sessionId).toBe(r1.sessionId);
  // unknown session -> transcript fallback
  const r3 = await streamChat(msgs, () => {}, new AbortController().signal, { sessionId: "00000000-0000-0000-0000-000000000000" });
  console.log("r3", r3);
  expect(r3.text).toContain("MANGO");
}, 180_000);

test.skipIf(!hasClaude)("cli backend abort and bad model", async () => {
  prefs = { backend: "cli", model: H };
  const ac = new AbortController();
  const p = streamChat([{ role: "user", content: "Count from 1 to 300, one per line." }], () => ac.abort(), ac.signal);
  await expect(p).rejects.toThrow(/Abort/);
  prefs = { backend: "cli", model: "bogus-model" };
  await expect(streamChat([{ role: "user", content: "hi" }], () => {}, new AbortController().signal)).rejects.toThrow(/bogus-model/);
}, 120_000);
