"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import { usePriorPrs } from "@/lib/hooks/history";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface PriorPrsProps {
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
}

/**
 * PriorPrs — collapsed-by-default accordion on the PR Overview tab.
 *
 * On first expand, lazily fetches prior merged PRs that touched any of
 * the current PR's files. Degrades gracefully (shows empty state) when
 * there are no results or the server clone is unavailable.
 *
 * No fetch fires on mount — `usePriorPrs` is gated by `enabled: open`.
 */
export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("history");
  const [open, setOpen] = React.useState(false);
  const { data, isLoading } = usePriorPrs(prId, { enabled: open });

  return (
    <section>
      <SectionLabel icon="History">{t("title")}</SectionLabel>

      <div style={s.card}>
        {/* Accordion header — toggle button */}
        <button
          style={s.accordionHeader}
          aria-expanded={open}
          aria-label={t("toggle.aria")}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon.ChevronDown
            size={14}
            style={{
              ...s.chevronIcon,
              transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          />
          <span>{t("title")}</span>
          {data != null && (
            <span style={s.countBadge}>
              {t("count", { count: data.history.length })}
            </span>
          )}
        </button>

        {/* Collapsible content — only rendered when open */}
        {open && (
          <div style={s.content}>
            {isLoading ? (
              <p style={s.message}>{t("loading")}</p>
            ) : !data || data.history.length === 0 ? (
              <p style={s.message}>{t("empty")}</p>
            ) : (
              <ul style={s.list}>
                {data.history.map((item) => (
                  <li key={item.pr_number} style={s.row}>
                    <div style={s.rowHeader}>
                      {repoFullName ? (
                        <a
                          href={githubPrUrl(repoFullName, item.pr_number)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("openOnGithub", {
                            number: item.pr_number,
                          })}
                          style={s.prLink}
                        >
                          <span style={s.prNumber}>{`#${item.pr_number}`}</span>
                          <span style={s.prTitle}>{item.title}</span>
                        </a>
                      ) : (
                        <>
                          <span style={s.prNumber}>{`#${item.pr_number}`}</span>
                          <span style={s.prTitle}>{item.title}</span>
                        </>
                      )}
                    </div>
                    <div style={s.rowMeta}>
                      <span>{item.author}</span>
                      <span>{" · "}</span>
                      <span>{t("mergedAt", { date: item.merged_at })}</span>
                    </div>
                    <div style={s.rowNotes}>{item.notes}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
