<script lang="ts">
  import bestIcon from "$lib/assets/review-badges/best.png";
  import blunderIcon from "$lib/assets/review-badges/blunder.png";
  import bookIcon from "$lib/assets/review-badges/book.png";
  import brilliantIcon from "$lib/assets/review-badges/brilliant.png";
  import excellentIcon from "$lib/assets/review-badges/excellent.png";
  import goodIcon from "$lib/assets/review-badges/good.png";
  import greatIcon from "$lib/assets/review-badges/great.png";
  import inaccuracyIcon from "$lib/assets/review-badges/inaccuracy.png";
  import missIcon from "$lib/assets/review-badges/miss.png";
  import mistakeIcon from "$lib/assets/review-badges/mistake.png";
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
  const icons: Record<MoveClassification, string> = {
    brilliant: brilliantIcon,
    great: greatIcon,
    best: bestIcon,
    excellent: excellentIcon,
    good: goodIcon,
    book: bookIcon,
    inaccuracy: inaccuracyIcon,
    mistake: mistakeIcon,
    miss: missIcon,
    blunder: blunderIcon,
  };
</script>

<span
  class:compact
  class={`badge ${kind}`}
  data-kind={kind}
  role="img"
  aria-label={labels[kind]}
  title={labels[kind]}
>
  <img src={icons[kind]} alt="" aria-hidden="true" />
</span>

<style>
  .badge {
    --badge-size: 26px;
    position: relative;
    display: inline-block;
    flex: 0 0 var(--badge-size);
    width: var(--badge-size);
    height: var(--badge-size);
    line-height: 1;
  }

  .badge.compact {
    --badge-size: 20px;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
