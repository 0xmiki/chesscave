<script lang="ts">
  import type {
    GameMove,
    MoveClassification,
    MoveReview,
    VariationLine,
  } from "$lib/chess/types";
  import MoveBadge from "./MoveBadge.svelte";

  let {
    moves,
    reviews = [],
    variation = null,
    variationPly = null,
    bookThroughPly = 0,
    variationBookThrough = 0,
    currentPly,
    onSelect,
    onSelectVariation = () => {},
  }: {
    moves: GameMove[];
    reviews?: MoveReview[];
    variation?: VariationLine | null;
    variationPly?: number | null;
    bookThroughPly?: number;
    variationBookThrough?: number;
    currentPly: number;
    onSelect: (ply: number) => void;
    onSelectVariation?: (ply: number) => void;
  } = $props();

  const reviewByPly = $derived(
    new Map(reviews.map((review) => [review.ply, review])),
  );

  const rows = $derived(
    Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => ({
      number: index + 1,
      white: moves[index * 2],
      black: moves[index * 2 + 1],
      whitePly: index * 2 + 1,
      blackPly: index * 2 + 2,
    })),
  );

  function variationMoveLabel(index: number) {
    if (!variation) return "";
    const absolutePly = variation.rootPly + index + 1;
    const moveNumber = Math.ceil(absolutePly / 2);
    return `${moveNumber}${absolutePly % 2 === 0 ? "…" : "."}`;
  }

  function classificationAt(ply: number): MoveClassification | null {
    if (ply <= bookThroughPly) return "book";
    return reviewByPly.get(ply)?.classification ?? null;
  }

  function moveTitle(ply: number): string | undefined {
    if (ply <= bookThroughPly) return "Book move · Lichess opening database";
    const move = reviewByPly.get(ply);
    if (!move) return undefined;
    return `${move.classification} · ${move.expectedPointsLost.toFixed(3)} expected points lost`;
  }
</script>

<div class="move-list" aria-label="Game moves">
  {#each rows as row}
    <div class="move-row">
      <span class="number">{row.number}.</span>
      <button
        class:active={variationPly === null && currentPly === row.whitePly}
        type="button"
        aria-current={variationPly === null && currentPly === row.whitePly ? "step" : undefined}
        title={moveTitle(row.whitePly)}
        onclick={() => onSelect(row.whitePly)}
      >
        <span>{row.white.san}</span>
        {#if classificationAt(row.whitePly)}
          <MoveBadge kind={classificationAt(row.whitePly)!} compact />
        {/if}
      </button>
      {#if row.black}
        <button
          class:active={variationPly === null && currentPly === row.blackPly}
          type="button"
          aria-current={variationPly === null && currentPly === row.blackPly ? "step" : undefined}
          title={moveTitle(row.blackPly)}
          onclick={() => onSelect(row.blackPly)}
        >
          <span>{row.black.san}</span>
          {#if classificationAt(row.blackPly)}
            <MoveBadge kind={classificationAt(row.blackPly)!} compact />
          {/if}
        </button>
      {/if}
    </div>
  {/each}

  {#if variation}
    <div class="variation-line" aria-label="Exploratory variation">
      <span class="variation-label">VAR</span>
      <div class="variation-moves">
        {#each variation.moves as move, index}
          <button
            class:active={variationPly === index + 1}
            type="button"
            aria-current={variationPly === index + 1 ? "step" : undefined}
            title="Exploratory move — click any game move above to return to the match"
            onclick={() => onSelectVariation(index + 1)}
          >
            <small>{variationMoveLabel(index)}</small>
            <span>{move.san}</span>
            {#if index + 1 <= variationBookThrough}
              <MoveBadge kind="book" compact />
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .move-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(144px, 1fr));
    max-height: 126px;
    overflow: auto;
    padding: 4px 6px 10px;
    scrollbar-color: #5d625b transparent;
  }

  .move-row {
    display: grid;
    grid-template-columns: 28px 1fr 1fr;
    align-items: center;
    min-height: 32px;
    border-radius: 5px;
  }

  .variation-line {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 36px 1fr;
    gap: 6px;
    align-items: start;
    margin: 4px 3px 0;
    padding: 7px;
    border: 1px solid #56684d;
    border-radius: 7px;
    background: #293127;
  }

  .variation-label {
    padding-top: 6px;
    color: #9abd87;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.1em;
  }

  .variation-moves {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .variation-moves button {
    justify-content: flex-start;
    min-height: 25px;
    padding: 2px 7px;
  }

  .variation-moves small {
    color: #788274;
    font-size: 8px;
    font-weight: 750;
  }

  .variation-moves button.active small {
    color: #dcebd4;
  }

  .number {
    padding-left: 7px;
    color: #7d817a;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  button {
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;
    min-height: 27px;
    border: 0;
    border-radius: 5px;
    color: #d9dcd5;
    background: transparent;
    text-align: left;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
  }

  button:hover {
    background: #363a35;
  }

  button.active {
    color: #f5f7ef;
    background: #547c39;
  }

  .move-list {
    display: flex;
    grid-template-columns: none;
    gap: 3px;
    max-height: none;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 6px 0 8px;
    scrollbar-color: var(--line-strong) transparent;
    scrollbar-width: thin;
  }

  .move-row {
    flex: 0 0 auto;
    grid-template-columns: 24px 58px 58px;
    min-height: 34px;
    border-radius: 0;
  }

  .number {
    padding: 0;
    color: var(--faint);
    font-size: 10px;
    text-align: center;
  }

  button {
    min-height: 30px;
    padding: 0 6px;
    border-radius: 6px;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 650;
  }

  button:hover {
    color: var(--coral-dark);
    background: var(--coral-soft);
  }

  button.active {
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .variation-line {
    flex: 0 0 auto;
    grid-template-columns: auto auto;
    margin: 0 0 0 8px;
    padding: 3px 6px;
    border-color: var(--line-strong);
    border-radius: 8px;
    background: var(--sage-soft);
  }

  .variation-label {
    color: var(--sage);
    font-size: 8px;
  }

  .variation-moves {
    flex-wrap: nowrap;
  }

  .variation-moves small {
    color: var(--muted);
  }

  .variation-moves button.active small {
    color: var(--pearl);
  }

</style>
