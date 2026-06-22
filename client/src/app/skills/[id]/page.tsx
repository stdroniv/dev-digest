/* Route: /skills/:id — Skill editor (master/detail). Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SkillsWorkspace } from "../_components/SkillsWorkspace";

export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { id } = params;
  const tab = search.get("tab") ?? "config";

  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    // scroll:false — a tab change must not jump the left list's scroll container.
    router.replace(`/skills/${id}?${sp.toString()}`, { scroll: false });
  };

  return <SkillsWorkspace selectedId={id} tab={tab} onTab={setTab} />;
}
