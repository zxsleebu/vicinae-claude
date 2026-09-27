import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { environment } from "@vicinae/api";
import { Message, OnDelta, Preferences, StreamOptions, StreamResult } from "./types";

const DEFAULT_SYSTEM_PROMPT =
  "You are Claude, a helpful assistant answering quick questions from a desktop launcher. " +
  "Be concise and direct. Format answers in Markdown.";

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findClaudeBinary(configured?: string): string {
  if (configured?.trim()) {
    const p = expandHome(configured.trim());
    if (!isExecutable(p)) throw new Error(`Claude binary is not executable: ${p}`);
    return p;
  }
  const home = homedir();
  // The launcher's PATH is often minimal, so also check the usual install locations.
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, ".local/bin"),
    join(home, ".claude/local"),
    join(home, ".npm-global/bin"),
    join(home, ".bun/bin"),
    "/usr/local/bin",
    "/usr/bin",
  ].filter(Boolean);
  for (const dir of dirs) {
    const p = join(dir, "claude");
    if (isExecutable(p)) return p;
  }
  throw new Error("Could not find the claude binary. Set its path in the extension preferences.");
}

/** Used when there is history but no session to resume (e.g. the chat was started on the API backend). */
function transcriptPrompt(messages: Message[]): string {
  const history = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  const last = messages[messages.length - 1].content;
  return (
    `Here is our conversation so far:\n\n<conversation>\n${history}\n</conversation>\n\n` +
    `Continue the conversation by replying to the user's latest message:\n\n${last}`
  );
}

class SessionNotFoundError extends Error {}

function runClaude(
  bin: string,
  prompt: string,
  model: string,
  systemPrompt: string,
  sessionId: string | undefined,
  onDelta: OnDelta,
  signal: AbortSignal,
): Promise<StreamResult> {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Plain chat: no tools, no MCP servers, no user/project settings (hooks etc.).
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--model",
    model,
    "--system-prompt",
    systemPrompt,
  ];
  if (sessionId) args.push("--resume", sessionId);

  // Sessions are stored per working directory, so keep them all in one place;
  // `--resume` only finds sessions created from the same cwd.
  const cwd = environment.supportPath;
  mkdirSync(cwd, { recursive: true });

  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));

    const child = spawn(bin, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });

    let text = "";
    let resultSessionId: string | undefined;
    let resultError: string | undefined;
    let resultText: string | undefined;
    let stderr = "";
    let buffer = "";
    let lastTextBlock: number | undefined;
    let settled = false;

    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "system" && ev.subtype === "init" && ev.session_id) {
        resultSessionId = ev.session_id;
      } else if (ev.type === "stream_event") {
        const e = ev.event;
        if (ev.parent_tool_use_id) return;
        if (e?.type === "content_block_start" && e.content_block?.type === "text") {
          // Separate consecutive text blocks of one answer.
          if (lastTextBlock !== undefined && lastTextBlock !== e.index && text) {
            text += "\n\n";
            onDelta("\n\n");
          }
          lastTextBlock = e.index;
        } else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          text += e.delta.text;
          onDelta(e.delta.text);
        }
      } else if (ev.type === "result") {
        if (ev.session_id) resultSessionId = ev.session_id;
        if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
          resultError = ev.result || (Array.isArray(ev.errors) ? ev.errors.join("\n") : "") || ev.subtype;
        } else {
          resultText = ev.result;
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve({ text, sessionId: resultSessionId });
    };

    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (buffer) handleLine(buffer);
      if (signal.aborted) return finish(new DOMException("Aborted", "AbortError"));
      if (/No conversation found/i.test(stderr)) return finish(new SessionNotFoundError(stderr.trim()));
      if (resultError) return finish(new Error(resultError));
      if (code !== 0 && !text) {
        return finish(new Error(stderr.trim().split("\n").slice(-3).join("\n") || `claude exited with code ${code}`));
      }
      // Partial messages should have delivered everything; fall back to the final result just in case.
      if (!text && resultText) {
        text = resultText;
        onDelta(resultText);
      }
      finish();
    });

    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

/** Streams an answer through `claude -p` using the user's Claude Code login. */
export async function streamCli(
  messages: Message[],
  onDelta: OnDelta,
  signal: AbortSignal,
  prefs: Preferences,
  model: string,
  opts: StreamOptions = {},
): Promise<StreamResult> {
  const bin = findClaudeBinary(prefs.claudePath);
  const systemPrompt = prefs.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const last = messages[messages.length - 1].content;

  if (opts.sessionId) {
    try {
      return await runClaude(bin, last, model, systemPrompt, opts.sessionId, onDelta, signal);
    } catch (err) {
      // The session file may have been cleaned up; rebuild the context from our own history.
      if (!(err instanceof SessionNotFoundError)) throw err;
    }
  }
  const prompt = messages.length > 1 ? transcriptPrompt(messages) : last;
  return runClaude(bin, prompt, model, systemPrompt, undefined, onDelta, signal);
}
