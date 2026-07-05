import type { Container } from '../../container.js';
import { toNotificationDTO, type NotificationDTO } from './mapper.js';

export class NotificationsService {
  constructor(private readonly container: Container) {}

  private get repo() {
    // Bound in the composition root (container.ts) as
    // `get notificationsRepo() { return (this._notificationsRepo ??= new NotificationsRepository(this.db)); }`
    // — never constructed here.
    return this.container.notificationsRepo;
  }

  async listForWorkspace(workspaceId: string): Promise<NotificationDTO[]> {
    const rows = await this.repo.listByWorkspace(workspaceId);
    return rows.map(toNotificationDTO);
  }

  async markRead(workspaceId: string, notificationId: string): Promise<NotificationDTO> {
    const row = await this.repo.markRead(workspaceId, notificationId);
    return toNotificationDTO(row);
  }

  async deleteById(notificationId: string): Promise<void> {
    await this.repo.deleteById(notificationId);
  }
}
