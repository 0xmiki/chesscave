import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  createPositionImage,
  parseClockTimestamp,
  selectReviewedPosition,
} from "./chesscave-board-image.mjs";

const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const review = {
  gameKey: "a".repeat(64),
  positions: [
    {
      ply: 0,
      fen: startFen,
      clocks: { w: 600, b: 600 },
      lastMove: null,
    },
    {
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      clocks: { w: 590, b: 600 },
      lastMove: { from: "e2", to: "e4" },
    },
    {
      ply: 2,
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      clocks: { w: 590, b: 585 },
      lastMove: { from: "e7", to: "e5" },
    },
    {
      ply: 3,
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
      clocks: { w: 580, b: 585 },
      lastMove: { from: "g1", to: "f3" },
    },
  ],
  moves: [
    { ply: 1, san: "e4" },
    { ply: 2, san: "e5" },
    { ply: 3, san: "Nf3" },
  ],
};

describe("clock-addressable MCP board images", () => {
  test("parses the clock formats shown in the app", () => {
    expect(parseClockTimestamp("8:34")).toBe(514);
    expect(parseClockTimestamp("1:08:34")).toBe(4114);
    expect(() => parseClockTimestamp("8:72")).toThrow();
  });

  test("selects the exact ply or the move where a player's clock changed", () => {
    expect(selectReviewedPosition(review, { ply: 3 }).position.ply).toBe(3);

    const selected = selectReviewedPosition(review, {
      clock: "9:45",
      clock_side: "black",
    });
    expect(selected.position.ply).toBe(2);
    expect(selected.matchedClock).toMatchObject({
      side: "black",
      displayed: "9:45",
      differenceSeconds: 0,
    });
  });

  test("renders a PNG image and returns position metadata", async () => {
    const pieceDirectory = path.join(import.meta.dir, "../static/pieces/neo");
    const result = await createPositionImage(
      review,
      { clock: "9:45", clock_side: "black", orientation: "white" },
      pieceDirectory,
    );

    expect(result.png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.png.readUInt32BE(16)).toBe(768);
    expect(result.png.readUInt32BE(20)).toBe(768);
    expect(result.metadata).toMatchObject({
      ply: 2,
      positionLabel: "1… e5",
      sideToMove: "white",
      lastMove: { from: "e7", to: "e5" },
      clocks: {
        white: { displayed: "9:50" },
        black: { displayed: "9:45" },
      },
    });
  });
});
