<script lang="ts">
  import type { RatingPoint } from "$lib/chess/chesscom";

  let {
    points,
    label,
  }: {
    points: RatingPoint[];
    label: string;
  } = $props();

  const width = 240;
  const height = 70;
  const insetX = 5;
  const plotTop = 7;
  const plotBottom = 63;
  const plotted = $derived.by(() => {
    if (!points.length) return [];
    const ratings = points.map((point) => point.rating);
    const minimum = Math.min(...ratings);
    const maximum = Math.max(...ratings);
    const spread = maximum - minimum;
    const padding = Math.max(8, spread * 0.12);
    const low = minimum - padding;
    const high = maximum + padding;
    const range = high - low;

    return points.map((point, index) => ({
      x:
        points.length === 1
          ? width / 2
          : insetX + (index / (points.length - 1)) * (width - insetX * 2),
      y:
        plotBottom -
        Math.min(1, Math.max(0, (point.rating - low) / range)) *
          (plotBottom - plotTop),
    }));
  });
  const line = $derived(
    plotted
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" "),
  );
  const area = $derived(
    plotted.length
      ? `${line} L${plotted.at(-1)!.x.toFixed(2)} ${plotBottom} L${plotted[0].x.toFixed(2)} ${plotBottom} Z`
      : "",
  );
</script>

<div class="sparkline" role="img" aria-label={label}>
  {#if plotted.length}
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={insetX} y1={(plotTop + plotBottom) / 2} x2={width - insetX} y2={(plotTop + plotBottom) / 2}></line>
      <path class="area" d={area}></path>
      <path class="line" d={line}></path>
      <circle cx={plotted.at(-1)!.x} cy={plotted.at(-1)!.y} r="3"></circle>
    </svg>
  {:else}
    <span>No recent rating history</span>
  {/if}
</div>

<style>
  .sparkline {
    display: grid;
    width: 100%;
    height: 72px;
    align-items: center;
    overflow: hidden;
    color: var(--faint);
    font-size: 10px;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  line {
    stroke: var(--line);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .area {
    fill: rgba(119, 129, 106, 0.11);
  }

  .line {
    fill: none;
    stroke: var(--sage);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    vector-effect: non-scaling-stroke;
  }

  circle {
    fill: var(--coral);
    stroke: var(--pearl-raised);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
</style>
