import { Chess } from "chess.js";
import type { GameSnapshot } from "./types";

export type OpeningPosition = [
  eco: string,
  name: string,
  canonicalPly: number,
  uci: string,
];

export interface OpeningBook {
  schemaVersion: number;
  source: {
    project: string;
    revision: string;
    license: string;
    sourceRows: number;
    namedPositions: number;
  };
  positions: Record<string, OpeningPosition>;
}

export interface OpeningMatch {
  eco: string;
  name: string;
  matchedPly: number;
  canonicalPly: number;
  uci: string;
}

export interface OpeningContinuation {
  uci: string;
  match: OpeningMatch;
}

const TEACHING_REPERTOIRES: Record<string, string[]> = {
  white: ["e2e4", "d2d4", "c2c4", "g1f3"],
  black: ["d7d5", "e7e5", "g8f6", "c7c5", "e7e6", "g7g6"],
  e2e4: ["e7e5", "c7c5", "e7e6", "c7c6", "d7d5", "g8f6", "d7d6", "g7g6"],
  d2d4: ["d7d5", "g8f6", "f7f5", "c7c5", "e7e6", "g7g6"],
  c2c4: ["e7e5", "c7c5", "g8f6", "e7e6", "g7g6", "f7f5"],
  g1f3: ["d7d5", "g8f6", "c7c5", "g7g6", "e7e6", "f7f5"],
};

let openingBookPromise: Promise<OpeningBook> | null = null;

export function openingPositionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function exactOpening(
  book: OpeningBook | null,
  fen: string,
  matchedPly: number,
): OpeningMatch | null {
  const entry = book?.positions[openingPositionKey(fen)];
  if (!entry) return null;
  const [eco, name, canonicalPly, uci] = entry;
  return { eco, name, matchedPly, canonicalPly, uci };
}

/**
 * Identify the opening at a point in a line. Walking backward is deliberate:
 * it preserves the deepest named opening after the game has left book theory
 * and handles transpositions by position rather than by move-string prefix.
 */
export function openingAt(
  book: OpeningBook | null,
  snapshots: GameSnapshot[],
  currentPly: number,
): OpeningMatch | null {
  if (!book || currentPly <= 0) return null;
  const lastIndex = Math.min(currentPly, snapshots.length - 1);

  for (let ply = lastIndex; ply > 0; ply -= 1) {
    const match = exactOpening(book, snapshots[ply].fen, ply);
    if (match) return match;
  }
  return null;
}

export function deepestOpeningPly(
  book: OpeningBook | null,
  snapshots: GameSnapshot[],
): number {
  if (!book) return 0;
  for (let ply = snapshots.length - 1; ply > 0; ply -= 1) {
    if (book.positions[openingPositionKey(snapshots[ply].fen)]) return ply;
  }
  return 0;
}

export function openingContinuations(
  book: OpeningBook | null,
  fen: string,
  nextPly: number,
): OpeningContinuation[] {
  if (!book) return [];
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).flatMap((move) => {
    const next = new Chess(fen);
    next.move({ from: move.from, to: move.to, promotion: move.promotion });
    const match = exactOpening(book, next.fen(), nextPly);
    return match
      ? [{ uci: `${move.from}${move.to}${move.promotion ?? ""}`, match }]
      : [];
  });
}

export function teachingRepertoire(
  nextPly: number,
  firstMoveUci: string | null | undefined,
): string[] {
  if (nextPly === 1) return TEACHING_REPERTOIRES.white;
  if (nextPly === 2) return TEACHING_REPERTOIRES[firstMoveUci ?? ""] ?? TEACHING_REPERTOIRES.black;
  return [];
}

export function chooseTeachingContinuation(
  continuations: OpeningContinuation[],
  preferredMoves: string[],
  rotation: number,
): OpeningContinuation | null {
  if (!continuations.length) return null;
  const byMove = new Map(continuations.map((continuation) => [continuation.uci, continuation]));
  const preferred = preferredMoves.flatMap((uci) => {
    const continuation = byMove.get(uci);
    return continuation ? [continuation] : [];
  });
  const pool = preferred.length
    ? preferred
    : [...continuations]
        .sort((left, right) => {
          const depth = right.match.canonicalPly - left.match.canonicalPly;
          return depth || left.match.name.localeCompare(right.match.name);
        })
        .slice(0, 4);
  const index = ((rotation % pool.length) + pool.length) % pool.length;
  return pool[index];
}

export function loadOpeningBook(): Promise<OpeningBook> {
  if (!openingBookPromise) {
    openingBookPromise = fetch("/openings/lichess-openings.json").then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Opening book could not be loaded (${response.status}).`);
        }
        return (await response.json()) as OpeningBook;
      },
    );
  }
  return openingBookPromise;
}
