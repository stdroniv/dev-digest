import { Icon, Badge } from "@devdigest/ui";
import { s } from "./styles";

/** Alert shown above the timeline when a PR has any lethal-trifecta findings.
 *  Pure presentational — renders nothing when there are none. */
export function LethalTrifectaBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div style={s.lethalTrifecta}>
      <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
      <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
      <Badge color="var(--crit)" bg="transparent">
        {count} finding(s)
      </Badge>
    </div>
  );
}
