import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useRef, useState } from "react";
import { backendLabel, getPrefs, resolveModel } from "../lib/chat";
import { conversationText, Exchange, exchangeMarkdown, toExchanges } from "../lib/format";
import { ChatSession, useSession } from "../lib/session";

const shortcuts = {
  copyAnswer: { modifiers: ["ctrl", "shift"], key: "c" },
  pasteAnswer: { modifiers: ["ctrl", "shift"], key: "v" },
  copyConversation: { modifiers: ["ctrl", "shift"], key: "a" },
  newChat: { modifiers: ["ctrl"], key: "n" },
  stop: { modifiers: ["ctrl"], key: "." },
  copyQuestion: { modifiers: ["ctrl", "shift"], key: "q" },
} satisfies Record<string, Keyboard.Shortcut>;

function subtitle(session: ChatSession): string {
  const conv = session.conversation;
  if (conv.model && !session.isStreaming) return `${backendLabel(conv.backend)} · ${conv.model}`;
  const prefs = getPrefs();
  return `${backendLabel(prefs.backend)} · ${resolveModel(prefs)}`;
}

/** Copy/paste/new-chat actions shared by the list items and the answer view. */
function ConversationActions({
  session,
  exchange,
  onNewChat,
}: {
  session: ChatSession;
  exchange?: Exchange;
  onNewChat: () => void;
}) {
  const hasMessages = session.conversation.messages.length > 0;
  return (
    <>
      {exchange?.answer ? (
        <ActionPanel.Section title="Answer">
          <Action.CopyToClipboard title="Copy Answer" content={exchange.answer} shortcut={shortcuts.copyAnswer} />
          <Action.Paste title="Paste Answer" content={exchange.answer} shortcut={shortcuts.pasteAnswer} />
          <Action.CopyToClipboard
            title="Copy Question"
            content={exchange.question}
            shortcut={shortcuts.copyQuestion}
          />
        </ActionPanel.Section>
      ) : null}
      <ActionPanel.Section title="Conversation">
        {session.isStreaming ? (
          <Action title="Stop Generating" icon={Icon.Stop} shortcut={shortcuts.stop} onAction={() => session.stop()} />
        ) : null}
        {hasMessages ? (
          <Action.CopyToClipboard
            title="Copy Conversation"
            content={conversationText(session.conversation)}
            shortcut={shortcuts.copyConversation}
          />
        ) : null}
        <Action title="New Chat" icon={Icon.Plus} shortcut={shortcuts.newChat} onAction={onNewChat} />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action title="Open Extension Preferences" icon={Icon.Cog} onAction={openExtensionPreferences} />
      </ActionPanel.Section>
    </>
  );
}

/**
 * Shows one question/answer pair. With `index` undefined it follows the latest exchange,
 * which is what gets pushed while an answer is streaming.
 */
function AnswerView({ session, index }: { session: ChatSession; index?: number }) {
  const { pop } = useNavigation();
  useSession(session);

  const exchanges = toExchanges(session.displayMessages);
  const i = index ?? exchanges.length - 1;
  const exchange = exchanges[i];
  const isLatest = i === exchanges.length - 1;

  const markdown = exchange
    ? exchangeMarkdown(exchange, {
        streaming: isLatest && session.isStreaming,
        error: isLatest ? session.error : undefined,
      })
    : "_New chat. Go back to ask a question._";

  return (
    <Detail
      navigationTitle={session.isStreaming && isLatest ? "Claude is answering…" : subtitle(session)}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Ask Follow-up" icon={Icon.SpeechBubble} onAction={pop} />
          <ConversationActions
            session={session}
            exchange={session.isStreaming && isLatest ? undefined : exchange}
            onNewChat={() => {
              session.reset();
              pop();
            }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * The chat itself: the search bar is the input, the items are previous exchanges.
 * Submitting pushes an AnswerView that streams the reply.
 */
export function ChatView({ session, initialQuestion }: { session: ChatSession; initialQuestion?: string }) {
  const { push } = useNavigation();
  useSession(session);
  const [searchText, setSearchText] = useState("");
  const started = useRef(false);

  const submit = (text: string) => {
    const question = text.trim();
    if (!question) return;
    if (session.isStreaming) {
      showToast({ style: Toast.Style.Failure, title: "Wait for the current answer or stop it" });
      return;
    }
    setSearchText("");
    void session.ask(question);
    push(<AnswerView session={session} />);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialQuestion?.trim()) submit(initialQuestion);
  }, []);

  useEffect(() => {
    if (session.error) showToast({ style: Toast.Style.Failure, title: "Claude request failed", message: session.error });
  }, [session.error]);

  const newChat = () => {
    session.reset();
    setSearchText("");
  };

  const exchanges = toExchanges(session.displayMessages);
  const hasQuery = searchText.trim().length > 0;
  const askAction = (
    <Action title={exchanges.length ? "Ask Follow-up" : "Ask Claude"} icon={Icon.SpeechBubble} onAction={() => submit(searchText)} />
  );

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle={false}
      isLoading={session.isStreaming}
      isShowingDetail={exchanges.length > 0}
      navigationTitle={session.conversation.title || "Ask Claude"}
      searchBarPlaceholder={
        session.isStreaming ? "Claude is answering…" : exchanges.length ? "Ask a follow-up…" : "Ask Claude anything…"
      }
      actions={
        <ActionPanel>
          {hasQuery ? askAction : null}
          <ConversationActions session={session} onNewChat={newChat} />
        </ActionPanel>
      }
    >
      {exchanges.length === 0 ? (
        <List.EmptyView
          icon="icon.png"
          title={hasQuery ? "Press Enter to ask Claude" : "Ask Claude anything"}
          description={subtitle(session)}
        />
      ) : (
        [...exchanges].reverse().map((ex) => {
          const isLatest = ex.index === exchanges.length - 1;
          const streaming = isLatest && session.isStreaming;
          return (
            <List.Item
              // Ids change with every new exchange so the selection jumps back to the newest one.
              key={`${ex.index}/${exchanges.length}`}
              id={`${ex.index}/${exchanges.length}`}
              icon={streaming ? Icon.Clock : Icon.SpeechBubble}
              title={ex.question.replace(/\s+/g, " ")}
              detail={
                <List.Item.Detail
                  markdown={exchangeMarkdown(ex, { streaming, error: isLatest ? session.error : undefined })}
                />
              }
              actions={
                <ActionPanel>
                  {hasQuery ? askAction : null}
                  <Action
                    title="Open Answer"
                    icon={Icon.ArrowRight}
                    onAction={() => push(<AnswerView session={session} index={ex.index} />)}
                  />
                  <ConversationActions session={session} exchange={streaming ? undefined : ex} onNewChat={newChat} />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
