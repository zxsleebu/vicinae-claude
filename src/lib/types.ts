export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export type Backend = "api" | "cli";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Backend and model of the last answer. */
  backend?: Backend;
  model?: string;
  /** Claude Code session id, used with `--resume` for follow-ups. */
  cliSessionId?: string;
}

export interface Preferences {
  backend: Backend;
  model: string;
  customModel?: string;
  systemPrompt?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: string;
  claudePath?: string;
  clearArgument?: boolean;
}

export interface StreamOptions {
  /** CLI backend: session to resume. Ignored by the API backend. */
  sessionId?: string;
}

export interface StreamResult {
  text: string;
  sessionId?: string;
}

export type OnDelta = (delta: string) => void;
