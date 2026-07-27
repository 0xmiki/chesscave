import { readFile } from "node:fs/promises";
import path from "node:path";

const CRITICAL_CLASSIFICATIONS = new Set([
  "inaccuracy",
  "mistake",
  "blunder",
  "miss",
]);

export function assertGameKey(gameKey) {
  if (typeof gameKey !== "string" || !/^[a-f0-9]{64}$/i.test(gameKey)) {
    throw new Error("game_key must be the 64-character key supplied by ChessCave.");
  }
}

export async function readStoredGameReview(reviewDirectory, gameKey) {
  assertGameKey(gameKey);
  if (!reviewDirectory) {
    throw new Error("ChessCave did not configure the game-review directory.");
  }

  const reviewPath = path.join(reviewDirectory, `${gameKey.toLowerCase()}.json`);
  let review;
  try {
    review = JSON.parse(await readFile(reviewPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "This game does not have a completed ChessCave review yet. Wait for the one-time Stockfish review to finish.",
      );
    }
    throw new Error(`Could not read ChessCave's stored game review: ${error.message}`);
  }

  if (
    review?.gameKey?.toLowerCase() !== gameKey.toLowerCase() ||
    !Array.isArray(review.positions) ||
    !Array.isArray(review.moves) ||
    review.positions.length !== review.moves.length + 1
  ) {
    throw new Error("The stored ChessCave game review is incomplete or inconsistent.");
  }

  return review;
}

function rounded(value, places = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function evaluation(line) {
  if (!line) return null;
  return {
    perspective: "white",
    scoreCp: line.scoreCp ?? null,
    scoreMate: line.scoreMate ?? null,
    wdl: line.wdl ?? null,
    depth: line.depth ?? null,
  };
}

function summarizeMoves(moves) {
  const classifications = {};
  let accuracy = 0;
  let expectedPointsLost = 0;

  for (const move of moves) {
    classifications[move.classification] =
      (classifications[move.classification] || 0) + 1;
    accuracy += Number(move.estimatedAccuracy) || 0;
    expectedPointsLost += Number(move.expectedPointsLost) || 0;
  }

  return {
    moves: moves.length,
    estimatedAccuracy: moves.length ? rounded(accuracy / moves.length, 1) : null,
    totalExpectedPointsLost: rounded(expectedPointsLost),
    averageExpectedPointsLost: moves.length
      ? rounded(expectedPointsLost / moves.length)
      : null,
    classifications,
  };
}

function moveDetail(review, move, includeCandidates) {
  const before = review.positions[move.ply - 1];
  const after = review.positions[move.ply];
  const candidates = includeCandidates
    ? (before?.lines || []).map((line) => ({
        rank: line.multipv,
        evaluation: evaluation(line),
        principalVariation: line.moves,
      }))
    : [];

  return {
    ply: move.ply,
    moveNumber: Math.ceil(move.ply / 2),
    side: move.color === "b" ? "black" : "white",
    playedMove: {
      san: move.san,
      uci: move.uci,
    },
    classification: move.classification,
    expectedPoints: {
      before: move.expectedPointsBefore,
      after: move.expectedPointsAfter,
      lost: move.expectedPointsLost,
    },
    estimatedAccuracy: move.estimatedAccuracy,
    bestMove: {
      uci: move.bestMove ?? before?.bestMove ?? null,
      evaluation: evaluation(before?.lines?.[0]),
      principalVariation: before?.lines?.[0]?.moves || [],
    },
    candidates,
    playedContinuation: {
      evaluation: evaluation(after?.lines?.[0]),
      principalVariation: after?.lines?.[0]?.moves || [],
    },
    fenBefore: before?.fen ?? null,
    fenAfter: after?.fen ?? null,
  };
}

export function createGameReviewDigest(review, options = {}) {
  const focus = ["summary", "critical", "all"].includes(options.focus)
    ? options.focus
    : "critical";
  const side = ["white", "black", "both"].includes(options.side)
    ? options.side
    : "both";
  const requestedLimit = Number(options.limit);
  const defaultLimit = focus === "all" ? review.moves.length : 12;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.round(requestedLimit)))
    : Math.max(1, Math.min(200, defaultLimit));

  const whiteMoves = review.moves.filter((move) => move.color === "w");
  const blackMoves = review.moves.filter((move) => move.color === "b");
  const sideMoves = review.moves.filter(
    (move) =>
      side === "both" ||
      (side === "white" && move.color === "w") ||
      (side === "black" && move.color === "b"),
  );

  let selectedMoves = [];
  if (focus === "all") {
    selectedMoves = sideMoves.slice(0, limit);
  } else if (focus === "critical") {
    const critical = sideMoves.filter(
      (move) =>
        CRITICAL_CLASSIFICATIONS.has(move.classification) ||
        Number(move.expectedPointsLost) > 0.02,
    );
    selectedMoves = [...(critical.length ? critical : sideMoves)]
      .sort(
        (left, right) =>
          Number(right.expectedPointsLost) - Number(left.expectedPointsLost) ||
          left.ply - right.ply,
      )
      .slice(0, limit);
  }

  return {
    gameKey: review.gameKey,
    engine: review.engine,
    reviewModel: review.model,
    nodesPerPosition: review.nodesPerPosition,
    multiPv: review.multiPv,
    moveCount: review.moves.length,
    scorePerspective: "All engine evaluations are normalized to White's perspective.",
    summary: {
      stored: review.summary,
      white: summarizeMoves(whiteMoves),
      black: summarizeMoves(blackMoves),
    },
    selection: {
      focus,
      side,
      returnedMoves: selectedMoves.length,
      availableMovesForSide: sideMoves.length,
      truncated: focus !== "summary" && selectedMoves.length < sideMoves.length,
    },
    moves: selectedMoves.map((move) =>
      moveDetail(review, move, focus === "critical"),
    ),
  };
}
