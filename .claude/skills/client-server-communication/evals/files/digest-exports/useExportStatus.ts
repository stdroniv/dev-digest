import { useEffect, useState } from 'react';
import { digestExportsApi } from './api-client.js';
import type { ExportJobRecord } from '@devdigest/shared';

// Polls an in-progress export job until it reaches a terminal status, so
// the download button can flip from "Preparing…" to "Download".
export function useExportStatus(workspaceId: string, exportId: string) {
  const [job, setJob] = useState<ExportJobRecord | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const latest = await digestExportsApi.get(workspaceId, exportId);
      if (cancelled) return;
      setJob(latest);
      if (latest.status === 'pending' || latest.status === 'running') {
        setTimeout(tick, 750);
      }
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, exportId]);

  return job;
}
