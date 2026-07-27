<script lang="ts">
  let {
    type,
    color,
    label = true,
  }: {
    type: string;
    color: "w" | "b";
    label?: boolean;
  } = $props();

  const names: Record<string, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  };
</script>

<img
  src={`/pieces/neo/${color}${type}.png`}
  alt={label ? `${color === "w" ? "White" : "Black"} ${names[type] ?? "piece"}` : ""}
  draggable="false"
/>

<style>
  img {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
    object-fit: contain;
    pointer-events: none;
    -webkit-user-drag: none;
  }
</style>
