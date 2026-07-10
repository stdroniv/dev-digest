interface Finding {
  id: string;
  file: string;
  severity: string;
  message: string;
}

interface FindingRowProps {
  finding: Finding;
}

export function FindingRow({ finding }: FindingRowProps) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium">{finding.severity}</span>
      <span className="font-mono text-xs text-neutral-500">{finding.file}</span>
      <span className="text-sm">{finding.message}</span>
    </li>
  );
}
