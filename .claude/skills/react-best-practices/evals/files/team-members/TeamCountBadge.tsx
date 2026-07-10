interface TeamCountBadgeProps {
  count: number;
}

export function TeamCountBadge({ count }: TeamCountBadgeProps) {
  return (
    <>
      {count && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {count} active
        </span>
      )}
    </>
  );
}
