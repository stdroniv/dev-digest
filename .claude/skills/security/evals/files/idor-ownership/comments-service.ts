import { Comment } from './comment-model.js';

export interface CommentAuthor {
  userId: string;
  role: string;
}

// Domain-level helper the frontend store also calls (via the shared package)
// to decide whether to render the edit/delete controls for a comment.
export function canManageComment(author: CommentAuthor, comment: { authorId: string }): boolean {
  return author.userId === comment.authorId || author.role === 'admin';
}

export async function getCommentById(commentId: string) {
  return Comment.findById(commentId);
}

export async function deleteCommentById(commentId: string) {
  return Comment.findByIdAndDelete(commentId);
}
