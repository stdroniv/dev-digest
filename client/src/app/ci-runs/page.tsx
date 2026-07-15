"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { CiRunsPage } from "./_components/CiRunsPage";

/* Route: /ci-runs (SPEC-05, GLOBAL nav entry). T9 wired the nav entry, data
   hooks (lib/hooks/ci.ts), and i18n; T11 owns the page body under
   _components/CiRunsPage (table, filters, auto-refresh, empty state) — this
   file stays a thin AppShell wrapper per the "pages are thin" convention. */
export default function Page() {
  const t = useTranslations("ci");
  const crumb = [{ label: t("page.crumb") }];

  return (
    <AppShell crumb={crumb}>
      <CiRunsPage />
    </AppShell>
  );
}
