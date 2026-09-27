import { Message, OnDelta, Preferences, StreamResult } from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

function endpoint(baseUrl: string | undefined): string {
  let base = (baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // Accept both "http://host:port" and "http://host:port/v1".
  if (base.endsWith("/v1")) base = base.slice(0, -3);
  return `${base}/v1/messages`;
}

function headers(prefs: Preferences): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "anthropic-version": "2023-06-01",
  };
  const key = prefs.apiKey?.trim();
  if (key) {
    h["x-api-key"] = key;
    // Local proxies (CLIProxyAPI and similar) often only check the bearer token.
    const isOfficial = !prefs.baseUrl?.trim() || prefs.baseUrl.includes("api.anthropic.com");
    if (!isOfficial) h["authorization"] = `Bearer ${key}`;
  }
  return h;
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message ?? json?.message;
    if (msg) return `${res.status}: ${msg}`;
  } catch {
    // not JSON
  }
  return `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`;
}

/** Streams an answer from the Anthropic Messages API (SSE over fetch). */
export async function streamApi(
  messages: Message[],
  onDelta: OnDelta,
  signal: AbortSignal,
  prefs: Preferences,
  model: string,
): Promise<StreamResult> {
  if (!prefs.apiKey?.trim() && (!prefs.baseUrl?.trim() || prefs.baseUrl.includes("api.anthropic.com"))) {
    throw new Error("API key is not set. Add it in the extension preferences or switch the backend to Claude Code CLI.");
  }

  const maxTokens = Number.parseInt(prefs.maxTokens ?? "", 10);
  const body: Record<string, unknown> = {
    model,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
    stream: true,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (prefs.systemPrompt?.trim()) body.system = prefs.systemPrompt.trim();

  const res = await fetch(endpoint(prefs.baseUrl), {
    method: "POST",
    headers: headers(prefs),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await readError(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  const handleEvent = (raw: string) => {
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    if (!data || data === "[DONE]") return;
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      text += event.delta.text;
      onDelta(event.delta.text);
    } else if (event.type === "error") {
      throw new Error(event.error?.message ?? "Stream error");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handleEvent(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  return { text };
}
