<script lang="ts">
  import type { MoveClassification } from "$lib/chess/types";

  let {
    kind,
    compact = false,
  }: {
    kind: MoveClassification;
    compact?: boolean;
  } = $props();

  const labels: Record<MoveClassification, string> = {
    brilliant: "Brilliant move",
    great: "Great move",
    best: "Best move",
    excellent: "Excellent move",
    good: "Good move",
    book: "Book move",
    inaccuracy: "Inaccuracy",
    mistake: "Mistake",
    miss: "Miss",
    blunder: "Blunder",
  };
</script>

<span
  class:compact
  class={`badge ${kind}`}
  role="img"
  aria-label={labels[kind]}
  title={labels[kind]}
>
  {#if kind === "book"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5.1c3.2-.7 5.8-.1 8 1.7v12c-2.3-1.8-4.9-2.4-8-1.7z" />
      <path d="M20.5 5.1c-3.2-.7-5.8-.1-8 1.7v12c2.3-1.8 4.9-2.4 8-1.7z" />
      <path class="crease" d="M12 7v12" />
    </svg>
  {:else if kind === "best"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2.7 2.7 5.7 6.2.8-4.5 4.3 1.1 6.2-5.5-3-5.5 3 1.1-6.2-4.5-4.3 6.2-.8z" />
    </svg>
  {:else if kind === "excellent" || kind === "good"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="check" d="m5.2 12.5 4.1 4.1 9.5-9.4" />
    </svg>
  {:else if kind === "miss"}
    <span class="mark">×</span>
  {:else if kind === "brilliant"}
    <span class="mark double">!!</span>
  {:else if kind === "great"}
    <span class="mark">!</span>
  {:else if kind === "inaccuracy"}
    <span class="mark pair">?!</span>
  {:else if kind === "mistake"}
    <span class="mark">?</span>
  {:else}
    <span class="mark double">??</span>
  {/if}
</span>

<style>
  .badge {
    --badge-size: 26px;
    position: relative;
    display: inline-grid;
    flex: 0 0 var(--badge-size);
    place-items: center;
    width: var(--badge-size);
    height: var(--badge-size);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    color: white;
    background: #8ea487;
    box-shadow:
      0 2px 0 rgba(0, 0, 0, 0.34),
      0 1px 2px rgba(0, 0, 0, 0.18);
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1;
  }

  .badge.compact {
    --badge-size: 18px;
    border-width: 0.5px;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.32);
  }

  .badge.brilliant,
  .badge.great {
    background: #22aaa7;
  }

  .badge.best {
    background: #95bd46;
  }

  .badge.excellent {
    background: #9cb493;
  }

  .badge.good {
    background: #9db593;
  }

  .badge.book {
    background: #aa8b69;
  }

  .badge.inaccuracy {
    background: #f3bd43;
  }

  .badge.mistake {
    background: #ed9220;
  }

  .badge.miss,
  .badge.blunder {
    background: #d43131;
  }

  svg {
    width: 72%;
    height: 72%;
    overflow: visible;
    fill: currentColor;
  }

  .crease,
  .check {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .crease {
    stroke-width: 1.5;
  }

  .check {
    stroke-width: 4.2;
  }

  .mark {
    transform: translateY(-0.5px);
    color: white;
    font-size: calc(var(--badge-size) * 0.72);
    font-weight: 950;
    letter-spacing: -0.07em;
  }

  .mark.double,
  .mark.pair {
    font-size: calc(var(--badge-size) * 0.55);
    letter-spacing: -0.14em;
  }
</style>
