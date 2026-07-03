/* AnchorNav — "ON THIS PAGE" left rail listing the five sections in order plus
   a sixth "Generation cost" anchor (SPEC-02 AC-14/15/19). Clicking an anchor
   reveals (expands the target card if collapsed) and scrolls to it; the
   currently-navigated-to item is highlighted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

export interface AnchorItem {
  id: string;
  label: string;
}

export function AnchorNav({
  items,
  activeId,
  onNavigate,
}: {
  items: AnchorItem[];
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  const t = useTranslations("tour");
  return (
    <nav style={s.nav} aria-label={t("anchorNav.heading")}>
      <div style={s.heading}>{t("anchorNav.heading")}</div>
      <ul style={s.list}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              style={{ ...s.item, ...(item.id === activeId ? s.itemActive : {}) }}
              aria-current={item.id === activeId ? "true" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
