"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { s } from "./styles";

/** One row in the Preview step's "FILES TO CREATE" tree (AC-2/3). */
export function FileTreeRow({
  file,
  active,
  onClick,
}: {
  file: CiFile;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={s.fileRow(active)}>
      <Icon.FileText
        size={13}
        style={{ color: active ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }}
      />
      <span className="mono" style={{ color: active ? "var(--accent-text)" : "var(--text-secondary)" }}>
        {file.path}
      </span>
    </button>
  );
}
