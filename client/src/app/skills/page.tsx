/* Route: /skills (Skills Lab list). Thin entry — the master/detail workspace, its
   cards, import drawer and editor live under _components/SkillsWorkspace. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SkillsWorkspace } from "./_components/SkillsWorkspace";

export default function SkillsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = search.get("tab") ?? "config";
  // No skill selected yet — selecting one navigates to /skills/:id.
  return <SkillsWorkspace selectedId={null} tab={tab} onTab={(t) => router.replace(`/skills?tab=${t}`)} />;
}
