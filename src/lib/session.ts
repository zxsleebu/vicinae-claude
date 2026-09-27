import { randomUUID } from "node:crypto";
import { useEffect, useState } from "react";
import { streamChat } from "./chat";
import { titleFrom } from "./format";
import { saveConversation } from "./storage";
import { Conversation } from "./types";

const EMIT_INTERVAL_MS = 60;

export function newConversation(): Conversation {
  const now = Date.now();
  return { id: randomUUID(), title: "", createdAt: now, updatedAt: now, messages: [] };
}

/**
 * Holds one conversation and the in-flight answer. Views subscribe to it, so a pushed Detail view
 * keeps updating while the answer streams even though it doesn't re-render with its parent.
 */
export class ChatSession {
  conversation: Conversation;
  /** Answer being streamed right now (not yet in `conversation.messages`). */
  pending = "";
  isStreaming = false;
  error?: string;

  private listeners = new Set<() => void>();
  private abortController?: AbortController;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private version = 0;

  constructor(conversation?: Conversation) {
    this.conversation = conversation ?? newConversation();
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = undefined;
    }
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Coalesces rapid stream deltas into one update per interval. */
  private emitThrottled() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => this.emit(), EMIT_INTERVAL_MS);
  }

  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.isStreaming) return;

    const conv = this.conversation;
    if (!conv.title) conv.title = titleFrom(q);
    conv.messages = [...conv.messages, { role: "user", content: q }];
    conv.updatedAt = Date.now();
    this.pending = "";
    this.error = undefined;
    this.isStreaming = true;
    this.abortController = new AbortController();
    this.emit();

    try {
      const result = await streamChat(
        conv.messages,
        (delta) => {
          this.pending += delta;
          this.emitThrottled();
        },
        this.abortController.signal,
        { sessionId: conv.cliSessionId },
      );
      conv.messages = [...conv.messages, { role: "assistant", content: result.text || this.pending }];
      conv.backend = result.backend;
      conv.model = result.model;
      // Turns answered through the API are not part of the CLI session, so it can't be resumed any more.
      conv.cliSessionId = result.backend === "cli" ? result.sessionId : undefined;
    } catch (err) {
      const aborted = this.abortController.signal.aborted;
      if (this.pending) {
        conv.messages = [
          ...conv.messages,
          { role: "assistant", content: this.pending + (aborted ? "\n\n_(stopped)_" : "") },
        ];
      }
      if (!aborted) this.error = err instanceof Error ? err.message : String(err);
      // Our history now differs from what the CLI session saw.
      conv.cliSessionId = undefined;
    } finally {
      this.pending = "";
      this.isStreaming = false;
      this.abortController = undefined;
      conv.updatedAt = Date.now();
      await saveConversation(conv).catch(() => {});
      this.emit();
    }
  }

  stop() {
    this.abortController?.abort();
  }

  /** Starts a fresh conversation in the same session object. */
  reset() {
    this.stop();
    this.conversation = newConversation();
    this.pending = "";
    this.error = undefined;
    this.emit();
  }

  /** Messages including the in-flight answer, for rendering. */
  get displayMessages() {
    const msgs = this.conversation.messages;
    if (!this.isStreaming) return msgs;
    return [...msgs, { role: "assistant" as const, content: this.pending }];
  }
}

/** Re-renders the calling component whenever the session changes. */
export function useSession(session: ChatSession): number {
  const [version, setVersion] = useState(session.getVersion());
  useEffect(() => session.subscribe(() => setVersion(session.getVersion())), [session]);
  return version;
}
