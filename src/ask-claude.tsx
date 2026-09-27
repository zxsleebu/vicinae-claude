import { LaunchProps, List } from "@vicinae/api";
import { useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { getPrefs } from "./lib/chat";
import { relaunchWithClearedArguments, takePendingQuestion } from "./lib/launcher-reset";
import { ChatSession } from "./lib/session";

type Start = { state: "loading" } | { state: "relaunching" } | { state: "ready"; question?: string };

export default function AskClaude(props: LaunchProps<{ arguments: { question?: string } }>) {
  const [session] = useState(() => new ChatSession());
  const [start, setStart] = useState<Start>({ state: "loading" });

  useEffect(() => {
    (async () => {
      const argument = props.arguments?.question?.trim();
      if (argument && getPrefs().clearArgument !== false && (await relaunchWithClearedArguments(argument))) {
        setStart({ state: "relaunching" });
        return;
      }
      // `fallbackText` is set when the command runs as a fallback from the root search.
      const question = argument || (await takePendingQuestion()) || props.fallbackText?.trim() || undefined;
      setStart({ state: "ready", question });
    })();
  }, []);

  if (start.state !== "ready") return <List isLoading searchBarPlaceholder="Ask Claude anything…" />;
  return <ChatView session={session} initialQuestion={start.question} />;
}
