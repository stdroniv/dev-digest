"use client";

/* lib/hooks/notifications.ts — thin TanStack Query wrappers over the
   notifications API. Mirrors the shape of the other hooks in this folder:
   all data access goes through here, never a raw `fetch` in a component. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Notification } from "@devdigest/shared";

export function useNotifications(workspaceId: string | null) {
  return useQuery({
    queryKey: ["notifications", workspaceId],
    queryFn: () => api.get<Notification[]>(`/workspaces/${workspaceId}/notifications`),
    enabled: !!workspaceId,
  });
}

export function useMarkNotificationRead(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      api.post<Notification>(`/workspaces/${workspaceId}/notifications/${notificationId}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", workspaceId] });
    },
  });
}

export function useDeleteNotification(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.delete(`/notifications/${notificationId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", workspaceId] });
    },
  });
}
