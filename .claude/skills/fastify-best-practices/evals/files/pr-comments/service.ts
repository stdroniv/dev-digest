interface Container {
  db: {
    comments: {
      findById(workspaceId: string, commentId: string): Promise<CommentRow | null>;
      update(commentId: string, patch: Partial<CommentRow>): Promise<CommentRow>;
    };
  };
}

interface CommentRow {
  id: string;
  workspaceId: string;
  status: 'open' | 'resolved' | 'already-resolved';
  resolutionNote: string | null;
}

export class CommentsService {
  constructor(private readonly container: Container) {}

  async findById(workspaceId: string, commentId: string) {
    return this.container.db.comments.findById(workspaceId, commentId);
  }

  async resolve(workspaceId: string, commentId: string, resolutionNote?: string) {
    return this.container.db.comments.update(commentId, {
      status: 'resolved',
      resolutionNote: resolutionNote ?? null,
    });
  }

  buildContextSync(workspaceId: string, commentId: string): string | null {
    // Synchronous placeholder for building surrounding-diff context.
    return `context for ${workspaceId}/${commentId}`;
  }

  cacheContext(commentId: string, context: string): void {
    // Placeholder cache write.
  }
}
