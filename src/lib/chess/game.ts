import { Chess, type Move } from "chess.js";
import type {
  GameMove,
  GameRecord,
  GameSnapshot,
  VariationLine,
} from "./types";
import {
  clockFromComment,
  initialTimeControlSeconds,
  parseClockValue,
} from "./time";

export const SAMPLE_PGN = `[Event "The Evergreen Game"]
[Site "Berlin GER"]
[Date "1852.??.??"]
[Round "?"]
[White "Adolf Anderssen"]
[Black "Jean Dufresne"]
[Result "1-0"]
[Opening "Evans Gambit"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4
7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8
13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6
18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7
22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7# 1-0`;

function toGameMove(move: Move): GameMove {
  return {
    san: move.san,
    lan: move.lan,
    from: move.from,
    to: move.to,
    color: move.color,
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion,
    before: move.before,
    after: move.after,
  };
}

export function parsePgn(pgn: string): GameRecord {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const history = chess.history({ verbose: true });
  const moves = history.map(toGameMove);
  const initialFen = history[0]?.before ?? new Chess().fen();
  const headers = chess.getHeaders();
  const comments = new Map(
    chess.getComments().map(({ fen, comment }) => [fen, comment]),
  );
  const defaultClock = initialTimeControlSeconds(headers.TimeControl);
  let clocks: Record<"w" | "b", number | null> = {
    w: parseClockValue(headers.WhiteClock) ?? defaultClock,
    b: parseClockValue(headers.BlackClock) ?? defaultClock,
  };
  const snapshots: GameSnapshot[] = [
    {
      fen: initialFen,
      ply: 0,
      lastMove: null,
      clocks: { ...clocks },
    },
  ];

  for (const [index, move] of moves.entries()) {
    const annotatedClock = clockFromComment(comments.get(move.after));
    if (annotatedClock !== null) {
      clocks = { ...clocks, [move.color]: annotatedClock };
    }
    snapshots.push({
      fen: move.after,
      ply: index + 1,
      lastMove: { from: move.from, to: move.to },
      clocks: { ...clocks },
    });
  }

  return {
    headers,
    pgn,
    moves,
    snapshots,
  };
}

export function branchGame(
  game: GameRecord,
  ply: number,
  from: string,
  to: string,
  promotion = "q",
): GameRecord | null {
  const position = new Chess(game.snapshots[ply].fen);
  let move: Move;

  try {
    move = position.move({ from, to, promotion });
  } catch {
    return null;
  }

  const nextMove = toGameMove(move);
  const moves = [...game.moves.slice(0, ply), nextMove];
  const snapshots = [
    ...game.snapshots.slice(0, ply + 1),
    {
      fen: nextMove.after,
      ply: ply + 1,
      lastMove: { from: nextMove.from, to: nextMove.to },
      clocks: { ...game.snapshots[ply].clocks },
    },
  ];

  const rebuilt = new Chess(snapshots[0].fen);
  for (const item of moves) {
    rebuilt.move({ from: item.from, to: item.to, promotion: item.promotion });
  }
  const headers = { ...game.headers, Result: "*" };
  for (const [key, value] of Object.entries(headers)) {
    rebuilt.setHeader(key, value);
  }

  return {
    headers,
    pgn: rebuilt.pgn(),
    moves,
    snapshots,
  };
}

function makeMove(
  snapshot: GameSnapshot,
  from: string,
  to: string,
  promotion = "q",
): GameMove | null {
  const position = new Chess(snapshot.fen);
  try {
    return toGameMove(position.move({ from, to, promotion }));
  } catch {
    return null;
  }
}

export function createVariation(
  game: GameRecord,
  rootPly: number,
  from: string,
  to: string,
  promotion = "q",
): VariationLine | null {
  const root = game.snapshots[rootPly];
  if (!root) return null;
  const move = makeMove(root, from, to, promotion);
  if (!move) return null;

  return {
    rootPly,
    moves: [move],
    snapshots: [
      root,
      {
        fen: move.after,
        ply: rootPly + 1,
        lastMove: { from: move.from, to: move.to },
        clocks: { ...root.clocks },
      },
    ],
  };
}

export function extendVariation(
  variation: VariationLine,
  variationPly: number,
  from: string,
  to: string,
  promotion = "q",
): VariationLine | null {
  const root = variation.snapshots[variationPly];
  if (!root) return null;
  const move = makeMove(root, from, to, promotion);
  if (!move) return null;

  return {
    rootPly: variation.rootPly,
    moves: [...variation.moves.slice(0, variationPly), move],
    snapshots: [
      ...variation.snapshots.slice(0, variationPly + 1),
      {
        fen: move.after,
        ply: variation.rootPly + variationPly + 1,
        lastMove: { from: move.from, to: move.to },
        clocks: { ...root.clocks },
      },
    ],
  };
}

export function variationPositionLabel(
  variation: VariationLine,
  variationPly: number,
): string {
  if (variationPly === 0) return "Variation start";
  const move = variation.moves[variationPly - 1];
  const absolutePly = variation.rootPly + variationPly;
  const moveNumber = Math.ceil(absolutePly / 2);
  return `${moveNumber}${absolutePly % 2 === 0 ? "…" : "."} ${move.san} · variation`;
}

export function positionLabel(game: GameRecord, ply: number): string {
  if (ply === 0) return "Starting position";
  const move = game.moves[ply - 1];
  const moveNumber = Math.ceil(ply / 2);
  return `${moveNumber}${ply % 2 === 0 ? "…" : "."} ${move.san}`;
}

export function uciLineToSan(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const san: string[] = [];

  for (const uci of uciMoves) {
    if (uci.length < 4) break;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
      san.push(move.san);
    } catch {
      break;
    }
  }

  return san;
}

export function sideToMove(fen: string): "White" | "Black" {
  return fen.split(" ")[1] === "b" ? "Black" : "White";
}
