import { LocalStorage } from "@vicinae/api";
import { Conversation } from "./types";

// One key per conversation, so saving a chat doesn't rewrite the whole history.
const PREFIX = "conversation:";

export async function listConversations(): Promise<Conversation[]> {
  const all = await LocalStorage.allItems();
  const result: Conversation[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PREFIX) || typeof value !== "string") continue;
    try {
      result.push(JSON.parse(value));
    } catch {
      // skip corrupt entries
    }
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const value = await LocalStorage.getItem<string>(PREFIX + id);
  return value ? JSON.parse(value) : undefined;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  if (conv.messages.length === 0) return;
  await LocalStorage.setItem(PREFIX + conv.id, JSON.stringify(conv));
}

export async function deleteConversation(id: string): Promise<void> {
  await LocalStorage.removeItem(PREFIX + id);
}

export async function deleteAllConversations(): Promise<void> {
  const all = await LocalStorage.allItems();
  await Promise.all(Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => LocalStorage.removeItem(k)));
}
