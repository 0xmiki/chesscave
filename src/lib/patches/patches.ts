import { Chess } from "chess.js";
import type {
  GeneratedPatchCopy,
  NewPatchCardInput,
  PatchCard,
  PatchMove,
  PatchOrientation,
  PatchReviewResult,
  PatchSource,
} from "./types";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function concise(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maximum) : fallback;
}

export function legalPatchMove(fen: string, value: string): PatchMove | null {
  const candidate = value.trim();
  if (!candidate) return null;
  const chess = new Chess(fen);
  try {
    const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(candidate)
      ? chess.move({
          from: candidate.slice(0, 2).toLowerCase(),
          to: candidate.slice(2, 4).toLowerCase(),
          promotion: candidate[4]?.toLowerCase() ?? "q",
        })
      : chess.move(candidate);
    return move
      ? {
          uci: `${move.from}${move.to}${move.promotion ?? ""}`,
          san: move.san,
        }
      : null;
  } catch {
    return null;
  }
}

export function parseGeneratedPatchCopy(
  value: string,
  fallback: GeneratedPatchCopy,
): GeneratedPatchCopy {
  const unfenced = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return {
      mistake: concise(parsed.mistake, fallback.mistake, 600),
      prompt: concise(parsed.prompt, fallback.prompt, 220),
      explanation: concise(parsed.explanation, fallback.explanation, 700),
      principle: concise(parsed.principle, fallback.principle, 240),
    };
  } catch {
    return fallback;
  }
}

export function patchStudentSide(source: PatchSource): PatchOrientation {
  return source.studentSide ?? source.orientation;
}

export function isPatchForStudentTurn(source: PatchSource): boolean {
  const turn = new Chess(source.fen).turn() === "w" ? "white" : "black";
  return patchStudentSide(source) === turn;
}

export function createPatchCard(input: NewPatchCardInput): PatchCard {
  if (!isPatchForStudentTurn(input.source)) {
    throw new Error("A patch can only be created from the student's turn.");
  }
  const now = input.now ?? Date.now();
  return {
    schemaVersion: 1,
    id: input.id ?? crypto.randomUUID(),
    source: input.source,
    diagnosis: {
      mistake: input.generated.mistake.trim(),
      proposedCorrection: input.proposedCorrection.trim(),
    },
    quiz: {
      kind: "find-move",
      prompt: input.generated.prompt.trim(),
      acceptedMoves: [input.acceptedMove],
    },
    revealBlocks: [
      { type: "explanation", text: input.generated.explanation.trim() },
      { type: "principle", text: input.generated.principle.trim() },
      ...(input.principalVariation.length
        ? [{ type: "variation" as const, moves: input.principalVariation }]
        : []),
    ],
    schedule: {
      dueAt: now,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      lastReviewedAt: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function reviewPatchCard(
  card: PatchCard,
  result: PatchReviewResult,
  now = Date.now(),
): PatchCard {
  if (result === "again") {
    return {
      ...card,
      schedule: {
        dueAt: now + 10 * MINUTE_MS,
        intervalDays: 0,
        repetitions: 0,
        lapses: card.schedule.lapses + 1,
        lastReviewedAt: now,
      },
      updatedAt: now,
    };
  }

  const repetitions = card.schedule.repetitions + 1;
  const intervalDays =
    repetitions === 1
      ? 1
      : repetitions === 2
        ? 3
        : Math.max(6, Math.round(card.schedule.intervalDays * 2));
  return {
    ...card,
    schedule: {
      ...card.schedule,
      dueAt: now + intervalDays * DAY_MS,
      intervalDays,
      repetitions,
      lastReviewedAt: now,
    },
    updatedAt: now,
  };
}

export function isAcceptedPatchMove(card: PatchCard, uci: string): boolean {
  return card.quiz.acceptedMoves.some((move) => move.uci === uci);
}
