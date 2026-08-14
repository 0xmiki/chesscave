import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PatchCard } from "$lib/patches/types";

const PATCHES_PREVIEW_STORAGE_KEY = "chesscave.patches.preview.v1";

function previewCards(): PatchCard[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(
      localStorage.getItem(PATCHES_PREVIEW_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value) ? (value as PatchCard[]) : [];
  } catch {
    return [];
  }
}

function writePreviewCards(cards: PatchCard[]) {
  localStorage.setItem(PATCHES_PREVIEW_STORAGE_KEY, JSON.stringify(cards));
}

export async function listPatchCards(): Promise<PatchCard[]> {
  if (isTauri()) return invoke<PatchCard[]>("patches_list");
  return previewCards().sort(
    (left, right) => left.schedule.dueAt - right.schedule.dueAt,
  );
}

export async function savePatchCard(card: PatchCard): Promise<PatchCard> {
  if (isTauri()) return invoke<PatchCard>("patches_save", { card });
  const cards = previewCards();
  const index = cards.findIndex((existing) => existing.id === card.id);
  if (index >= 0) cards[index] = card;
  else cards.push(card);
  writePreviewCards(cards);
  return card;
}

export async function deletePatchCard(id: string): Promise<void> {
  if (isTauri()) return invoke<void>("patches_delete", { id });
  writePreviewCards(previewCards().filter((card) => card.id !== id));
}
