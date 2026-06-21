/* SkillCard — type-colored icon, name, description, type + source badges, and an
   enabled toggle. Imported/untrusted skills surface a "needs vetting" hint. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import type { Skill, SkillSource } from "@devdigest/shared";
import { typeColor } from "./helpers";
import { s } from "./styles";

/** Source → icon, mirroring the design's list-item source row. */
const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "FlaskConical",
  community: "Globe",
  imported_url: "Link",
};

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = typeColor(skill.type);
  // A skill from an untrusted source that is still disabled hasn't been vetted.
  const needsVetting = !skill.enabled && skill.source !== "manual";

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <span style={s.iconBox(color)}>
          <Icon.Sparkles size={13} />
        </span>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg="transparent">
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <span style={s.source}>
          <Icon.Dot size={4} />
          {React.createElement(Icon[SOURCE_ICON[skill.source]], { size: 11 })}
          {t(`listItem.source.${skill.source}`)}
        </span>
        {needsVetting && (
          <span style={s.vetting} title={t("listItem.vettingTitle")}>
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>
    </div>
  );
}
