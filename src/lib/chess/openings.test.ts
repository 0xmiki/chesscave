import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import openingData from "../../../static/openings/lichess-openings.json";
import { parsePgn, SAMPLE_PGN } from "./game";
import {
  chooseTeachingContinuation,
  deepestOpeningPly,
  openingContinuations,
  openingAt,
  openingPositionKey,
  teachingRepertoire,
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

  test("finds legal book continuations without running an engine", () => {
    const continuations = openingContinuations(book, new Chess().fen(), 1);
    expect(continuations.length).toBeGreaterThan(0);
    expect(continuations.every((item) => /^[a-h][1-8][a-h][1-8]/.test(item.uci))).toBe(true);
    expect(continuations.some((item) => item.uci === "e2e4")).toBe(true);
  });

  test("rotates through mainstream teaching replies instead of obscure defenses", () => {
    const position = new Chess();
    position.move("d4");
    const continuations = openingContinuations(book, position.fen(), 2);
    const repertoire = teachingRepertoire(2, "d2d4");

    expect(repertoire.slice(0, 4)).toEqual(["d7d5", "g8f6", "f7f5", "c7c5"]);
    expect(
      [0, 1, 2, 3].map((rotation) =>
        chooseTeachingContinuation(continuations, repertoire, rotation)?.uci,
      ),
    ).toEqual(["d7d5", "g8f6", "f7f5", "c7c5"]);
    expect(chooseTeachingContinuation(continuations, repertoire, 0)?.match.name).not.toContain(
      "Australian",
    );
  });

  test("varies Codex's first move across major opening systems", () => {
    const continuations = openingContinuations(book, new Chess().fen(), 1);
    const repertoire = teachingRepertoire(1, null);
    expect(
      [0, 1, 2, 3].map((rotation) =>
        chooseTeachingContinuation(continuations, repertoire, rotation)?.uci,
      ),
    ).toEqual(["e2e4", "d2d4", "c2c4", "g1f3"]);
  });

  test("uses sound central replies after an unusual first move", () => {
    expect(teachingRepertoire(2, "a2a3")).toEqual([
      "d7d5",
      "e7e5",
      "g8f6",
      "c7c5",
      "e7e6",
      "g7g6",
    ]);
  });
});
