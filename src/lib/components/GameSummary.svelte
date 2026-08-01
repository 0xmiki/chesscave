<script lang="ts">
  import ChessPiece from "$lib/components/ChessPiece.svelte";
  import MoveBadge from "$lib/components/MoveBadge.svelte";
  import {
    CLASSIFICATION_ORDER,
    REVIEW_PHASES,
    type ReviewPresentation,
  } from "$lib/chess/review";
  import type { MoveClassification } from "$lib/chess/types";

  let {
    presentation,
    whiteName,
    blackName,
    whiteRating = null,
    blackRating = null,
    currentPly,
    busy = false,
    progress = "",
    error = "",
    onSelect,
  }: {
    presentation: ReviewPresentation | null;
    whiteName: string;
    blackName: string;
    whiteRating?: string | null;
    blackRating?: string | null;
    currentPly: number;
    busy?: boolean;
    progress?: string;
    error?: string;
    onSelect: (ply: number) => void;
  } = $props();

  const graphWidth = 252;
  const graphHeight = 82;
  const classificationLabels: Record<MoveClassification, string> = {
    brilliant: "Brilliant",
    great: "Great",
    book: "Book",
    best: "Best",
    excellent: "Excellent",
    good: "Good",
    inaccuracy: "Inaccuracy",
    mistake: "Mistake",
    miss: "Miss",
    blunder: "Blunder",
  };
  const phaseLabels = {
    opening: "Opening",
    middlegame: "Middlegame",
    endgame: "Endgame",
  } as const;

  function graphCoordinates(ply: number, winPercent: number) {
    const length = Math.max(1, (presentation?.graph.length ?? 1) - 1);
    return {
      x: (ply / length) * graphWidth,
      y: graphHeight - (winPercent / 100) * graphHeight,
    };
  }

  const graphPath = $derived.by(() => {
    if (!presentation?.graph.length) return "";
    return presentation.graph
      .map((point, index) => {
        const { x, y } = graphCoordinates(point.ply, point.whiteWinPercent);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  });
  const graphArea = $derived(
    graphPath ? `${graphPath} L${graphWidth} ${graphHeight / 2} L0 ${graphHeight / 2} Z` : "",
  );
  const currentGraphPoint = $derived.by(() => {
    const graph = presentation?.graph;
    if (!graph?.length) return null;
    const point = graph[Math.max(0, Math.min(currentPly, graph.length - 1))];
    return graphCoordinates(point.ply, point.whiteWinPercent);
  });

  function navigateFromGraph(event: MouseEvent) {
    if (!presentation?.graph.length) return;
    const bounds = event.currentTarget as HTMLButtonElement;
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.getBoundingClientRect().left) / bounds.clientWidth),
    );
    onSelect(Math.round(ratio * (presentation.graph.length - 1)));
  }

  function formattedAccuracy(value: number | null): string {
    return value === null ? "—" : value.toFixed(1);
  }
</script>

<aside class="summary" aria-label="Game summary">
  <header>
    <div>
      <span>Review</span>
      <strong>Game at a glance</strong>
    </div>
    {#if busy}
      <span class="review-state"><i></i>{progress || "Reviewing"}</span>
    {:else if presentation}
      <span class="review-state ready"><i></i>Complete</span>
    {/if}
  </header>

  {#if presentation}
    <button
      class="graph"
      type="button"
      onclick={navigateFromGraph}
      aria-label="Navigate to a position using the game advantage graph"
      title="Click to navigate the game"
    >
      <svg viewBox={`0 0 ${graphWidth} ${graphHeight}`} preserveAspectRatio="none" aria-hidden="true">
        <line class="midline" x1="0" y1={graphHeight / 2} x2={graphWidth} y2={graphHeight / 2}></line>
        <path class="graph-area" d={graphArea}></path>
        <path class="graph-line" d={graphPath}></path>
        {#if currentGraphPoint}
          <line
            class="current-line"
            x1={currentGraphPoint.x}
            y1="0"
            x2={currentGraphPoint.x}
            y2={graphHeight}
          ></line>
          <circle class="current-point" cx={currentGraphPoint.x} cy={currentGraphPoint.y} r="3.2"></circle>
        {/if}
      </svg>
      <span class="graph-label white">White</span>
      <span class="graph-label black">Black</span>
    </button>

    <div class="players">
      <span class="players-label">Players</span>
      <div class="player white">
        <div class="piece"><ChessPiece type="n" color="w" label={false} /></div>
        <div>
          <strong title={whiteName}>{whiteName}</strong>
          <span>{whiteRating ? `White · ${whiteRating}` : "White"}</span>
        </div>
      </div>
      <div class="player black">
        <div class="piece"><ChessPiece type="n" color="b" label={false} /></div>
        <div>
          <strong title={blackName}>{blackName}</strong>
          <span>{blackRating ? `Black · ${blackRating}` : "Black"}</span>
        </div>
      </div>
    </div>

    <section class="accuracy" aria-label="Player accuracy">
      <span>Accuracy</span>
      <strong>{formattedAccuracy(presentation.sides.w.accuracy)}</strong>
      <strong>{formattedAccuracy(presentation.sides.b.accuracy)}</strong>
    </section>

    <section class="classifications" aria-label="Move classifications">
      {#each CLASSIFICATION_ORDER as classification}
        {@const whiteCount = presentation.sides.w.classifications[classification]}
        {@const blackCount = presentation.sides.b.classifications[classification]}
        <div class="classification-row">
          <span class="classification-label">
            <MoveBadge kind={classification} compact />
            {classificationLabels[classification]}
          </span>
          <strong class:zero={whiteCount === 0}>{whiteCount}</strong>
          <strong class:zero={blackCount === 0}>{blackCount}</strong>
        </div>
      {/each}
    </section>

    <section class="phases" aria-label="Accuracy by game phase">
      <div class="section-heading">
        <span>By phase</span>
        <small>Accuracy</small>
      </div>
      {#each REVIEW_PHASES as phase}
        <div class="phase-row">
          <span>{phaseLabels[phase]}</span>
          <strong>{formattedAccuracy(presentation.sides.w.phaseAccuracy[phase])}</strong>
          <strong>{formattedAccuracy(presentation.sides.b.phaseAccuracy[phase])}</strong>
        </div>
      {/each}
    </section>
  {:else}
    <div class="empty" class:error={Boolean(error)}>
      {#if busy}
        <i></i>
        <strong>Reviewing the game</strong>
        <span>{progress || "Stockfish is evaluating every position."}</span>
      {:else if error}
        <strong>Review unavailable</strong>
        <span>{error}</span>
      {:else}
        <strong>No review yet</strong>
        <span>Complete a Stockfish review to see the game summary.</span>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .summary {
    display: block;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: auto;
    color: var(--ink);
    border-right: 1px solid var(--line);
    background: var(--pearl);
    scrollbar-color: var(--line-strong) transparent;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 60px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }

  header > div {
    display: grid;
    gap: 2px;
  }

  header span:first-child,
  .section-heading span {
    color: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  header strong {
    font-family: var(--display);
    font-size: 16px;
    font-variation-settings: "opsz" 18, "wght" 590;
  }

  .review-state {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--muted);
    font-size: 9px;
    letter-spacing: 0;
    text-transform: none;
  }

  .review-state i,
  .empty i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--coral);
    animation: pulse 800ms ease-in-out infinite alternate;
  }

  .review-state.ready i {
    background: var(--sage);
    animation: none;
  }

  .graph {
    position: relative;
    display: block;
    width: calc(100% - 32px);
    height: 88px;
    margin: 16px 16px 13px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    cursor: crosshair;
  }

  .graph svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .midline {
    stroke: var(--line-strong);
    stroke-width: 0.8;
    stroke-dasharray: 3 3;
  }

  .graph-area {
    fill: rgba(119, 129, 106, 0.14);
  }

  .graph-line {
    fill: none;
    stroke: var(--sage);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    vector-effect: non-scaling-stroke;
  }

  .current-line {
    stroke: var(--coral);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .current-point {
    fill: var(--coral);
    stroke: var(--pearl-raised);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .graph-label {
    position: absolute;
    left: 7px;
    color: var(--faint);
    font-size: 8px;
    pointer-events: none;
  }

  .graph-label.white { top: 5px; }
  .graph-label.black { bottom: 5px; }

  .players {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 60px 60px;
    gap: 0;
    align-items: center;
    padding: 0 16px 13px;
  }

  .players-label {
    color: var(--ink-soft);
    font-size: 10px;
    font-weight: 650;
  }

  .player {
    display: grid;
    justify-items: center;
    gap: 3px;
    min-width: 0;
    text-align: center;
  }

  .piece {
    width: 30px;
    height: 30px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
  }

  .player > div:last-child {
    display: grid;
    justify-items: center;
    width: 100%;
    min-width: 0;
    gap: 1px;
  }

  .player strong {
    max-width: 100%;
    overflow: hidden;
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player span {
    max-width: 100%;
    overflow: hidden;
    color: var(--muted);
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .accuracy,
  .classification-row,
  .phase-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 60px 60px;
    align-items: center;
  }

  .accuracy {
    min-height: 48px;
    margin: 0 16px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .accuracy span {
    color: var(--ink-soft);
    font-size: 10px;
    font-weight: 650;
  }

  .accuracy strong {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .classifications {
    padding: 9px 16px 11px;
  }

  .classification-row {
    min-height: 29px;
  }

  .classification-label {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink-soft);
    font-size: 10px;
    font-weight: 600;
  }

  .classification-row > strong,
  .phase-row > strong {
    color: var(--ink);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .classification-row > strong.zero {
    color: var(--faint);
    font-weight: 500;
  }

  .phases {
    margin: 0 16px 18px;
    padding-top: 13px;
    border-top: 1px solid var(--line);
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
  }

  .section-heading small {
    color: var(--faint);
    font-size: 8px;
  }

  .phase-row {
    min-height: 27px;
  }

  .phase-row > span {
    color: var(--ink-soft);
    font-size: 10px;
    font-weight: 600;
  }

  .empty {
    display: grid;
    align-content: center;
    justify-items: center;
    min-height: 260px;
    padding: 28px 22px;
    color: var(--muted);
    text-align: center;
  }

  .empty strong {
    margin-top: 10px;
    color: var(--ink-soft);
    font-family: var(--display);
    font-size: 18px;
    font-weight: 580;
  }

  .empty span {
    max-width: 24ch;
    margin-top: 6px;
    font-size: 11px;
    line-height: 1.5;
  }

  .empty.error strong,
  .empty.error span {
    color: var(--danger);
  }

  @keyframes pulse {
    to { opacity: 0.35; }
  }

  @media (max-width: 1100px) {
    .summary {
      height: auto;
      overflow: visible;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }
</style>
