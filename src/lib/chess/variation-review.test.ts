import { describe, expect, test } from "bun:test";
import { parsePgn } from "./game";
import type { AnalysisResult } from "./types";
import { evaluateVariationMove } from "./variation-review";

const game = parsePgn(`[White "Student"]\n[Black "Opponent"]\n\n1. e4 e5 *`);

function analysis(fen: string, scoreCp: number, bestMove: string): AnalysisResult {
  return {
    engine: "Stockfish",
    fen,
    bestMove,
    elapsedMs: 1,
    lines: [{ multipv: 1, depth: 16, scoreCp, scoreMate: null, wdl: null, moves: [bestMove] }],
  };
}

describe("exploratory variation review", () => {
  test("marks the engine move as best", () => {
    const move = game.moves[0];
    const review = evaluateVariationMove(
      move,
      1,
      analysis(move.before, 20, "e2e4"),
      analysis(move.after, 24, "e7e5"),
    );
    expect(review?.classification).toBe("best");
    expect(review?.bestMove).toBe("e2e4");
  });

  test("classifies loss from the mover's perspective for either color", () => {
    const white = game.moves[0];
    const black = game.moves[1];
    expect(
      evaluateVariationMove(
        white,
        1,
        analysis(white.before, 300, "d2d4"),
        analysis(white.after, 0, "e7e5"),
      )?.classification,
    ).toBe("blunder");
    expect(
      evaluateVariationMove(
        black,
        2,
        analysis(black.before, -300, "c7c5"),
        analysis(black.after, 0, "g1f3"),
      )?.classification,
    ).toBe("blunder");
  });

  test("keeps known opening moves classified as book", () => {
    const move = game.moves[0];
    expect(
      evaluateVariationMove(
        move,
        1,
        analysis(move.before, 20, "d2d4"),
        analysis(move.after, -200, "e7e5"),
        true,
      )?.classification,
    ).toBe("book");
  });
});
