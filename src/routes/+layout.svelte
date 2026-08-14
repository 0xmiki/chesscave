<script lang="ts">
  import { onMount } from "svelte";
  import { hasNativeHost, startCoach } from "$lib/services/native";
  import "../app.css";

  let { children } = $props();

  onMount(() => {
    if (hasNativeHost()) {
      void startCoach().catch(() => {
        // Feature routes surface connection errors and provide recovery controls.
      });
    }

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;

      const direction = Math.sign(event.deltaY);
      const scroller = event.composedPath().find((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const overflow = getComputedStyle(node).overflowY;
        if (!/^(auto|scroll|overlay)$/.test(overflow)) return false;
        const maximum = node.scrollHeight - node.clientHeight;
        if (maximum <= 0) return false;
        return direction > 0
          ? node.scrollTop < maximum - 1
          : node.scrollTop > 1;
      });

      if (!(scroller instanceof HTMLElement)) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientHeight
            : 1;
      event.preventDefault();
      scroller.scrollTop += event.deltaY * unit;
    };

    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", onWheel, { capture: true });
  });
</script>

{@render children()}
