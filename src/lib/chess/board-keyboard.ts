export type BoardArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function nextBoardSquare(
  files: readonly string[],
  ranks: readonly number[],
  square: string,
  key: BoardArrowKey,
): string {
  let column = Math.max(0, files.indexOf(square[0]));
  let row = Math.max(0, ranks.indexOf(Number(square[1])));

  if (key === "ArrowLeft") column = Math.max(0, column - 1);
  if (key === "ArrowRight") column = Math.min(7, column + 1);
  if (key === "ArrowUp") row = Math.max(0, row - 1);
  if (key === "ArrowDown") row = Math.min(7, row + 1);
  if (key === "Home") column = 0;
  if (key === "End") column = 7;

  return `${files[column]}${ranks[row]}`;
}
