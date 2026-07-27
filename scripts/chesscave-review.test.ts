import { describe, expect, test } from "bun:test";
import {
  assertGameKey,
  createGameReviewDigest,
} from "./chesscave-review.mjs";

const line = (scoreCp: number, moves: string[], multipv = 1) => ({
  multipv,
  depth: 18,
  scoreCp,
  scoreMate: null,
  wdl: null,
  moves,
});

const review = {
  gameKey: "a".repeat(64),
  engine: "Stockfish",
  model: "test-review",
  nodesPerPosition: 60_000,
  multiPv: 3,
  summary: {
    whiteAccuracy: 80,
    blackAccuracy: 70,
    classifications: { mistake: 1, blunder: 1, best: 1 },
  },
  positions: [
    {
      ply: 0,
      fen: "before-white",
      bestMove: "e2e4",
      lines: [line(20, ["e2e4", "e7e5"]), line(15, ["d2d4"], 2)],
    },
    {
      ply: 1,
      fen: "before-black",
      bestMove: "e7e5",
      lines: [line(70, ["e7e5", "g1f3"])],
    },
    {
      ply: 2,
      fen: "before-white-best",
      bestMove: "g1f3",
      lines: [line(250, ["g1f3"])],
    },
    {
      ply: 3,
      fen: "after",
      bestMove: "b8c6",
      lines: [line(240, ["b8c6"])],
    },
  ],
  moves: [
    {
      ply: 1,
      san: "a3",
      uci: "a2a3",
      color: "w",
      classification: "mistake",
      expectedPointsBefore: 0.55,
      expectedPointsAfter: 0.4,
      expectedPointsLost: 0.15,
      estimatedAccuracy: 68.7,
      bestMove: "e2e4",
    },
    {
      ply: 2,
      san: "a6",
      uci: "a7a6",
      color: "b",
      classification: "blunder",
      expectedPointsBefore: 0.6,
      expectedPointsAfter: 0.35,
      expectedPointsLost: 0.25,
      estimatedAccuracy: 53.5,
      bestMove: "e7e5",
    },
    {
      ply: 3,
      san: "Nf3",
      uci: "g1f3",
      color: "w",
      classification: "best",
      expectedPointsBefore: 0.65,
      expectedPointsAfter: 0.65,
      expectedPointsLost: 0,
      estimatedAccuracy: 100,
      bestMove: "g1f3",
    },
  ],
};

describe("whole-game MCP review digest", () => {
  test("rejects keys that could escape the review directory", () => {
    expect(() => assertGameKey("../../secret")).toThrow();
    expect(() => assertGameKey("a".repeat(64))).not.toThrow();
  });

  test("ranks critical moments by expected points lost", () => {
    const digest = createGameReviewDigest(review, { focus: "critical" });
    expect(digest.moves.map((move) => move.ply)).toEqual([2, 1]);
    expect(digest.moves[0].bestMove.uci).toBe("e7e5");
    expect(digest.moves[0].bestMove.principalVariation).toEqual([
      "e7e5",
      "g1f3",
    ]);
  });

  test("filters the report by player side", () => {
    const digest = createGameReviewDigest(review, {
      focus: "all",
      side: "white",
    });
    expect(digest.moves.map((move) => move.ply)).toEqual([1, 3]);
    expect(digest.summary.white.moves).toBe(2);
    expect(digest.summary.black.moves).toBe(1);
  });

  test("returns summary-only reports without move payloads", () => {
    const digest = createGameReviewDigest(review, { focus: "summary" });
    expect(digest.moves).toEqual([]);
    expect(digest.selection.returnedMoves).toBe(0);
  });
});
