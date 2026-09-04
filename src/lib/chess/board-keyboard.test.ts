import { describe, expect, test } from "bun:test";
import { nextBoardSquare } from "./board-keyboard";

describe("chessboard keyboard navigation", () => {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];

  test("moves through the board as it appears on screen", () => {
    expect(nextBoardSquare(files, ranks, "d4", "ArrowLeft")).toBe("c4");
    expect(nextBoardSquare(files, ranks, "d4", "ArrowRight")).toBe("e4");
    expect(nextBoardSquare(files, ranks, "d4", "ArrowUp")).toBe("d5");
    expect(nextBoardSquare(files, ranks, "d4", "ArrowDown")).toBe("d3");
    expect(nextBoardSquare(files, ranks, "d4", "Home")).toBe("a4");
    expect(nextBoardSquare(files, ranks, "d4", "End")).toBe("h4");
  });

  test("follows a flipped board and stops at its edges", () => {
    const flippedFiles = [...files].reverse();
    const flippedRanks = [...ranks].reverse();
    expect(nextBoardSquare(flippedFiles, flippedRanks, "d4", "ArrowLeft")).toBe("e4");
    expect(nextBoardSquare(flippedFiles, flippedRanks, "d4", "ArrowUp")).toBe("d3");
    expect(nextBoardSquare(files, ranks, "a8", "ArrowLeft")).toBe("a8");
    expect(nextBoardSquare(files, ranks, "h1", "ArrowDown")).toBe("h1");
  });
});
