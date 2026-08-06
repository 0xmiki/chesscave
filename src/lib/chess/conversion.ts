import type {
  EngineLine,
  GameRecord,
  GameReview,
  MoveReview,
  Side,
} from "./types";
import {
  divideGame,
  phaseAtPly,
  winPercentFromCentipawns,
  type ReviewPhase,
} from "./review";

export const CONVERSION_THRESHOLD = 0.75;
export const CONVERSION_ATTEMPTS_STORAGE_KEY =
  "chesscave.conversion-attempts.v1";
export const PRACTICE_LAUNCH_STORAGE_KEY = "chesscave.practice-launch.v1";

export type ConversionSourceOutcome = "win" | "draw" | "loss" | "unknown";
export type ConversionExerciseKind = "convert" | "rescue" | "replay";
export type ConversionLeak = "tactical" | "time" | "endgame" | "drift";
export type PracticeDifficulty = "supportive" | "club" | "strong";

export interface ConversionExercise {
  id: string;
  gameKey: string;
  side: Side;
  kind: ConversionExerciseKind;
  startPly: number;
  startFen: string;
  startingExpectedPoints: number;
  clocks: Record<Side, number | null>;
  phase: ReviewPhase;
  sourceOutcome: ConversionSourceOutcome;
  criticalPly: number | null;
  criticalMove: MoveReview | null;
  leak: ConversionLeak;
  title?: string;
}

export interface PracticeLaunch {
  pgn: string;
  side: Side;
  startPly: number;
  title: string;
  createdAtMs: number;
}

export interface ConversionAttemptRecord {
  id: string;
  exerciseId: string;
  gameKey: string;
  side: Side;
  finishedAtMs: number;
  result: "win" | "draw" | "loss" | "stopped" | "time";
  moveCount: number;
  lowestExpectedPoints: number | null;
}

export function sideForUsername(
  game: GameRecord,
  username: string | null | undefined,
): Side | null {
  const normalized = username?.trim().toLowerCase();
  if (!normalized) return null;
  if (game.headers.White?.trim().toLowerCase() === normalized) return "w";
  if (game.headers.Black?.trim().toLowerCase() === normalized) return "b";
  return null;
}

export function outcomeForSide(
  result: string | undefined,
  side: Side,
): ConversionSourceOutcome {
  if (result === "1/2-1/2" || result === "½-½") return "draw";
  if (result === "1-0") return side === "w" ? "win" : "loss";
  if (result === "0-1") return side === "b" ? "win" : "loss";
  return "unknown";
}

function firstStableAdvantage(moves: MoveReview[]): MoveReview | null {
  const winning = moves.filter(
    (move) => move.expectedPointsBefore >= CONVERSION_THRESHOLD,
  );
  if (!winning.length) return null;

  return (
    winning.find((move) => {
      const nextTurn = moves.find((candidate) => candidate.ply > move.ply);
      return (
        move.expectedPointsAfter >= CONVERSION_THRESHOLD ||
        (nextTurn?.expectedPointsBefore ?? 0) >= 0.68
      );
    }) ?? winning[0]
  );
}

function criticalLossAfter(
  moves: MoveReview[],
  startPly: number,
): MoveReview | null {
  const later = moves.filter((move) => move.ply > startPly);
  if (!later.length) return null;
  return (
    later.find(
      (move) =>
        move.expectedPointsLost >= 0.15 || move.expectedPointsAfter < 0.62,
    ) ??
    later.reduce((worst, move) =>
      move.expectedPointsLost > worst.expectedPointsLost ? move : worst,
    )
  );
}

function leakFor(
  game: GameRecord,
  critical: MoveReview | null,
  phase: ReviewPhase,
): ConversionLeak {
  if (!critical) return phase === "endgame" ? "endgame" : "drift";
  const clock = game.snapshots[critical.ply - 1]?.clocks[critical.color];
  if (clock !== null && clock !== undefined && clock <= 30) return "time";
  if (critical.expectedPointsLost >= 0.2) return "tactical";
  if (phase === "endgame") return "endgame";
  return "drift";
}

function makeExercise(
  game: GameRecord,
  review: GameReview,
  side: Side,
  kind: ConversionExerciseKind,
  start: MoveReview,
  critical: MoveReview | null,
  sourceOutcome: ConversionSourceOutcome,
): ConversionExercise {
  const startPly = start.ply - 1;
  const snapshot = game.snapshots[startPly];
  const phase = phaseAtPly(startPly, divideGame(game));
  return {
    id: `${review.gameKey}:${side}:${kind}:${startPly}`,
    gameKey: review.gameKey,
    side,
    kind,
    startPly,
    startFen: snapshot.fen,
    startingExpectedPoints: start.expectedPointsBefore,
    clocks: { ...snapshot.clocks },
    phase,
    sourceOutcome,
    criticalPly: critical?.ply ?? null,
    criticalMove: critical,
    leak: leakFor(game, critical, phase),
  };
}

/**
 * Extract full-position and critical-moment practice from a game the player
 * failed to win after reaching a meaningful, stable advantage.
 */
export function findConversionExercises(
  game: GameRecord,
  review: GameReview,
  side: Side,
): ConversionExercise[] {
  const sourceOutcome = outcomeForSide(game.headers.Result, side);
  if (sourceOutcome === "win") return [];

  const playerMoves = review.moves.filter((move) => move.color === side);
  const first = firstStableAdvantage(playerMoves);
  if (!first) return [];
  const critical = criticalLossAfter(playerMoves, first.ply - 1);
  const exercises = [
    makeExercise(game, review, side, "convert", first, critical, sourceOutcome),
  ];

  if (
    critical &&
    critical.ply - first.ply >= 4 &&
    critical.expectedPointsBefore >= 0.65
  ) {
    exercises.push(
      makeExercise(
        game,
        review,
        side,
        "rescue",
        critical,
        critical,
        sourceOutcome,
      ),
    );
  }
  return exercises;
}

export function practiceExerciseAtPly(
  game: GameRecord,
  review: GameReview,
  side: Side,
  requestedStartPly: number,
  title = "Replay key moment",
): ConversionExercise | null {
  const startMove = review.moves.find(
    (move) => move.color === side && move.ply - 1 >= requestedStartPly,
  );
  if (!startMove) return null;
  const startPly = startMove.ply - 1;
  const snapshot = game.snapshots[startPly];
  if (!snapshot) return null;
  const phase = phaseAtPly(startPly, divideGame(game));
  return {
    id: `${review.gameKey}:${side}:replay:${startPly}`,
    gameKey: review.gameKey,
    side,
    kind: "replay",
    startPly,
    startFen: snapshot.fen,
    startingExpectedPoints: startMove.expectedPointsBefore,
    clocks: { ...snapshot.clocks },
    phase,
    sourceOutcome: outcomeForSide(game.headers.Result, side),
    criticalPly: startMove.ply,
    criticalMove: startMove,
    leak: leakFor(game, startMove, phase),
    title,
  };
}

/** Return expected score from 0 to 1. Engine lines are White-normalized. */
export function expectedPointsForSide(
  line: EngineLine | null | undefined,
  side: Side,
): number | null {
  if (!line) return null;
  let white: number | null = null;
  if (line.wdl) {
    const total = line.wdl[0] + line.wdl[1] + line.wdl[2];
    if (total > 0) white = (line.wdl[0] + line.wdl[1] * 0.5) / total;
  } else if (line.scoreMate !== null) {
    white = line.scoreMate > 0 ? 1 : 0;
  } else if (line.scoreCp !== null) {
    white = winPercentFromCentipawns(line.scoreCp) / 100;
  }
  if (white === null) return null;
  return side === "w" ? white : 1 - white;
}

export function practiceDepth(difficulty: PracticeDifficulty): number {
  if (difficulty === "supportive") return 10;
  if (difficulty === "strong") return 14;
  return 12;
}

/**
 * Pick from Stockfish's ordered MultiPV set. Lower settings deliberately vary
 * among sound alternatives instead of simulating weakness with blunders.
 */
export function selectPracticeMove(
  lines: EngineLine[],
  difficulty: PracticeDifficulty,
  random = Math.random(),
): string | null {
  const candidates = [...lines]
    .sort((left, right) => left.multipv - right.multipv)
    .map((line) => line.moves[0])
    .filter((move): move is string => Boolean(move));
  if (!candidates.length) return null;

  const weights =
    difficulty === "supportive"
      ? [0.42, 0.27, 0.17, 0.09, 0.05]
      : difficulty === "strong"
        ? [0.86, 0.09, 0.03, 0.015, 0.005]
        : [0.64, 0.21, 0.09, 0.04, 0.02];
  const available = weights.slice(0, candidates.length);
  const total = available.reduce((sum, weight) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, random)) * total;
  for (let index = 0; index < available.length; index += 1) {
    cursor -= available[index];
    if (cursor < 0) return candidates[index];
  }
  return candidates[0];
}

export function loadConversionAttempts(): ConversionAttemptRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = JSON.parse(
      localStorage.getItem(CONVERSION_ATTEMPTS_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (item): item is ConversionAttemptRecord =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as ConversionAttemptRecord).exerciseId === "string",
    );
  } catch {
    return [];
  }
}

export function saveConversionAttempt(record: ConversionAttemptRecord): void {
  if (typeof localStorage === "undefined") return;
  const next = [record, ...loadConversionAttempts()].slice(0, 100);
  localStorage.setItem(CONVERSION_ATTEMPTS_STORAGE_KEY, JSON.stringify(next));
}
