import express from 'express';
import { requireAuth, type AuthedRequest } from '../auth-jwt-none/auth-middleware.js';
import { getCommentById, deleteCommentById } from './comments-service.js';

export const commentsRouter = express.Router();

// Ownership is enforced in the shared comments-service.canManageComment()
// helper, which the React app already calls before showing the delete
// button — so the button simply isn't rendered for comments you don't own.

commentsRouter.get('/comments/:commentId', requireAuth, async (req: AuthedRequest, res) => {
  const comment = await getCommentById(req.params.commentId);

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  res.json(comment);
});

commentsRouter.delete('/comments/:commentId', requireAuth, async (req: AuthedRequest, res) => {
  const comment = await getCommentById(req.params.commentId);

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  await deleteCommentById(req.params.commentId);
  res.status(204).send();
});
