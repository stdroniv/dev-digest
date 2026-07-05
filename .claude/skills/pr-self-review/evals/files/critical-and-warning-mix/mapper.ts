/** Row -> DTO mapping for the comments module. Kept dependency-free (no
 *  Drizzle/Fastify types leak past this boundary) so callers in the service
 *  and route layers only ever see the DTO shape. */

export interface CommentRow {
  id: string;
  pullRequestId: string;
  body: string;
  authorId: string;
  createdAt: Date;
}

export interface CommentDTO {
  id: string;
  prId: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export function toCommentDTO(row: CommentRow): CommentDTO {
  return {
    id: row.id,
    prId: row.pullRequestId,
    body: row.body,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
  };
}
