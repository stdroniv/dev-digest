"use client";

import React from "react";
import { createPortal } from "react-dom";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsPopover } from "./FindingsPopover";

/**
 * Hover wrapper that reveals a {@link FindingsPopover} listing the findings
 * behind a set of counters. Reused by the PR-list FINDINGS cell and the
 * Agent-runs timeline rows.
 *
 * The popover is PORTALED to <body> with fixed coords from the trigger's
 * bounding rect, because both call sites live inside `overflow: hidden`
 * containers (the PR-list table card; the timeline rows) that would clip an
 * absolutely-positioned child. A short close-delay timer (cancelled by either
 * element's `onMouseEnter`) lets the pointer cross the trigger→popover gap.
 *
 * `onOpenChange` lets a caller fetch the finding details lazily — the PR-list
 * cell only enables its `usePrReviews` query while the card is open.
 */

const CLOSE_DELAY_MS = 120;

export function FindingsHoverCard({
  children,
  total,
  findings,
  loading,
  headerLabel,
  findingHref,
  fileHref,
  onOpenChange,
}: {
  children: React.ReactNode;
  total: number;
  findings: FindingRecord[];
  loading?: boolean;
  headerLabel?: string;
  /** Passed through to {@link FindingsPopover} — see its prop docs. */
  findingHref?: (f: FindingRecord) => string;
  fileHref?: (f: FindingRecord) => string | undefined;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenState(false), CLOSE_DELAY_MS);
  };
  React.useEffect(() => () => cancelClose(), []);

  // Dismiss on page/timeline scroll (and resize) while open. The card is
  // `position: fixed` with coords captured once on hover, so a scroll would
  // otherwise leave it pinned to the viewport — detached from the trigger that
  // scrolled away. Listen in the capture phase (scroll doesn't bubble, and the
  // timeline may live in a nested scroll container), but IGNORE scrolls that
  // originate inside the popover's own `overflow:auto` list so a long findings
  // list stays scrollable.
  React.useEffect(() => {
    if (!open) return;
    const dismiss = (e: Event) => {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      cancelClose();
      setOpen(false);
      onOpenChange?.(false);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openCard = () => {
    if (total <= 0) return; // nothing to show (never reviewed / clean run)
    cancelClose();
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left });
    setOpenState(true);
  };

  return (
    <div
      ref={anchorRef}
      style={{ display: "flex", alignItems: "center" }}
      onMouseEnter={openCard}
      onMouseLeave={scheduleClose}
    >
      {children}
      {open &&
        total > 0 &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 1000 }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onClick={(e) => e.stopPropagation()}
          >
            <FindingsPopover
              total={total}
              findings={findings}
              loading={loading}
              headerLabel={headerLabel}
              findingHref={findingHref}
              fileHref={fileHref}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
