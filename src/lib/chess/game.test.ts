import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import {
  branchGame,
  createVariation,
  extendVariation,
  parsePgn,
  SAMPLE_PGN,
  uciLineToSan,
} from "./game";

describe("game timeline", () => {
  test("builds a snapshot for every ply in the Evergreen Game", () => {
    const game = parsePgn(SAMPLE_PGN);

    expect(game.moves).toHaveLength(47);
    expect(game.snapshots).toHaveLength(48);
    expect(game.moves[15].san).toBe("Qf6");
    expect(new Chess(game.snapshots.at(-1)!.fen).isCheckmate()).toBe(true);
  });

  test("creates a legal branch without mutating the original timeline", () => {
    const game = parsePgn(SAMPLE_PGN);
    const branch = branchGame(game, 16, "c4", "f7");

    expect(branch).not.toBeNull();
    expect(branch!.moves).toHaveLength(17);
    expect(branch!.moves.at(-1)!.lan).toBe("c4f7");
    expect(parsePgn(branch!.pgn).headers.Event).toBe("The Evergreen Game");
    expect(game.moves).toHaveLength(47);
  });

  test("keeps the imported mainline intact while extending an exploration", () => {
    const game = parsePgn(SAMPLE_PGN);
    const variation = createVariation(game, 16, "c4", "f7");

    expect(variation).not.toBeNull();
    expect(variation!.rootPly).toBe(16);
    expect(variation!.moves.map((move) => move.san)).toEqual(["Bxf7+"]);
    expect(game.moves).toHaveLength(47);

    const continuation = extendVariation(variation!, 1, "e8", "f8");
    expect(continuation).not.toBeNull();
    expect(continuation!.moves).toHaveLength(2);
    expect(game.moves[16].san).toBe("e5");
  });

  test("converts engine UCI moves to readable SAN", () => {
    const start = new Chess().fen();
    expect(uciLineToSan(start, ["e2e4", "e7e5", "g1f3"])).toEqual([
      "e4",
      "e5",
      "Nf3",
    ]);
  });

  test("keeps both PGN clocks synchronized with timeline snapshots", () => {
    const game = parsePgn(`[Event "Clock test"]
[White "Student"]
[Black "Opponent"]
[WhiteElo "1305"]
[BlackElo "1334"]
[TimeControl "300+2"]
[Result "*"]

1. e4 {[%clk 0:04:58]} e5 {[%clk 0:04:57]} 2. Nf3 {[%clk 0:04:55]} *`);

    expect(game.snapshots[0].clocks).toEqual({ w: 300, b: 300 });
    expect(game.snapshots[1].clocks).toEqual({ w: 298, b: 300 });
    expect(game.snapshots[2].clocks).toEqual({ w: 298, b: 297 });
    expect(game.snapshots[3].clocks).toEqual({ w: 295, b: 297 });
    expect(game.headers.WhiteElo).toBe("1305");
  });
});
