import type { Container } from '../../container.js';
import { CommentsRepository } from './repository.js';
import type { CommentDTO } from './mapper.js';
import { toCommentDTO } from './mapper.js';

export class CommentsService {
  private readonly repo: CommentsRepository;

  constructor(private readonly container: Container) {
    this.repo = new CommentsRepository(container.db);
  }

  async addComment(prId: string, body: string): Promise<CommentDTO> {
    const row = await this.repo.insert(prId, body);
    return toCommentDTO(row);
  }

  /**
   * Returns every comment on a PR together with the display name of the
   * author who wrote it. `authorIds` typically has a handful of distinct
   * authors on a given PR, so we resolve each one individually.
   */
  async listWithAuthors(prId: string): Promise<Array<CommentDTO & { authorName: string }>> {
    const rows = await this.repo.listByPullRequest(prId);

    const result: Array<CommentDTO & { authorName: string }> = [];
    for (const row of rows) {
      // One round-trip to the users table per comment, inside the loop —
      // on a PR with 50 comments from 3 people this is 50 sequential queries
      // instead of one batched lookup.
      const author = await this.repo.findAuthorById(row.authorId);
      result.push({ ...toCommentDTO(row), authorName: author?.displayName ?? 'unknown' });
    }
    return result;
  }
}
