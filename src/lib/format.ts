import { Conversation, Message } from "./types";

export interface Exchange {
  index: number;
  question: string;
  answer: string;
}

/** Groups messages into question/answer pairs. A trailing question without an answer gets "". */
export function toExchanges(messages: Message[]): Exchange[] {
  const out: Exchange[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ index: out.length, question: m.content, answer: "" });
    else if (out.length > 0) out[out.length - 1].answer += (out[out.length - 1].answer ? "\n\n" : "") + m.content;
  }
  return out;
}

export function titleFrom(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

export function exchangeMarkdown(ex: Exchange, opts: { streaming?: boolean; error?: string } = {}): string {
  let md = `${quote(ex.question)}\n\n`;
  if (ex.answer) md += ex.answer;
  else if (opts.streaming) md += "_Thinking…_";
  if (opts.error) md += `\n\n**Error:** ${opts.error}`;
  return md;
}

/** Plain-text transcript for "Copy Conversation". */
export function conversationText(conv: Pick<Conversation, "messages">): string {
  return conv.messages.map((m) => `${m.role === "user" ? "**You:**" : "**Claude:**"}\n${m.content}`).join("\n\n---\n\n");
}

export function conversationMarkdown(conv: Pick<Conversation, "messages">): string {
  return toExchanges(conv.messages)
    .map((ex) => exchangeMarkdown(ex))
    .join("\n\n---\n\n");
}
