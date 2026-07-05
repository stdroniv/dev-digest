import { z } from 'zod';
import { ExportJobRecord } from '@devdigest/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = body?.error?.code ?? 'unknown_error';
    const message = body?.error?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json();
  return schema.parse(json);
}

export const digestExportsApi = {
  create(workspaceId: string, digestId: string, format: 'pdf' | 'csv' | 'json') {
    return request(`/workspaces/${workspaceId}/exports`, ExportJobRecord, {
      method: 'POST',
      body: JSON.stringify({ digestId, format }),
    });
  },
  get(workspaceId: string, exportId: string) {
    return request(
      `/workspaces/${workspaceId}/exports/${exportId}`,
      ExportJobRecord,
    );
  },
};
