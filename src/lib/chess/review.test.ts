import { describe, expect, test } from "bun:test";
import { parsePgn, SAMPLE_PGN } from "./game";
import type { GameReview, PositionReview } from "./types";
import {
  buildReviewPresentation,
  divideGame,
  moveAccuracyFromWinPercentLoss,
  phaseAtPly,
  winPercentFromCentipawns,
} from "./review";

function position(
  ply: number,
  fen: string,
  scoreCp: number,
): PositionReview {
  return {
    ply,
    fen,
    clocks: { w: null, b: null },
    lastMove: null,
    bestMove: null,
    elapsedMs: 1,
    lines: [
      {
        multipv: 1,
        depth: 18,
        scoreCp,
        scoreMate: null,
        wdl: null,
        moves: ["a2a3"],
      },
    ],
  };
}

describe("Lichess-derived review metrics", () => {
  test("maps centipawns to bounded winning chances", () => {
    expect(winPercentFromCentipawns(0)).toBe(50);
    expect(winPercentFromCentipawns(100)).toBeCloseTo(59.1, 1);
    expect(winPercentFromCentipawns(10_000)).toBeCloseTo(
      winPercentFromCentipawns(1000),
      8,
    );
  });

  test("gives perfect moves 100 and penalizes larger Win% losses", () => {
    expect(moveAccuracyFromWinPercentLoss(0)).toBe(100);
    expect(moveAccuracyFromWinPercentLoss(5)).toBeGreaterThan(
      moveAccuracyFromWinPercentLoss(15),
    );
    expect(moveAccuracyFromWinPercentLoss(100)).toBe(0);
  });

  test("uses board state rather than fixed move numbers for phase division", () => {
    const game = parsePgn(SAMPLE_PGN);
    const division = divideGame(game);

    expect(division.middlegamePly).not.toBeNull();
    expect(phaseAtPly(0, division)).toBe("opening");
    expect(phaseAtPly(division.middlegamePly!, division)).not.toBe("opening");
  });

  test("overlays book moves and counts classifications per player", () => {
    const game = parsePgn(`1. e4 e5 2. Nf3 Nc6 *`);
    const scores = [15, 20, 12, 18, 10];
    const positions = game.snapshots.map((snapshot, index) =>
      position(index, snapshot.fen, scores[index]),
    );
    const review: GameReview = {
      schemaVersion: 3,
      gameKey: "a".repeat(64),
      engine: "Stockfish",
      nodesPerPosition: 60_000,
      multiPv: 3,
      createdAtMs: 1,
      cached: false,
      model: "test",
      positions,
      moves: game.moves.map((move, index) => ({
        ply: index + 1,
        san: move.san,
        uci: `${move.from}${move.to}`,
        color: move.color,
        classification: index === 2 ? "excellent" : "best",
        expectedPointsBefore: 0.5,
        expectedPointsAfter: 0.5,
        expectedPointsLost: 0,
        estimatedAccuracy: 100 - index,
        bestMove: null,
      })),
      summary: {
        whiteAccuracy: 99,
        blackAccuracy: 98,
        classifications: { best: 3, excellent: 1 },
        whiteClassifications: { best: 1, excellent: 1 },
        blackClassifications: { best: 2 },
      },
    };

    const presentation = buildReviewPresentation(game, review, 2);
    expect(presentation.moves.slice(0, 2).map((move) => move.classification)).toEqual([
      "book",
      "book",
    ]);
    expect(presentation.sides.w.classifications.book).toBe(1);
    expect(presentation.sides.b.classifications.book).toBe(1);
    expect(presentation.sides.w.classifications.excellent).toBe(1);
    expect(presentation.graph).toHaveLength(5);
  });
});
