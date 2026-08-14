export type PatchOrientation = "white" | "black";
export type PatchReviewResult = "again" | "understood";

export interface PatchMove {
  uci: string;
  san: string;
}

export interface PatchSource {
  gameKey: string | null;
  sourceUrl: string | null;
  gameTitle: string;
  pgn: string;
  decisionPly: number;
  fen: string;
  orientation: PatchOrientation;
  playedMove: PatchMove | null;
  clocks: { w: number | null; b: number | null };
}

export interface FindMoveQuiz {
  kind: "find-move";
  prompt: string;
  acceptedMoves: PatchMove[];
}

export type PatchRevealBlock =
  | { type: "explanation"; text: string }
  | { type: "principle"; text: string }
  | { type: "variation"; moves: string[] };

export interface PatchSchedule {
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: number | null;
}

export interface PatchCard {
  schemaVersion: 1;
  id: string;
  source: PatchSource;
  diagnosis: {
    mistake: string;
    proposedCorrection: string;
  };
  quiz: FindMoveQuiz;
  revealBlocks: PatchRevealBlock[];
  schedule: PatchSchedule;
  createdAt: number;
  updatedAt: number;
}

export interface GeneratedPatchCopy {
  prompt: string;
  explanation: string;
  principle: string;
}

export interface NewPatchCardInput {
  source: PatchSource;
  mistake: string;
  proposedCorrection: string;
  acceptedMove: PatchMove;
  principalVariation: string[];
  generated: GeneratedPatchCopy;
  now?: number;
  id?: string;
}
