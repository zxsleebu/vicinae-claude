import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { backendLabel } from "./lib/chat";
import { conversationMarkdown, conversationText, toExchanges } from "./lib/format";
import { ChatSession } from "./lib/session";
import { deleteAllConversations, deleteConversation, listConversations } from "./lib/storage";
import { Conversation } from "./lib/types";

function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

export default function ChatHistory() {
  const { push } = useNavigation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setConversations(await listConversations());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = (conv: Conversation) => {
    const session = new ChatSession(conv);
    // Keep this list fresh while the chat continues in the pushed view.
    session.subscribe(() => {
      if (!session.isStreaming) void reload();
    });
    push(<ChatView session={session} />);
  };

  const remove = async (conv: Conversation) => {
    await deleteConversation(conv.id);
    await reload();
    await showToast({ style: Toast.Style.Success, title: "Conversation deleted" });
  };

  const removeAll = async () => {
    const ok = await confirmAlert({
      title: "Delete all conversations?",
      message: "This can't be undone.",
      primaryAction: { title: "Delete All", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    await deleteAllConversations();
    await reload();
  };

  return (
    <List isLoading={isLoading} isShowingDetail={conversations.length > 0} searchBarPlaceholder="Search conversations…">
      <List.EmptyView icon="icon.png" title="No conversations yet" description="Use “Ask Claude” to start one." />
      {conversations.map((conv) => {
        const turns = toExchanges(conv.messages).length;
        return (
          <List.Item
            key={conv.id}
            id={conv.id}
            icon={Icon.SpeechBubble}
            title={conv.title || "Untitled"}
            keywords={conv.messages.filter((m) => m.role === "user").map((m) => m.content.slice(0, 200))}
            accessories={[{ text: String(turns), icon: Icon.SpeechBubble }, { text: relativeTime(conv.updatedAt) }]}
            detail={
              <List.Item.Detail
                markdown={conversationMarkdown(conv)}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Updated" text={new Date(conv.updatedAt).toLocaleString()} />
                    <List.Item.Detail.Metadata.Label title="Backend" text={backendLabel(conv.backend)} />
                    {conv.model ? <List.Item.Detail.Metadata.Label title="Model" text={conv.model} /> : null}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action title="Continue Chat" icon={Icon.SpeechBubble} onAction={() => open(conv)} />
                <Action.CopyToClipboard
                  title="Copy Conversation"
                  content={conversationText(conv)}
                  shortcut={{ modifiers: ["ctrl", "shift"], key: "a" }}
                />
                <ActionPanel.Section>
                  <Action
                    title="Delete Conversation"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={() => remove(conv)}
                  />
                  <Action
                    title="Delete All Conversations"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.RemoveAll}
                    onAction={removeAll}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
