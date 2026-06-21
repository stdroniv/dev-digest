/* Agent → Skills tab. Attach/detach skills (checkbox) and drag to reorder. The
   row order of the CHECKED skills becomes agent_skills.order, which drives the
   order of the rule blocks in the assembled prompt. Disabled skills can still be
   attached, but the run executor injects only ENABLED ones. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Skeleton, EmptyState } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkillLinks, useSetAgentSkills } from "@/lib/hooks/skills";
import { typeColor } from "@/lib/skill-format";
import { s } from "./styles";

/** Order all skills: attached (in link order) first, then the rest by list order. */
function initialOrder(skills: Skill[], linkedIds: string[]): string[] {
  const linked = linkedIds.filter((id) => skills.some((s) => s.id === id));
  const rest = skills.filter((sk) => !linked.includes(sk.id)).map((sk) => sk.id);
  return [...linked, ...rest];
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: skills, isLoading } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkillLinks(agent.id);
  const setSkills = useSetAgentSkills(agent.id);

  const [order, setOrder] = React.useState<string[]>([]);
  const [attached, setAttached] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState("");
  const dragId = React.useRef<string | null>(null);
  // Per-skill-id in-flight guard. The vendored Checkbox is a <button> in a
  // <label>, so one click fires onChange twice; if a re-render lands between the
  // two fires the second computes the opposite intent and re-adds the skill. We
  // drop the spurious second fire and clear the guard when the mutation settles.
  const toggling = React.useRef<Set<string>>(new Set());

  // Hydrate local state once both queries land (and when switching agents).
  React.useEffect(() => {
    if (!skills || !links) return;
    const linkedIds = [...links].sort((a, b) => a.order - b.order).map((l) => l.skill_id);
    setOrder(initialOrder(skills, linkedIds));
    setAttached(new Set(linkedIds));
  }, [agent.id, skills, links]);

  const byId = React.useMemo(() => new Map((skills ?? []).map((sk) => [sk.id, sk])), [skills]);

  /** Persist the current checked set in row order. */
  const persist = (
    nextOrder: string[],
    nextAttached: Set<string>,
    onSettled?: () => void,
  ) => {
    const ids = nextOrder.filter((id) => nextAttached.has(id));
    setSkills.mutate(ids, onSettled ? { onSettled } : undefined);
  };

  const toggle = (id: string, on: boolean) => {
    if (toggling.current.has(id)) return; // drop the label's duplicate fire
    toggling.current.add(id);
    const next = new Set(attached);
    if (on) next.add(id);
    else next.delete(id);
    setAttached(next);
    persist(order, next, () => toggling.current.delete(id));
  };

  const onDrop = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    const next = [...order];
    next.splice(next.indexOf(from), 1);
    next.splice(next.indexOf(targetId), 0, from);
    setOrder(next);
    persist(next, attached);
  };

  if (isLoading || linksLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (!skills || skills.length === 0) {
    return <EmptyState icon="Sparkles" title={t("skills.title")} body={t("skills.orderHint")} />;
  }

  const visible = order
    .map((id) => byId.get(id))
    .filter((sk): sk is Skill => !!sk)
    .filter((sk) => `${sk.name} ${sk.description}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: attached.size, total: skills.length })}
        </Badge>
        <input
          style={s.filter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("skills.filterPlaceholder")}
          aria-label={t("skills.filterPlaceholder")}
        />
      </div>
      <p style={s.orderHint}>{t("skills.orderHint")}</p>

      <div style={s.list}>
        {visible.map((sk) => (
          <div
            key={sk.id}
            draggable
            onDragStart={() => (dragId.current = sk.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(sk.id)}
            style={s.row(attached.has(sk.id))}
          >
            <span style={s.handle} aria-hidden>
              <Icon.Menu size={14} />
            </span>
            <Checkbox checked={attached.has(sk.id)} onChange={(v) => toggle(sk.id, v)} />
            <span className="mono" style={s.name}>
              {sk.name}
            </span>
            {!sk.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
            <Badge color={typeColor(sk.type)} bg="transparent">
              {sk.type}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
