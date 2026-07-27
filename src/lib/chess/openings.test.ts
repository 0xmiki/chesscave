import { describe, expect, test } from "bun:test";
import openingData from "../../../static/openings/lichess-openings.json";
import { parsePgn, SAMPLE_PGN } from "./game";
import {
  deepestOpeningPly,
  openingAt,
  openingPositionKey,
  type OpeningBook,
} from "./openings";

const book = openingData as unknown as OpeningBook;

describe("offline opening recognition", () => {
  test("ships the complete pinned Lichess position index", () => {
    expect(book.source.project).toBe("lichess-org/chess-openings");
    expect(book.source.license).toBe("CC0-1.0");
    expect(book.source.namedPositions).toBe(3807);
    expect(Object.keys(book.positions)).toHaveLength(3807);
  });

  test("normalizes FEN to the position fields used by the opening book", () => {
    expect(
      openingPositionKey(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
      ),
    ).toBe(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6",
    );
  });

  test("finds the deepest named opening and retains it later in the game", () => {
    const game = parsePgn(SAMPLE_PGN);
    const bookPly = deepestOpeningPly(book, game.snapshots);
    const opening = openingAt(book, game.snapshots, game.moves.length);

    expect(bookPly).toBeGreaterThanOrEqual(8);
    expect(opening?.eco).toMatch(/^C5/);
    expect(opening?.name).toContain("Evans Gambit");
    expect(opening?.matchedPly).toBe(bookPly);
  });
});
