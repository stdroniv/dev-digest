/* useScrollSpy — keeps the "ON THIS PAGE" anchor rail in sync with the section
   the reader has actually scrolled to (SPEC-02 AC-14/15 follow-up). Clicking an
   anchor already sets the active item; this closes the loop for MANUAL scrolling
   (including scrolling back UP), which previously left the rail stuck on the last
   clicked anchor.

   The tour scrolls inside AppFrame's `<main overflow:auto>` element, not the
   window — so we listen for scroll in the CAPTURE phase on `window`, which
   receives scroll events from any descendant scroll container (scroll events do
   not bubble, but capture-phase ancestors still see them). Work is throttled to
   one computation per animation frame. */
"use client";

import React from "react";

/** Distance (px) from the top of the viewport marking the "reading line": a
   section becomes active once its top edge scrolls above this line. */
const READING_LINE = 160;

/** Walk up from an anchor element to the nearest scrollable ancestor (the tour
   scrolls inside AppFrame's `<main overflow:auto>`, not the window). Falls back
   to the document scroller so the hook still works if the layout ever changes. */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function useScrollSpy(ids: string[], onActive: (id: string) => void, enabled: boolean): void {
  const onActiveRef = React.useRef(onActive);
  onActiveRef.current = onActive;

  // Stable key so the effect only re-subscribes when the actual anchor set
  // changes, not on every parent re-render (ids is rebuilt each render).
  const idsKey = ids.join("|");

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const anchorIds = idsKey.split("|").filter(Boolean);
    if (anchorIds.length === 0) return;

    let frame = 0;
    let scroller: HTMLElement | null = null;

    const compute = () => {
      frame = 0;
      const lastId = anchorIds[anchorIds.length - 1]!;

      // The last section's top can never reach the reading line (the page can't
      // scroll far enough), so once the scroll container bottoms out, the last
      // anchor is the active one — otherwise the rail sticks on its predecessor.
      if (!scroller) scroller = getScrollParent(document.getElementById(anchorIds[0]!));
      if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2) {
        onActiveRef.current(lastId);
        return;
      }

      let current = anchorIds[0]!;
      for (const id of anchorIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= READING_LINE) current = id;
      }
      onActiveRef.current(current);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [idsKey, enabled]);
}
