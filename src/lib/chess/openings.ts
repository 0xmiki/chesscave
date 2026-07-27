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
