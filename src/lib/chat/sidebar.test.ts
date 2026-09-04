import { describe, expect, test } from "bun:test";
import {
  appendCoachDeltas,
  coachEventTurnId,
  isTranscriptAtBottom,
  restoreCoachMessages,
  shouldAcceptCoachTurnEvent,
  shouldSendComposerKey,
  shouldStopCoachKey,
} from "./sidebar";

describe("coach sidebar", () => {
  test("pauses bottom following as soon as the reader moves away", () => {
    expect(isTranscriptAtBottom(1_000, 484, 500)).toBe(true);
    expect(isTranscriptAtBottom(1_000, 483, 500)).toBe(false);
  });

  test("sends on plain Enter but not a newline or IME commit", () => {
    expect(
      shouldSendComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 13,
      }),
    ).toBe(true);
    expect(
      shouldSendComposerKey({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
        keyCode: 13,
      }),
    ).toBe(false);
    expect(
      shouldSendComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
        keyCode: 13,
      }),
    ).toBe(false);
    expect(
      shouldSendComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  test("stops on Escape only when the active response can be stopped", () => {
    const event = {
      key: "Escape",
      defaultPrevented: false,
      isComposing: false,
      keyCode: 27,
    };
    expect(shouldStopCoachKey(event, true)).toBe(true);
    expect(shouldStopCoachKey(event, false)).toBe(false);
    expect(shouldStopCoachKey({ ...event, defaultPrevented: true }, true)).toBe(false);
    expect(shouldStopCoachKey({ ...event, isComposing: true }, true)).toBe(false);
  });

  test("applies one batch to existing and newly started responses", () => {
    const messages = [
      { id: "user", role: "user" as const, text: "Why?" },
      { id: "answer", role: "assistant" as const, text: "Because " },
    ];
    const next = appendCoachDeltas(
      messages,
      new Map([
        ["answer", "the file is pinned."],
        ["second", "One more point."],
      ]),
    );

    expect(next).toEqual([
      messages[0],
      {
        id: "answer",
        role: "assistant",
        text: "Because the file is pinned.",
        pending: true,
      },
      {
        id: "second",
        role: "assistant",
        text: "One more point.",
        pending: true,
      },
    ]);
    expect(messages[1].text).toBe("Because ");
  });

  test("drops events from an old or inactive turn", () => {
    const current = {
      method: "item/agentMessage/delta",
      params: { turnId: "turn-2", itemId: "answer" },
    };
    const stale = {
      method: "turn/completed",
      params: { turn: { id: "turn-1" } },
    };

    expect(coachEventTurnId(current)).toBe("turn-2");
    expect(shouldAcceptCoachTurnEvent(current, true, "turn-2")).toBe(true);
    expect(shouldAcceptCoachTurnEvent(stale, true, "turn-2")).toBe(false);
    expect(shouldAcceptCoachTurnEvent(current, false, null)).toBe(false);
    expect(
      shouldAcceptCoachTurnEvent({ method: "chesscave/ready" }, false, null),
    ).toBe(true);
  });

  test("restores chat without trusting malformed entries", () => {
    const restored = restoreCoachMessages(
      JSON.stringify([
        {
          id: "question",
          role: "user",
          text: "Why?",
          requestKind: "message",
          requestStatus: "pending",
        },
        { nope: true },
      ]),
    );

    expect(restored).toEqual([
      {
        id: "question",
        role: "user",
        text: "Why?",
        pending: false,
        requestKind: "message",
        requestStatus: "failed",
        error: "ChessCave closed before this request finished.",
      },
    ]);
    expect(() => restoreCoachMessages("{")).toThrow();
  });
});
