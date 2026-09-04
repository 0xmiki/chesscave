import type { CoachMessage } from "$lib/chess/types";

export const TRANSCRIPT_BOTTOM_THRESHOLD = 16;

export function isTranscriptAtBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = TRANSCRIPT_BOTTOM_THRESHOLD,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function shouldSendComposerKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

export function shouldStopCoachKey(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "keyCode">,
  canStop: boolean,
): boolean {
  return (
    canStop &&
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

export function coachEventTurnId(event: Record<string, unknown>): string | null {
  const params = (event.params ?? {}) as Record<string, unknown>;
  const turn = (params.turn ?? {}) as Record<string, unknown>;
  const item = (params.item ?? {}) as Record<string, unknown>;
  const value =
    params.turnId ??
    params.turn_id ??
    turn.id ??
    item.turnId ??
    item.turn_id;
  return typeof value === "string" && value ? value : null;
}

export function shouldAcceptCoachTurnEvent(
  event: Record<string, unknown>,
  activeRequest: boolean,
  activeTurnId: string | null,
): boolean {
  const method = typeof event.method === "string" ? event.method : "";
  if (!method.startsWith("turn/") && !method.startsWith("item/")) return true;
  if (!activeRequest) return false;

  const eventTurnId = coachEventTurnId(event);
  return !activeTurnId || !eventTurnId || eventTurnId === activeTurnId;
}

export function restoreCoachMessages(raw: string | null): CoachMessage[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error("Saved coach messages must be an array.");
  }

  return value
    .filter(
      (message): message is Record<string, unknown> =>
        Boolean(message) &&
        typeof message === "object" &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string",
    )
    .slice(-40)
    .map((message) => {
      const interrupted = message.requestStatus === "pending";
      return {
        id: message.id as string,
        role: message.role as CoachMessage["role"],
        text: message.text as string,
        pending: false,
        requestKind:
          message.requestKind === "message" || message.requestKind === "drill"
            ? message.requestKind
            : undefined,
        requestStatus: interrupted
          ? "failed"
          : message.requestStatus === "failed" || message.requestStatus === "stopped"
            ? message.requestStatus
            : undefined,
        error: interrupted
          ? "ChessCave closed before this request finished."
          : typeof message.error === "string"
            ? message.error
            : undefined,
      };
    });
}

export function appendCoachDeltas(
  messages: CoachMessage[],
  deltas: ReadonlyMap<string, string>,
): CoachMessage[] {
  if (!deltas.size) return messages;

  const pending = new Map(deltas);
  const next = messages.map((message) => {
    const delta = pending.get(message.id);
    if (delta === undefined) return message;
    pending.delete(message.id);
    return { ...message, text: message.text + delta, pending: true };
  });

  for (const [id, text] of pending) {
    next.push({ id, role: "assistant", text, pending: true });
  }
  return next;
}
