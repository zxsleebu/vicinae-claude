import { getPreferenceValues } from "@vicinae/api";
import { streamApi } from "./api-backend";
import { streamCli } from "./cli-backend";
import { Backend, Message, OnDelta, Preferences, StreamOptions, StreamResult } from "./types";

export function getPrefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function resolveModel(prefs: Preferences): string {
  return prefs.customModel?.trim() || prefs.model || "claude-sonnet-5";
}

export function backendLabel(backend: Backend | undefined): string {
  return backend === "api" ? "API" : "Claude Code";
}

/**
 * Common entry point for both backends. `messages` is the full history ending with the new user message.
 * `onDelta` receives text chunks as they arrive; the returned text is the complete answer.
 */
export function streamChat(
  messages: Message[],
  onDelta: OnDelta,
  signal: AbortSignal,
  opts: StreamOptions = {},
): Promise<StreamResult & { backend: Backend; model: string }> {
  const prefs = getPrefs();
  const model = resolveModel(prefs);
  const backend: Backend = prefs.backend === "api" ? "api" : "cli";
  const run =
    backend === "api"
      ? streamApi(messages, onDelta, signal, prefs, model)
      : streamCli(messages, onDelta, signal, prefs, model, opts);
  return run.then((r) => ({ ...r, backend, model }));
}
