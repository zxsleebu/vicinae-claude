import { LaunchProps } from "@vicinae/api";
import { useState } from "react";
import { ChatView } from "./components/ChatView";
import { ChatSession } from "./lib/session";

export default function AskClaude(props: LaunchProps<{ arguments: { question?: string } }>) {
  const [session] = useState(() => new ChatSession());
  // `fallbackText` is set when the command runs as a fallback from the root search.
  const initialQuestion = props.arguments?.question?.trim() || props.fallbackText?.trim() || undefined;
  return <ChatView session={session} initialQuestion={initialQuestion} />;
}
