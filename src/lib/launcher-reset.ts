import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { environment, LocalStorage } from "@vicinae/api";

/*
 * Vicinae keeps the values typed into a command's argument fields in the root view and puts them
 * back when you return to it, so the old question is still there next time the launcher opens.
 * Extensions have no API to clear them. What does clear them is the root selection moving to
 * another item: the argument fields are then rebuilt empty.
 *
 * So after a question arrives through the argument field we stash it, send the launcher back to
 * the root, briefly put some other text in the root search (moving the selection), clear it
 * (Ask Claude is selected again, with empty fields) and relaunch Ask Claude, which picks the
 * question up from storage.
 */

const PENDING_KEY = "pending-question";
const PENDING_TTL_MS = 15_000;
// Something no command matches, so the selection leaves Ask Claude.
const SCRATCH_QUERY = "⁣claude-quick-ai-reset⁣";

function findVicinae(): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), "/usr/bin", "/usr/local/bin"];
  for (const dir of dirs) {
    const p = join(dir, "vicinae");
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function takePendingQuestion(): Promise<string | undefined> {
  const raw = await LocalStorage.getItem<string>(PENDING_KEY);
  if (!raw) return undefined;
  await LocalStorage.removeItem(PENDING_KEY);
  try {
    const { question, at } = JSON.parse(raw);
    return Date.now() - at < PENDING_TTL_MS ? question : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clears the root argument field and relaunches this command with `question` waiting in storage.
 * Returns false when it can't (no vicinae binary), in which case the caller should just ask.
 */
export async function relaunchWithClearedArguments(question: string): Promise<boolean> {
  const vicinae = findVicinae();
  if (!vicinae) return false;

  await LocalStorage.setItem(PENDING_KEY, JSON.stringify({ question, at: Date.now() }));

  const owner = environment.ownerOrAuthorName;
  const self = `vicinae://launch/@${owner}/${environment.extensionName}/${environment.commandName}`;
  const link = (l: string) => `${shellQuote(vicinae)} deeplink ${shellQuote(l)}`;
  const script = [
    link("vicinae://pop_to_root"),
    // Closes the window and sets the root search text, which moves the selection off Ask Claude.
    link(`vicinae://toggle?fallbackText=${encodeURIComponent(SCRATCH_QUERY)}`),
    "sleep 0.05",
    link("vicinae://pop_to_root?clearSearch=true"),
    "sleep 0.05",
    link(self),
  ].join("; ");

  // Detached, because popping to the root unloads this command.
  const child = spawn("sh", ["-c", script], { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}
