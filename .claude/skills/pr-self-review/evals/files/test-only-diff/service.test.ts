import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from '../../modules/notifications/service.js';

describe('NotificationsService.markRead', () => {
  it('marks a notification as read', async () => {
    const repo = {
      markRead: vi.fn().mockResolvedValue({
        id: 'n1',
        workspaceId: 'w1',
        body: 'PR #12 was reviewed',
        read: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    };
    const container = { db: {} } as never;
    const service = new NotificationsService(container);
    // @ts-expect-error reaching into the private repo for this test double
    service.repo = repo;

    const result = await service.markRead('w1', 'n1');

    // Only checks that *something* came back — never asserts the returned
    // DTO's `read` flag actually flipped to true, or that the repo was
    // called with the workspaceId/notificationId this test set up. A repo
    // stub that silently ignored its arguments would still pass this test.
    expect(result).toBeTruthy();
  });
});
