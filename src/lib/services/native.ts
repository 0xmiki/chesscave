import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnalysisResult,
  EngineStatus,
  GameRecord,
  GameReview,
  ReviewProgress,
} from "$lib/chess/types";

export function hasNativeHost(): boolean {
  return isTauri();
}

export async function getEngineStatus(): Promise<EngineStatus> {
  if (!isTauri()) {
    return {
      available: false,
      name: null,
      path: null,
      message: "Desktop services are unavailable in browser preview.",
    };
  }
  return invoke<EngineStatus>("engine_status");
}

export async function analyzePosition(
  fen: string,
  depth = 16,
  multiPv = 3,
): Promise<AnalysisResult> {
  return invoke<AnalysisResult>("analyze_position", { fen, depth, multiPv });
}

export async function reviewGame(
  game: GameRecord,
  force = false,
  nodes = 60_000,
  multiPv = 3,
): Promise<GameReview> {
  return invoke<GameReview>("review_game", {
    positions: game.snapshots.map((snapshot) => ({
      ply: snapshot.ply,
      fen: snapshot.fen,
      clocks: snapshot.clocks,
      lastMove: snapshot.lastMove,
    })),
    moves: game.moves.map((move, index) => ({
      ply: index + 1,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ""}`,
      color: move.color,
    })),
    nodes,
    multiPv,
    force,
  });
}

export function onReviewProgress(
  handler: (progress: ReviewProgress) => void,
): Promise<UnlistenFn> {
  return listen<ReviewProgress>("chesscave://review-progress", (event) => {
    handler(event.payload);
  });
}

export async function startCoach(): Promise<void> {
  await invoke("coach_start");
}

export async function stopCoach(): Promise<void> {
  await invoke("coach_stop");
}

export async function newCoachThread(): Promise<void> {
  await invoke("coach_new_thread");
}

export async function sendCoachMessage(message: string, context: string): Promise<void> {
  await invoke("coach_send", { message, context });
}

export function onCoachEvent(
  handler: (message: Record<string, unknown>) => void,
): Promise<UnlistenFn> {
  return listen<Record<string, unknown>>("chesscave://coach-event", (event) => {
    handler(event.payload);
  });
}
