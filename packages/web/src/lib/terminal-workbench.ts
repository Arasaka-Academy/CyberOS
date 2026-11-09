export const TERMINAL_INPUT_LIMIT_BYTES = 64 * 1024;

export type TerminalStatus = "connecting" | "connected" | "disconnected" | "error" | "exited" | "takenOver";

export interface TerminalViewState {
  status: TerminalStatus;
  diagnostic: string | null;
  cols?: number;
  rows?: number;
  hasSelection?: boolean;
  connectionId?: number;
}

export interface TerminalPasteTarget {
  tabId: string;
  connectionId: number;
}

export type TerminalPasteResult = "sent" | "unavailable" | "tooLarge";
export type TerminalFeedback = "copied" | "unavailable" | "tooLarge" | "fullscreenFailed";

export interface TerminalSessionHandle {
  target: () => TerminalPasteTarget | null;
  focus: () => void;
  fit: () => void;
  selection: () => string;
  paste: (target: TerminalPasteTarget, text: string) => TerminalPasteResult;
  search: (query: string, previous?: boolean) => boolean;
  clearSearch: () => void;
}

export function terminalPasteNeedsConfirmation(text: string): boolean {
  return Array.from(text).some(isTerminalControl);
}

export function terminalPastePreview(text: string): string {
  return Array.from(text, character => {
    if (character === "\n" || !isTerminalControl(character)) return character;
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    const code = character.charCodeAt(0);
    return code > 255 ? `\\u${code.toString(16).toUpperCase()}` : `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function isTerminalControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
}

export function terminalPasteSize(text: string, bracketedPaste: boolean): number {
  return new TextEncoder().encode(text.replace(/\r?\n/g, "\r")).byteLength + (bracketedPaste ? 12 : 0);
}

export function terminalPasteTargetMatches(expected: TerminalPasteTarget, current: TerminalPasteTarget | null): boolean {
  return current !== null && expected.tabId === current.tabId && expected.connectionId === current.connectionId;
}

export function terminalWorkbenchShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing">): "search" | "copy" | null {
  if (event.isComposing || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "f" && (event.metaKey || (event.ctrlKey && event.shiftKey))) return "search";
  if (key === "c" && event.ctrlKey && event.shiftKey) return "copy";
  return null;
}

export function terminalReconnectDelay(attempt: number): number {
  return Math.min(5_000, 250 * 2 ** Math.min(Math.max(0, attempt), 5));
}
