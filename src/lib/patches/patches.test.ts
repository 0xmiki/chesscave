import { describe, expect, test } from "bun:test";
import {
  createPatchCard,
  isPatchForStudentTurn,
  isAcceptedPatchMove,
  legalPatchMove,
  parseGeneratedPatchCopy,
  reviewPatchCard,
} from "./patches";

const source = {
  gameKey: "review-key",
  sourceUrl: null,
  gameTitle: "White vs Black",
  pgn: "1. e4 e5",
  decisionPly: 0,
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  orientation: "white" as const,
  playedMove: null,
  clocks: { w: null, b: null },
};

describe("patch cards", () => {
  test("normalizes legal SAN and UCI answers", () => {
    expect(legalPatchMove(source.fen, "e4")).toEqual({ uci: "e2e4", san: "e4" });
    expect(legalPatchMove(source.fen, "g1f3")).toEqual({ uci: "g1f3", san: "Nf3" });
    expect(legalPatchMove(source.fen, "e2e5")).toBeNull();
  });

  test("accepts only the generated card's verified move", () => {
    const card = createPatchCard({
      id: "card",
      now: 1_000,
      source,
      mistake: "I moved the same piece twice.",
      proposedCorrection: "Develop a knight.",
      acceptedMove: { uci: "g1f3", san: "Nf3" },
      principalVariation: ["Nf3", "Nc6"],
      generated: {
        mistake: "I lost time by moving the same piece twice.",
        prompt: "Develop without losing time.",
        explanation: "Nf3 develops and pressures e5.",
        principle: "Develop with tempo when possible.",
      },
    });
    expect(isAcceptedPatchMove(card, "g1f3")).toBe(true);
    expect(isAcceptedPatchMove(card, "e2e4")).toBe(false);
    expect(card.diagnosis.mistake).toBe("I lost time by moving the same piece twice.");
  });

  test("rejects a drill created from the opponent's turn", () => {
    const wrongSideSource = { ...source, studentSide: "black" as const };
    expect(isPatchForStudentTurn(source)).toBe(true);
    expect(isPatchForStudentTurn(wrongSideSource)).toBe(false);
    expect(() => createPatchCard({
      source: wrongSideSource,
      mistake: "I missed the center.",
      proposedCorrection: "Play e4.",
      acceptedMove: { uci: "e2e4", san: "e4" },
      principalVariation: [],
      generated: { mistake: "I missed the center.", prompt: "Find the move", explanation: "Play centrally.", principle: "Claim space." },
    })).toThrow("student's turn");
  });

  test("parses bounded Codex JSON and falls back on malformed output", () => {
    const fallback = {
      mistake: "Fallback mistake",
      prompt: "Fallback prompt",
      explanation: "Fallback explanation",
      principle: "Fallback principle",
    };
    expect(
      parseGeneratedPatchCopy(
        '```json\n{"mistake":"I overlooked the pin.","prompt":"Find the move","explanation":"Use the pin","principle":"Check forcing moves"}\n```',
        fallback,
      ),
    ).toEqual({
      mistake: "I overlooked the pin.",
      prompt: "Find the move",
      explanation: "Use the pin",
      principle: "Check forcing moves",
    });
    expect(parseGeneratedPatchCopy("not json", fallback)).toEqual(fallback);
  });

  test("schedules failed cards soon and understood cards by widening intervals", () => {
    const card = createPatchCard({
      id: "card",
      now: 1_000,
      source,
      mistake: "Missed development.",
      proposedCorrection: "Nf3.",
      acceptedMove: { uci: "g1f3", san: "Nf3" },
      principalVariation: [],
      generated: { mistake: "Missed development.", prompt: "Move", explanation: "Why", principle: "Idea" },
    });
    const again = reviewPatchCard(card, "again", 2_000);
    expect(again.schedule.dueAt).toBe(602_000);
    expect(again.schedule.lapses).toBe(1);

    const learned = reviewPatchCard(card, "understood", 2_000);
    expect(learned.schedule.intervalDays).toBe(1);
    const reinforced = reviewPatchCard(learned, "understood", learned.schedule.dueAt);
    expect(reinforced.schedule.intervalDays).toBe(3);
  });
});
