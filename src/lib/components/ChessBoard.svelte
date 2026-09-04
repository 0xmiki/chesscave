<script lang="ts">
  import { tick, untrack } from "svelte";
  import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
  import {
    arrowColorFromModifiers,
    arrowGeometry,
    highlightColorFromModifiers,
    squareCoordinates,
    squareFromBoardPoint,
    type BoardArrow,
    type BoardArrowColor,
    type BoardHighlight,
  } from "$lib/chess/arrows";
  import type { MoveClassification } from "$lib/chess/types";
  import { nextBoardSquare, type BoardArrowKey } from "$lib/chess/board-keyboard";
  import ChessPiece from "./ChessPiece.svelte";
  import MoveBadge from "./MoveBadge.svelte";

  type VisualPiece = {
    id: string;
    square: string;
    type: PieceSymbol;
    color: Color;
  };

  type PieceDrag = {
    pointerId: number;
    from: string;
    type: PieceSymbol;
    color: Color;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
    active: boolean;
  };

  let {
    fen,
    flipped = false,
    lastMove = null,
    selected = null,
    legalTargets = [],
    annotation = null,
    engineArrow = null,
    compact = false,
    onSquareClick,
  }: {
    fen: string;
    flipped?: boolean;
    lastMove?: { from: string; to: string } | null;
    selected?: string | null;
    legalTargets?: string[];
    annotation?: MoveClassification | null;
    engineArrow?: BoardArrow | null;
    compact?: boolean;
    onSquareClick: (square: string) => void;
  } = $props();

  let visualPieces = $state.raw<VisualPiece[]>([]);
  let boardElement: HTMLDivElement;
  let nextPieceId = 0;
  let motionCycle = 0;
  let userArrows = $state<BoardArrow[]>([]);
  let userHighlights = $state<BoardHighlight[]>([]);
  let drawing = $state<{
    pointerId: number;
    from: string;
    color: Exclude<BoardArrowColor, "engine">;
    highlightColor: Exclude<BoardArrowColor, "engine">;
  } | null>(null);
  let previewArrow = $state<BoardArrow | null>(null);
  let keyboardSquare = $state<string | null>(null);
  let pieceDrag = $state<PieceDrag | null>(null);
  let suppressDragClick = false;

  const files = $derived(flipped ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"]);
  const ranks = $derived(flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]);
  const position = $derived(new Chess(fen));
  const pieceNames: Record<PieceSymbol, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  };
  const boardLabel = $derived(
    `Chess board. ${position.turn() === "w" ? "White" : "Black"} to move${position.inCheck() ? " and in check" : ""}. Use arrow keys to move between squares.`,
  );

  $effect(() => {
    const target = piecesFromFen(fen);
    const previous = untrack(() => visualPieces);
    const fromRects = capturePieceRects(previous);
    const next = reconcilePieces(previous, target, lastMove);
    visualPieces = next;
    const cycle = ++motionCycle;
    void animateMovedPieces(previous, next, fromRects, cycle);
  });

  $effect(() => {
    // Chess.com-style annotations belong to a position. Advancing the
    // timeline clears only the user's marks; the engine suggestion is derived
    // from the newly selected review position and remains independent.
    fen;
    userArrows = [];
    userHighlights = [];
    drawing = null;
    previewArrow = null;
  });

  function pieceElement(id: string): HTMLElement | null {
    return boardElement?.querySelector(`[data-piece-id="${id}"]`) ?? null;
  }

  function pieceArtElement(id: string): HTMLElement | null {
    return pieceElement(id)?.querySelector("[data-piece-art]") ?? null;
  }

  function capturePieceRects(
    pieces: VisualPiece[],
  ): Map<string, { left: number; top: number }> {
    const rects = new Map<string, { left: number; top: number }>();
    for (const piece of pieces) {
      const art = pieceArtElement(piece.id);
      if (!art) continue;
      const rect = art.getBoundingClientRect();
      rects.set(piece.id, { left: rect.left, top: rect.top });
      for (const animation of art.getAnimations()) animation.cancel();
    }
    return rects;
  }

  async function animateMovedPieces(
    previous: VisualPiece[],
    next: VisualPiece[],
    fromRects: Map<string, { left: number; top: number }>,
    cycle: number,
  ) {
    if (compact || !previous.length || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    await tick();
    if (cycle !== motionCycle) return;

    const previousById = new Map(previous.map((piece) => [piece.id, piece]));
    for (const piece of next) {
      const origin = previousById.get(piece.id);
      if (!origin || origin.square === piece.square) continue;
      const pieceElementAtDestination = pieceElement(piece.id);
      const art = pieceArtElement(piece.id);
      const from = fromRects.get(piece.id);
      if (!pieceElementAtDestination || !art || !from) continue;
      const to = pieceElementAtDestination.getBoundingClientRect();
      const offsetX = from.left - to.left;
      const offsetY = from.top - to.top;
      if (Math.abs(offsetX) < 0.01 && Math.abs(offsetY) < 0.01) continue;

      art.animate(
        [
          { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: 170,
          easing: "cubic-bezier(0.22, 0.74, 0.2, 1)",
          fill: "none",
        },
      );
    }
  }

  function piecesFromFen(value: string): Omit<VisualPiece, "id">[] {
    const board = new Chess(value);
    const pieces: Omit<VisualPiece, "id">[] = [];

    for (const row of board.board()) {
      for (const item of row) {
        if (!item) continue;
        pieces.push({
          square: item.square,
          type: item.type,
          color: item.color,
        });
      }
    }

    return pieces;
  }

  function distance(a: string, b: string): number {
    return (
      Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) +
      Math.abs(Number(a[1]) - Number(b[1]))
    );
  }

  function reconcilePieces(
    previous: VisualPiece[],
    target: Omit<VisualPiece, "id">[],
    move: { from: string; to: string } | null,
  ): VisualPiece[] {
    if (!previous.length) {
      return target.map((piece) => ({ ...piece, id: `piece-${nextPieceId++}` }));
    }

    const available = new Set(previous.map((piece) => piece.id));
    const result: VisualPiece[] = [];
    const pending: Omit<VisualPiece, "id">[] = [];

    // Pieces which did not move keep their identity first. This prevents two
    // same-type pieces from swapping IDs when a rook, knight, or pawn moves.
    for (const piece of target) {
      const exact = previous.find(
        (candidate) =>
          available.has(candidate.id) &&
          candidate.square === piece.square &&
          candidate.type === piece.type &&
          candidate.color === piece.color,
      );
      if (exact) {
        available.delete(exact.id);
        result.push({ ...piece, id: exact.id });
      } else {
        pending.push(piece);
      }
    }

    for (const piece of pending) {
      const candidates = previous.filter(
        (candidate) =>
          available.has(candidate.id) &&
          candidate.color === piece.color &&
          candidate.type === piece.type,
      );

      // Prefer the explicit origin for forward timeline movement; nearest
      // matching geometry handles backwards jumps and castling cleanly.
      candidates.sort((a, b) => {
        const aMove = move && a.square === move.from && piece.square === move.to ? -100 : 0;
        const bMove = move && b.square === move.from && piece.square === move.to ? -100 : 0;
        return aMove + distance(a.square, piece.square) - (bMove + distance(b.square, piece.square));
      });

      const match = candidates[0];
      if (match) {
        available.delete(match.id);
        result.push({ ...piece, id: match.id });
        continue;
      }

      // Promotions retain the pawn's DOM identity so the travel still
      // animates; the artwork changes at the destination.
      const promotedPawn = previous
        .filter(
          (candidate) =>
            available.has(candidate.id) &&
            candidate.color === piece.color &&
            candidate.type === "p",
        )
        .sort((a, b) => distance(a.square, piece.square) - distance(b.square, piece.square))[0];

      if (promotedPawn && (piece.square.endsWith("1") || piece.square.endsWith("8"))) {
        available.delete(promotedPawn.id);
        result.push({ ...piece, id: promotedPawn.id });
      } else {
        result.push({ ...piece, id: `piece-${nextPieceId++}` });
      }
    }

    return result;
  }

  function pieceCoordinates(square: string) {
    return squareCoordinates(square, flipped);
  }

  function isLight(fileIndex: number, rank: number) {
    const canonicalFile = files[fileIndex].charCodeAt(0) - 96;
    return (canonicalFile + rank) % 2 === 1;
  }

  function pointerSquare(event: PointerEvent): string | null {
    const bounds = boardElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return squareFromBoardPoint(
      ((event.clientX - bounds.left) / bounds.width) * 8,
      ((event.clientY - bounds.top) / bounds.height) * 8,
      flipped,
    );
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button === 0) {
      if (userArrows.length || userHighlights.length) {
        userArrows = [];
        userHighlights = [];
      }
      if (compact || !event.isPrimary) return;

      const from = pointerSquare(event);
      if (!from) return;
      const piece = position.get(from as Square);
      if (!piece) return;

      const bounds = boardElement.getBoundingClientRect();
      const squareSize = bounds.width / 8;
      const coordinates = pieceCoordinates(from);
      const pieceLeft = bounds.left + coordinates.x * squareSize;
      const pieceTop = bounds.top + coordinates.y * squareSize;
      pieceDrag = {
        pointerId: event.pointerId,
        from,
        type: piece.type,
        color: piece.color,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - pieceLeft,
        offsetY: event.clientY - pieceTop,
        x: coordinates.x * squareSize,
        y: coordinates.y * squareSize,
        active: false,
      };
      return;
    }

    if (event.button !== 2) return;

    const from = pointerSquare(event);
    if (!from) return;
    event.preventDefault();
    const color = arrowColorFromModifiers(event);
    drawing = {
      pointerId: event.pointerId,
      from,
      color,
      highlightColor: highlightColorFromModifiers(event),
    };
    previewArrow = null;
    boardElement.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (drawing && drawing.pointerId === event.pointerId) {
      event.preventDefault();
      const to = pointerSquare(event);
      previewArrow =
        to && to !== drawing.from
          ? { from: drawing.from, to, color: drawing.color }
          : null;
      return;
    }

    if (!pieceDrag || pieceDrag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pieceDrag.startX,
      event.clientY - pieceDrag.startY,
    );
    if (!pieceDrag.active && distance < 4) return;

    event.preventDefault();
    if (!pieceDrag.active) {
      if (selected !== pieceDrag.from) onSquareClick(pieceDrag.from);
      boardElement.setPointerCapture(event.pointerId);
    }
    const bounds = boardElement.getBoundingClientRect();
    pieceDrag = {
      ...pieceDrag,
      x: event.clientX - bounds.left - pieceDrag.offsetX,
      y: event.clientY - bounds.top - pieceDrag.offsetY,
      active: true,
    };
  }

  function handlePointerUp(event: PointerEvent) {
    if (pieceDrag && pieceDrag.pointerId === event.pointerId) {
      const completed = pieceDrag;
      pieceDrag = null;
      if (completed.active) {
        event.preventDefault();
        const to = pointerSquare(event);
        suppressDragClick = true;
        if (to && to !== completed.from) onSquareClick(to);
        window.setTimeout(() => {
          suppressDragClick = false;
        }, 0);
      }
      if (boardElement.hasPointerCapture(event.pointerId)) {
        boardElement.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (!drawing || drawing.pointerId !== event.pointerId) return;
    event.preventDefault();
    const completed = drawing;
    const to = pointerSquare(event);

    if (to && to !== completed.from) {
      const exact = userArrows.some(
        (arrow) =>
          arrow.from === completed.from &&
          arrow.to === to &&
          arrow.color === completed.color,
      );
      userArrows = exact
        ? userArrows.filter(
            (arrow) =>
              !(
                arrow.from === completed.from &&
                arrow.to === to &&
                arrow.color === completed.color
              ),
          )
        : [
            ...userArrows.filter(
              (arrow) =>
                !(arrow.from === completed.from && arrow.to === to),
            ),
            { from: completed.from, to, color: completed.color },
          ];
    } else if (to) {
      const exact = userHighlights.some(
        (highlight) =>
          highlight.square === to &&
          highlight.color === completed.highlightColor,
      );
      userHighlights = exact
        ? userHighlights.filter(
            (highlight) =>
              !(
                highlight.square === to &&
                highlight.color === completed.highlightColor
              ),
          )
        : [
            ...userHighlights.filter((highlight) => highlight.square !== to),
            { square: to, color: completed.highlightColor },
          ];
    }

    if (boardElement.hasPointerCapture(event.pointerId)) {
      boardElement.releasePointerCapture(event.pointerId);
    }
    drawing = null;
    previewArrow = null;
  }

  function cancelDrawing(event: PointerEvent) {
    if (pieceDrag?.pointerId === event.pointerId) {
      pieceDrag = null;
      suppressDragClick = false;
    }
    if (drawing?.pointerId === event.pointerId) {
      drawing = null;
      previewArrow = null;
    }
  }

  function focusSquare(square: string) {
    keyboardSquare = square;
    void tick().then(() => {
      boardElement
        ?.querySelector<HTMLButtonElement>(`[data-board-square="${square}"]`)
        ?.focus();
    });
  }

  function handleSquareKeydown(event: KeyboardEvent, square: string) {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
        event.key,
      )
    ) {
      return;
    }
    event.preventDefault();
    focusSquare(nextBoardSquare(files, ranks, square, event.key as BoardArrowKey));
  }

  function handleSquareClick(square: string) {
    if (!suppressDragClick) onSquareClick(square);
  }
</script>

<div
  class:compact
  class:piece-dragging={pieceDrag?.active}
  class="board"
  role={compact ? "img" : "grid"}
  aria-label={compact ? "Saved chess position" : boardLabel}
  aria-rowcount={compact ? undefined : 8}
  aria-colcount={compact ? undefined : 8}
  title={compact ? undefined : "Right-drag to draw · Shift green · Ctrl red · Alt blue · left-click to clear"}
  bind:this={boardElement}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={cancelDrawing}
  oncontextmenu={(event) => event.preventDefault()}
>
  <div class="squares">
    {#each ranks as rank, rankIndex}
      <div class="board-row" role={compact ? undefined : "row"}>
      {#each files as file, fileIndex}
        {@const square = `${file}${rank}`}
        {@const piece = position.get(square as Square)}
        {@const light = isLight(fileIndex, rank)}
        <button
          class:light
          class:dark={!light}
          class:last={lastMove?.from === square || lastMove?.to === square}
          class:selected={selected === square}
          class:target={legalTargets.includes(square)}
          class:occupied={Boolean(piece)}
          class="square"
          type="button"
          data-board-square={square}
          role={compact ? undefined : "gridcell"}
          tabindex={compact
            ? -1
            : keyboardSquare === square ||
                (!keyboardSquare && rankIndex === 0 && fileIndex === 0)
              ? 0
              : -1}
          aria-selected={compact ? undefined : selected === square}
          aria-label={`${square}, ${piece ? `${piece.color === "w" ? "white" : "black"} ${pieceNames[piece.type]}` : "empty"}${selected === square ? ", selected" : ""}${legalTargets.includes(square) ? ", legal destination" : ""}`}
          onfocus={() => (keyboardSquare = square)}
          onkeydown={(event) => handleSquareKeydown(event, square)}
          onclick={() => handleSquareClick(square)}
        >
          {#if fileIndex === 0}
            <span class="rank-coordinate">{rank}</span>
          {/if}
          {#if rankIndex === 7}
            <span class="file-coordinate">{file}</span>
          {/if}
          {#if legalTargets.includes(square)}
            <span class="move-target"></span>
          {/if}
        </button>
      {/each}
      </div>
    {/each}
  </div>

  <svg
    class="annotations"
    viewBox="0 0 8 8"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    {#each userHighlights as highlight (`${highlight.square}-${highlight.color}`)}
      {@const coordinates = pieceCoordinates(highlight.square)}
      <rect
        class={`highlight ${highlight.color}`}
        x={coordinates.x + 0.04}
        y={coordinates.y + 0.04}
        width="0.92"
        height="0.92"
        rx="0.05"
      />
    {/each}

    {#if engineArrow}
      {@const geometry = arrowGeometry(engineArrow, flipped)}
      <g class="drawn-arrow engine">
        <path d={geometry.shaftPath} />
        <polygon points={geometry.headPoints} />
      </g>
    {/if}

    {#each userArrows as arrow (`${arrow.from}-${arrow.to}-${arrow.color}`)}
      {@const geometry = arrowGeometry(arrow, flipped)}
      <g class={`drawn-arrow ${arrow.color}`}>
        <path d={geometry.shaftPath} />
        <polygon points={geometry.headPoints} />
      </g>
    {/each}

    {#if previewArrow}
      {@const geometry = arrowGeometry(previewArrow, flipped)}
      <g class={`drawn-arrow ${previewArrow.color} preview`}>
        <path d={geometry.shaftPath} />
        <polygon points={geometry.headPoints} />
      </g>
    {/if}
  </svg>

  <div class="pieces" aria-hidden="true">
    {#each visualPieces as piece (piece.id)}
      {@const coordinates = pieceCoordinates(piece.square)}
      <div
        class="piece"
        class:dragging={pieceDrag?.active && pieceDrag.from === piece.square}
        data-piece-id={piece.id}
        style={`--piece-x: ${coordinates.x}; --piece-y: ${coordinates.y};`}
      >
        <div class="piece-art" data-piece-art>
          <ChessPiece type={piece.type} color={piece.color} label={false} />
        </div>
      </div>
    {/each}
  </div>

  {#if pieceDrag?.active}
    <div
      class="dragged-piece"
      style={`--drag-x: ${pieceDrag.x}px; --drag-y: ${pieceDrag.y}px;`}
      aria-hidden="true"
    >
      <div class="dragged-piece-art">
        <ChessPiece type={pieceDrag.type} color={pieceDrag.color} label={false} />
      </div>
    </div>
  {/if}

  {#if annotation && lastMove}
    {@const annotationCoordinates = pieceCoordinates(lastMove.to)}
    <div
      class="move-annotation"
      style={`--piece-x: ${annotationCoordinates.x}; --piece-y: ${annotationCoordinates.y};`}
      aria-hidden="true"
    >
      <MoveBadge kind={annotation} />
    </div>
  {/if}
</div>

<style>
  .board {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 5px;
    box-shadow:
      0 0 0 1px rgba(58, 49, 42, 0.12),
      0 18px 42px rgba(73, 57, 44, 0.16);
  }

  .board.compact {
    border-radius: 3px;
    box-shadow: none;
    pointer-events: none;
  }

  .compact .rank-coordinate,
  .compact .file-coordinate {
    display: none;
  }

  .squares {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
  }

  .board-row {
    display: contents;
  }

  .pieces {
    position: absolute;
    z-index: 2;
    inset: 0;
    pointer-events: none;
  }

  .annotations {
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .drawn-arrow {
    color: rgba(234, 181, 51, 0.82);
    filter: drop-shadow(0 1px 0 rgba(31, 38, 23, 0.22));
  }

  .drawn-arrow path {
    fill: none;
    stroke: currentColor;
    stroke-width: 0.17;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .drawn-arrow polygon {
    fill: currentColor;
  }

  .drawn-arrow.engine {
    color: rgba(185, 79, 53, 0.82);
  }

  .drawn-arrow.engine path {
    stroke-width: 0.19;
  }

  .drawn-arrow.green,
  .highlight.green {
    color: rgba(126, 178, 74, 0.8);
  }

  .drawn-arrow.red,
  .highlight.red {
    color: rgba(207, 67, 59, 0.8);
  }

  .drawn-arrow.blue,
  .highlight.blue {
    color: rgba(65, 132, 197, 0.8);
  }

  .drawn-arrow.yellow,
  .highlight.yellow {
    color: rgba(234, 181, 51, 0.82);
  }

  .drawn-arrow.preview {
    opacity: 0.66;
  }

  .highlight {
    fill: currentColor;
  }

  .piece {
    position: absolute;
    top: 0;
    left: 0;
    width: 12.5%;
    height: 12.5%;
    transform: translate(
      calc(var(--piece-x) * 100%),
      calc(var(--piece-y) * 100%)
    );
  }

  .piece-art {
    width: 100%;
    height: 100%;
    will-change: transform;
  }

  .piece.dragging {
    opacity: 0;
  }

  .dragged-piece {
    position: absolute;
    z-index: 6;
    top: 0;
    left: 0;
    width: 12.5%;
    height: 12.5%;
    transform: translate3d(var(--drag-x), var(--drag-y), 0);
    pointer-events: none;
    will-change: transform;
  }

  .dragged-piece-art {
    width: 100%;
    height: 100%;
    transform: scale(1.08);
    filter: drop-shadow(0 8px 7px rgba(28, 24, 20, 0.28));
    animation: pick-up 80ms ease-out;
  }

  @keyframes pick-up {
    from {
      transform: scale(1);
      filter: drop-shadow(0 1px 1px rgba(28, 24, 20, 0.12));
    }
  }

  .move-annotation {
    position: absolute;
    z-index: 5;
    top: 0;
    left: 0;
    display: flex;
    justify-content: flex-end;
    width: 12.5%;
    height: 12.5%;
    padding: 3px;
    transform: translate(
      calc(var(--piece-x) * 100%),
      calc(var(--piece-y) * 100%)
    );
    pointer-events: none;
  }

  .square {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    border: 0;
    padding: 0;
    cursor: pointer;
    isolation: isolate;
    touch-action: none;
    user-select: none;
  }

  .square.occupied {
    cursor: grab;
  }

  .board.piece-dragging .square {
    cursor: grabbing;
  }

  .square.light {
    background: #eee7d7;
  }

  .square.dark {
    background: #899176;
  }

  .square.last::before,
  .square.selected::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: rgba(238, 181, 153, 0.62);
  }

  .square.selected::before {
    background: rgba(220, 120, 89, 0.68);
  }

  .move-target {
    position: absolute;
    z-index: 3;
    width: 26%;
    aspect-ratio: 1;
    border-radius: 999px;
    background: rgba(69, 55, 45, 0.25);
    pointer-events: none;
  }

  .occupied .move-target {
    width: 82%;
    border: max(4px, 0.42vw) solid rgba(69, 55, 45, 0.25);
    background: transparent;
  }

  .rank-coordinate,
  .file-coordinate {
    position: absolute;
    z-index: 4;
    font-size: clamp(8px, 1.05vw, 13px);
    line-height: 1;
    font-weight: 800;
    pointer-events: none;
  }

  .rank-coordinate {
    top: 5px;
    left: 5px;
  }

  .file-coordinate {
    right: 5px;
    bottom: 4px;
  }

  .light .rank-coordinate,
  .light .file-coordinate {
    color: #737b60;
  }

  .dark .rank-coordinate,
  .dark .file-coordinate {
    color: #f5efe2;
  }

  .square:focus-visible {
    outline: 0;
    box-shadow: inset 0 0 0 3px #b94f35;
  }

</style>
