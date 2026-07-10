'use server';

import { db } from '@/server/db';
import { revalidatePath } from 'next/cache';

export async function acknowledgeFinding(findingId: string) {
  await db.findings.update({
    where: { id: findingId },
    data: { acknowledgedAt: new Date() },
  });
}

export async function dismissFinding(findingId: string, repoId: string) {
  await db.findings.update({
    where: { id: findingId },
    data: { dismissedAt: new Date() },
  });

  revalidatePath(`/repos/${repoId}/findings`);
}
