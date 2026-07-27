<script lang="ts">
  import type { Side } from "$lib/chess/types";
  import { formatClock } from "$lib/chess/time";

  let {
    side,
    name,
    rating = null,
    clock = null,
    active = false,
  }: {
    side: Side;
    name: string;
    rating?: string | null;
    clock?: number | null;
    active?: boolean;
  } = $props();
</script>

<div class:active class={`player-strip ${side === "w" ? "white" : "black"}`}>
  <div class="avatar" aria-hidden="true">
    <svg viewBox="0 0 40 40">
      <circle cx="20" cy="14" r="7" />
      <path d="M7.5 36c.7-8.3 5.2-12.5 12.5-12.5S31.8 27.7 32.5 36z" />
    </svg>
  </div>
  <div class="identity">
    <div>
      <strong>{name}</strong>
      {#if rating}<span>({rating})</span>{/if}
    </div>
    <small>{side === "w" ? "White" : "Black"}</small>
  </div>
  <div class="clock" title={clock === null ? "No clock data in this PGN" : "Time remaining at this position"}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.3v5.1l3.4 2" />
    </svg>
    <time>{formatClock(clock)}</time>
  </div>
</div>

<style>
  .player-strip {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    color: #b9beb5;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    overflow: hidden;
    border: 1px solid #4a4e48;
    border-radius: 4px;
    color: #a6aaa3;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.08), transparent),
      #d4d4d0;
  }

  .avatar svg {
    width: 88%;
    height: 88%;
    fill: currentColor;
  }

  .black .avatar {
    color: #777b74;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.08), transparent),
      #bbbcb7;
  }

  .identity {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .identity > div {
    display: flex;
    gap: 5px;
    align-items: baseline;
    min-width: 0;
  }

  .identity strong {
    overflow: hidden;
    color: #e4e6e1;
    font-size: 11px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity span {
    color: #858b82;
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  .identity small {
    color: #70766d;
    font-size: 8px;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .clock {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
    min-width: 92px;
    height: 34px;
    padding: 0 10px;
    border-radius: 4px;
    color: #e6e7e3;
    background: #30322f;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
    font-variant-numeric: tabular-nums;
  }

  .white .clock {
    color: #30322e;
    background: #babbb8;
  }

  .clock svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .clock time {
    min-width: 54px;
    font-size: 17px;
    font-weight: 800;
    line-height: 1;
    text-align: right;
  }

  .player-strip.active .clock {
    box-shadow:
      0 0 0 2px rgba(146, 188, 116, 0.45),
      0 1px 0 rgba(255, 255, 255, 0.05) inset;
  }

  .player-strip.active .identity small {
    color: #91b27b;
  }
</style>
