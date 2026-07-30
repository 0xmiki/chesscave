export type BoardArrowColor = "engine" | "yellow" | "green" | "red" | "blue";

export interface BoardArrow {
  from: string;
  to: string;
  color: BoardArrowColor;
}

export interface BoardHighlight {
  square: string;
  color: Exclude<BoardArrowColor, "engine">;
}

export interface ArrowGeometry {
  startX: number;
  startY: number;
  bendX: number | null;
  bendY: number | null;
  shaftEndX: number;
  shaftEndY: number;
  tipX: number;
  tipY: number;
  shaftPath: string;
  headPoints: string;
}

export function squareCoordinates(square: string, flipped: boolean) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return flipped
    ? { x: 7 - file, y: rank - 1 }
    : { x: file, y: 8 - rank };
}

export function squareFromBoardPoint(
  x: number,
  y: number,
  flipped: boolean,
): string | null {
  if (x < 0 || y < 0 || x >= 8 || y >= 8) return null;
  const column = Math.floor(x);
  const row = Math.floor(y);
  const file = flipped ? 7 - column : column;
  const rank = flipped ? row + 1 : 8 - row;
  return `${String.fromCharCode(97 + file)}${rank}`;
}

export function arrowColorFromModifiers(input: {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): Exclude<BoardArrowColor, "engine"> {
  if (input.altKey) return "blue";
  if (input.shiftKey) return "green";
  if (input.ctrlKey) return "red";
  return "yellow";
}

export function highlightColorFromModifiers(input: {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): Exclude<BoardArrowColor, "engine"> {
  if (input.altKey) return "blue";
  if (input.shiftKey) return "green";
  if (input.ctrlKey) return "yellow";
  return "red";
}

export function uciToArrow(
  uci: string | null | undefined,
  color: BoardArrowColor = "engine",
): BoardArrow | null {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (from === to) return null;
  return { from, to, color };
}

export function bestAlternativeArrow(
  playedUci: string | null | undefined,
  bestUci: string | null | undefined,
  acceptedBookMove = false,
): BoardArrow | null {
  if (acceptedBookMove || !bestUci || playedUci === bestUci) return null;
  return uciToArrow(bestUci, "engine");
}

export function arrowGeometry(
  arrow: BoardArrow,
  flipped: boolean,
): ArrowGeometry {
  const from = squareCoordinates(arrow.from, flipped);
  const to = squareCoordinates(arrow.to, flipped);
  const startX = from.x + 0.5;
  const startY = from.y + 0.5;
  const tipX = to.x + 0.5;
  const tipY = to.y + 0.5;
  const dx = tipX - startX;
  const dy = tipY - startY;
  const knightMove =
    (Math.abs(dx) === 1 && Math.abs(dy) === 2) ||
    (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  const bendX = knightMove
    ? Math.abs(dx) === 2
      ? tipX
      : startX
    : null;
  const bendY = knightMove
    ? Math.abs(dy) === 2
      ? tipY
      : startY
    : null;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = knightMove
    ? Math.abs(dx) === 2
      ? 0
      : Math.sign(dx)
    : dx / length;
  const unitY = knightMove
    ? Math.abs(dy) === 2
      ? 0
      : Math.sign(dy)
    : dy / length;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const headLength = 0.46;
  const headWidth = 0.32;
  const baseX = tipX - unitX * headLength;
  const baseY = tipY - unitY * headLength;
  const shaftEndX = tipX - unitX * 0.28;
  const shaftEndY = tipY - unitY * 0.28;
  const leftX = baseX + perpendicularX * headWidth;
  const leftY = baseY + perpendicularY * headWidth;
  const rightX = baseX - perpendicularX * headWidth;
  const rightY = baseY - perpendicularY * headWidth;
  let shaftPath = `M ${startX} ${startY} L ${shaftEndX} ${shaftEndY}`;

  if (bendX !== null && bendY !== null) {
    const firstDx = bendX - startX;
    const firstDy = bendY - startY;
    const firstLength = Math.hypot(firstDx, firstDy) || 1;
    const firstUnitX = firstDx / firstLength;
    const firstUnitY = firstDy / firstLength;
    const cornerRadius = 0.22;
    const cornerStartX = bendX - firstUnitX * cornerRadius;
    const cornerStartY = bendY - firstUnitY * cornerRadius;
    const cornerEndX = bendX + unitX * cornerRadius;
    const cornerEndY = bendY + unitY * cornerRadius;
    shaftPath =
      `M ${startX} ${startY} ` +
      `L ${cornerStartX} ${cornerStartY} ` +
      `Q ${bendX} ${bendY} ${cornerEndX} ${cornerEndY} ` +
      `L ${shaftEndX} ${shaftEndY}`;
  }

  return {
    startX,
    startY,
    bendX,
    bendY,
    shaftEndX,
    shaftEndY,
    tipX,
    tipY,
    shaftPath,
    headPoints: `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`,
  };
}
