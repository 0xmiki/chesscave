import { describe, expect, test } from "bun:test";
import { parsePgn } from "./game";
import type { ChessComGame } from "./chesscom";
import type { GameReview, MoveClassification, Side } from "./types";
import {
  buildWeeklyGameInsight,
  buildWeeklyReport,
  rapidGamesLastSevenDays,
  reconcileWeeklyInsights,
} from "./weekly";

const pgn = `[White "Player"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7
6. Re1 b5 7. Bb3 d6 8. c3 O-O 1-0`;

function review(
  accuracy: number,
  classifications: MoveClassification[] = [],
): { game: ReturnType<typeof parsePgn>; review: GameReview } {
  const game = parsePgn(pgn);
  const hasBlunder = classifications.includes("blunder");
  const moves = game.moves.map((move, index) => ({
    ply: index + 1,
    san: move.san,
    uci: `${move.from}${move.to}`,
    color: move.color as Side,
    classification: classifications[Math.floor(index / 2)] ?? "best" as MoveClassification,
    expectedPointsBefore: index === 4 ? 0.8 : 0.55,
    expectedPointsAfter: index === 8 && hasBlunder ? 0.45 : 0.55,
    expectedPointsLost: index === 8 && hasBlunder ? 0.35 : 0,
    estimatedAccuracy: index === 8 && hasBlunder ? 20 : accuracy,
    bestMove: null,
  }));
  return {
    game,
    review: {
      schemaVersion: 4,
      gameKey: String(accuracy),
      engine: "Stockfish",
      nodesPerPosition: 1,
      multiPv: 3,
      createdAtMs: 1,
      cached: false,
      model: "test",
      positions: game.snapshots.map((snapshot) => ({
        ...snapshot,
        bestMove: null,
        elapsedMs: 1,
        lines: [],
      })),
      moves,
      summary: {
        whiteAccuracy: accuracy,
        blackAccuracy: accuracy - 1,
        classifications: {},
        whiteClassifications: {},
        blackClassifications: {},
      },
    },
  };
}

function chessComGame(endTime: number, timeClass = "rapid"): ChessComGame {
  return {
    url: `https://chess.com/game/${endTime}`,
    pgn,
    timeControl: "600",
    endTime,
    rated: true,
    timeClass,
    rules: "chess",
    uuid: String(endTime),
    eco: null,
    accuracies: null,
    white: { username: "Player", rating: 1400, result: "win" },
    black: { username: "Opponent", rating: 1400, result: "checkmated" },
  };
}

describe("weekly Rapid training report", () => {
  test("keeps only standard Rapid games from the trailing seven days", () => {
    const now = Date.UTC(2026, 7, 3, 12) / 1000;
    const games = [
      chessComGame(now - 60),
      chessComGame(now - 8 * 86_400),
      chessComGame(now - 120, "blitz"),
    ];
    expect(rapidGamesLastSevenDays(games, now * 1000)).toHaveLength(1);
  });

  test("scores move quality independently from the result label", () => {
    const clean = review(96, ["best", "excellent", "great"]);
    const insight = buildWeeklyGameInsight(clean.game, clean.review, "w", {
      id: "clean",
      url: "clean",
      opponent: "Opponent",
      endTime: 1,
      outcome: "loss",
    });
    expect(insight.accuracy).toBeGreaterThan(80);
    expect(insight.bestMoment?.classification).toBe("great");
    expect(insight.conversionOpportunity).toBe(true);
    expect(insight.converted).toBe(false);
  });

  test("groups the strongest and most instructive games without overlap", () => {
    const insights = [96, 90, 82, 70].map((accuracy, index) => {
      const item = review(accuracy);
      return buildWeeklyGameInsight(item.game, item.review, "w", {
        id: String(index),
        url: String(index),
        opponent: `Opponent ${index}`,
        endTime: index,
        outcome: index < 2 ? "win" : "loss",
      });
    });
    const report = buildWeeklyReport(insights);
    expect(report.bestGames).toHaveLength(2);
    expect(report.needsWork).toHaveLength(2);
    expect(
      report.bestGames.some((game) =>
        report.needsWork.some((other) => other.id === game.id),
      ),
    ).toBe(false);
    expect(report.strengths.some((signal) => signal.key === "move-quality")).toBe(true);
  });

  test("preserves analyzed games when the full weekly list expands", () => {
    const item = review(91);
    const cached = buildWeeklyGameInsight(item.game, item.review, "w", {
      id: "already-analyzed",
      url: "already-analyzed",
      opponent: "Opponent",
      endTime: 1,
      outcome: "win",
    });

    expect(
      reconcileWeeklyInsights(
        ["new-game", "already-analyzed", "another-new-game"],
        [cached],
      ).map((insight) => insight.id),
    ).toEqual(["already-analyzed"]);
  });
});
