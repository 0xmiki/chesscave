import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import {
  codexPositionContext,
  classifyLiveMove,
  isNotableComparison,
  lineToSan,
  moveRecord,
  playUci,
  scoreLabel,
} from "./codex-play";

describe("Codex play foundations", () => {
  test("plays a legal UCI move and rejects malformed moves", () => {
    expect(playUci(new Chess().fen(), "e2e4")?.san).toBe("e4");
    expect(playUci(new Chess().fen(), "e2e5")).toBeNull();
    expect(playUci(new Chess().fen(), "hello")).toBeNull();
  });

  test("turns an engine line into SAN without mutating its position", () => {
    const fen = new Chess().fen();
    expect(
      lineToSan(fen, {
        multipv: 1,
        depth: 30,
        scoreCp: 22,
        scoreMate: null,
        wdl: null,
        moves: ["e2e4", "e7e5", "g1f3"],
      }),
    ).toEqual(["e4", "e5", "Nf3"]);
  });

  test("formats centipawn and mate scores", () => {
    expect(scoreLabel({ multipv: 1, depth: 30, scoreCp: -34, scoreMate: null, wdl: null, moves: [] })).toBe("-0.3");
    expect(scoreLabel({ multipv: 1, depth: 30, scoreCp: null, scoreMate: 3, wdl: null, moves: [] })).toBe("+M3");
  });

  test("builds explicit engine-grounded context", () => {
    const chess = new Chess();
    const move = chess.move("e4");
    const record = moveRecord(move, 1);
    const context = codexPositionContext({
      fen: record.before,
      playerSide: "w",
      opening: "King's Pawn Game",
      history: [record],
      playerMove: record,
      codexMove: { ...record, ply: 2, san: "e5", uci: "e7e5", side: "b" },
      classification: "inaccuracy",
      playerIdea: "Take the center.",
      comparison: {
        expectedPointsLost: 0.12,
        playedLine: { multipv: 1, depth: 28, scoreCp: 5, scoreMate: null, wdl: null, moves: ["e2e4", "e7e5"] },
        analysis: {
          engine: "Stockfish",
          fen: record.before,
          bestMove: "e2e4",
          elapsedMs: 10,
          lines: [{ multipv: 1, depth: 30, scoreCp: 28, scoreMate: null, wdl: null, moves: ["e2e4", "e7e5"] }],
        },
      },
      analysis: {
        engine: "Stockfish",
        fen: record.before,
        bestMove: "e2e4",
        elapsedMs: 10,
        lines: [{ multipv: 1, depth: 30, scoreCp: 28, scoreMate: null, wdl: null, moves: ["e2e4", "e7e5"] }],
      },
    });
    expect(context).toContain("Player just chose: e4 (e2e4)");
    expect(context).toContain("Player's stated idea: Take the center.");
    expect(context).toContain("principal line e4 e5");
    expect(context).toContain("Player move classification: inaccuracy");
    expect(context).toContain("Codex replied: e5 (e7e5)");
    expect(context).toContain("Candidate 1: e4 e5");
    expect(context).toContain("Expected-points loss: 12.0 percentage points");
  });

  test("only surfaces alternatives with meaningful expected-points loss", () => {
    const analysis = {
      engine: "Stockfish",
      fen: new Chess().fen(),
      bestMove: "e2e4",
      elapsedMs: 400,
      lines: [{ multipv: 1, depth: 18, scoreCp: 30, scoreMate: null, wdl: [300, 500, 200] as [number, number, number], moves: ["e2e4"] }],
    };
    const playedLine = { multipv: 1, depth: 16, scoreCp: 10, scoreMate: null, wdl: [220, 500, 280] as [number, number, number], moves: ["d2d4"] };
    expect(isNotableComparison({ analysis, playedLine, expectedPointsLost: 0.04 })).toBe(false);
    expect(isNotableComparison({ analysis, playedLine, expectedPointsLost: 0.12 })).toBe(true);
  });

  test("classifies live feedback from the mover's perspective", () => {
    const analysis = {
      engine: "Stockfish",
      fen: new Chess().fen(),
      bestMove: "e2e4",
      elapsedMs: 400,
      lines: [{ multipv: 1, depth: 16, scoreCp: 180, scoreMate: null, wdl: null, moves: ["e2e4"] }],
    };
    const playedLine = { multipv: 1, depth: 16, scoreCp: -20, scoreMate: null, wdl: null, moves: ["d2d4"] };
    const comparison = { analysis, playedLine, expectedPointsLost: 0.2 };

    expect(classifyLiveMove(comparison, "e2e4", "w")).toBe("best");
    expect(classifyLiveMove(comparison, "d2d4", "w")).toBe("mistake");
    expect(classifyLiveMove(comparison, "d2d4", "w", true)).toBe("book");
  });
});
