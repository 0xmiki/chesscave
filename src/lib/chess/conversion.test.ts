import { describe, expect, test } from "bun:test";
import { parsePgn } from "./game";
import type { GameReview, MoveReview, Side } from "./types";
import {
  expectedPointsForSide,
  findConversionExercises,
  outcomeForSide,
  practiceExerciseAtPly,
  selectPracticeMove,
  sideForUsername,
} from "./conversion";

const pgn = `[White "CavePlayer"]
[Black "Opponent"]
[Result "0-1"]
[TimeControl "300+2"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7
6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 0-1`;

function reviewFor(values: Array<[number, number, number]>): GameReview {
  const game = parsePgn(pgn);
  const playerMoves = new Map(values.map(([ply, before, loss]) => [ply, { before, loss }]));
  const moves: MoveReview[] = game.moves.map((move, index) => {
    const ply = index + 1;
    const value = playerMoves.get(ply) ?? { before: 0.5, loss: 0 };
    return {
      ply,
      san: move.san,
      uci: `${move.from}${move.to}`,
      color: move.color as Side,
      classification: value.loss >= 0.2 ? "blunder" : "best",
      expectedPointsBefore: value.before,
      expectedPointsAfter: value.before - value.loss,
      expectedPointsLost: value.loss,
      estimatedAccuracy: value.loss ? 20 : 100,
      bestMove: null,
    };
  });
  return {
    schemaVersion: 4,
    gameKey: "conversion-test",
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
      whiteAccuracy: 70,
      blackAccuracy: 90,
      classifications: {},
      whiteClassifications: {},
      blackClassifications: {},
    },
  };
}

describe("conversion training", () => {
  test("identifies the player's side and source result", () => {
    const game = parsePgn(pgn);
    expect(sideForUsername(game, "caveplayer")).toBe("w");
    expect(sideForUsername(game, "missing")).toBeNull();
    expect(outcomeForSide("0-1", "w")).toBe("loss");
    expect(outcomeForSide("0-1", "b")).toBe("win");
  });

  test("extracts a closeout and later rescue position from a failed win", () => {
    const game = parsePgn(pgn);
    const review = reviewFor([
      [5, 0.78, 0.01],
      [7, 0.8, 0.02],
      [9, 0.79, 0.01],
      [11, 0.77, 0.03],
      [13, 0.72, 0.31],
    ]);
    const exercises = findConversionExercises(game, review, "w");

    expect(exercises.map((exercise) => exercise.kind)).toEqual([
      "convert",
      "rescue",
    ]);
    expect(exercises[0].startPly).toBe(4);
    expect(exercises[0].criticalPly).toBe(13);
    expect(exercises[0].leak).toBe("tactical");
    expect(exercises[1].startPly).toBe(12);
  });

  test("does not prescribe failed-conversion work for a game already won", () => {
    const game = parsePgn(pgn.replaceAll("0-1", "1-0"));
    const review = reviewFor([[5, 0.85, 0]]);
    expect(findConversionExercises(game, review, "w")).toEqual([]);
  });

  test("normalizes engine expected score for either player", () => {
    const line = {
      multipv: 1,
      depth: 12,
      scoreCp: 180,
      scoreMate: null,
      wdl: [700, 250, 50] as [number, number, number],
      moves: ["e2e4"],
    };
    expect(expectedPointsForSide(line, "w")).toBeCloseTo(0.825);
    expect(expectedPointsForSide(line, "b")).toBeCloseTo(0.175);
  });

  test("uses difficulty-weighted sound engine alternatives", () => {
    const lines = [1, 2, 3].map((multipv) => ({
      multipv,
      depth: 12,
      scoreCp: 100 - multipv,
      scoreMate: null,
      wdl: null,
      moves: [`a${multipv}a${multipv + 1}`],
    }));
    expect(selectPracticeMove(lines, "strong", 0)).toBe("a1a2");
    expect(selectPracticeMove(lines, "supportive", 0.95)).toBe("a3a4");
  });

  test("creates a general replay exercise at the next player decision", () => {
    const game = parsePgn(pgn);
    const review = reviewFor([[9, 0.72, 0.08]]);
    const exercise = practiceExerciseAtPly(
      game,
      review,
      "w",
      7,
      "Replay your critical moment",
    );
    expect(exercise?.kind).toBe("replay");
    expect(exercise?.startPly).toBe(8);
    expect(exercise?.title).toBe("Replay your critical moment");
  });
});
