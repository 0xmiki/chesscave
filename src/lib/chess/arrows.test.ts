import { describe, expect, test } from "bun:test";
import {
  arrowColorFromModifiers,
  arrowGeometry,
  bestAlternativeArrow,
  highlightColorFromModifiers,
  squareFromBoardPoint,
  uciToArrow,
} from "./arrows";

describe("board arrows", () => {
  test("turns a Stockfish UCI move into a board arrow", () => {
    expect(uciToArrow("e2e4")).toEqual({
      from: "e2",
      to: "e4",
      color: "engine",
    });
    expect(uciToArrow("e7e8q")?.to).toBe("e8");
    expect(uciToArrow("not-a-move")).toBeNull();
  });

  test("shows an alternative only when the played move was not best", () => {
    expect(bestAlternativeArrow("d2d4", "e2e4")).toEqual({
      from: "e2",
      to: "e4",
      color: "engine",
    });
    expect(bestAlternativeArrow("e2e4", "e2e4")).toBeNull();
    expect(bestAlternativeArrow("d2d4", "e2e4", true)).toBeNull();
  });

  test("maps board points correctly in both orientations", () => {
    expect(squareFromBoardPoint(0.2, 0.3, false)).toBe("a8");
    expect(squareFromBoardPoint(7.2, 7.3, false)).toBe("h1");
    expect(squareFromBoardPoint(0.2, 0.3, true)).toBe("h1");
    expect(squareFromBoardPoint(8, 2, false)).toBeNull();
  });

  test("matches Chess.com-style modifier colors", () => {
    expect(
      arrowColorFromModifiers({
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe("yellow");
    expect(
      arrowColorFromModifiers({
        altKey: false,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe("green");
    expect(
      arrowColorFromModifiers({
        altKey: true,
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("blue");
    expect(
      highlightColorFromModifiers({
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe("red");
    expect(
      highlightColorFromModifiers({
        altKey: false,
        ctrlKey: true,
        shiftKey: false,
      }),
    ).toBe("yellow");
  });

  test("flips arrow geometry with the board", () => {
    const arrow = uciToArrow("e2e4")!;
    const white = arrowGeometry(arrow, false);
    const black = arrowGeometry(arrow, true);

    expect(white.startX).toBe(4.5);
    expect(white.startY).toBe(6.5);
    expect(white.tipY).toBe(4.5);
    expect(black.startX).toBe(3.5);
    expect(black.startY).toBe(1.5);
    expect(black.tipY).toBe(3.5);
  });
});
