import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { avatarUpload, UPLOAD_DIR } from './upload-config.js';
import { Media } from './media-model.js';
import { requireAuth, type AuthedRequest } from '../auth-jwt-none/auth-middleware.js';

export const mediaRouter = express.Router();

mediaRouter.post('/avatars', requireAuth, avatarUpload.single('avatar'), async (req: AuthedRequest, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  // Record upload metadata alongside whatever extra fields the client sent
  // (e.g. captions, alt text) so the frontend team doesn't need a new
  // endpoint every time they add a form field.
  const record = await Media.create({
    ...req.body,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedBy: req.user!.userId,
  });

  res.status(201).json(record);
});

mediaRouter.delete('/avatars', requireAuth, async (req: AuthedRequest, res) => {
  const relativePath = req.query.path as string;

  if (!relativePath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const target = path.join(UPLOAD_DIR, relativePath);
  await fs.unlink(target);

  res.status(204).send();
});

// Static serving is mounted separately in app.ts with:
//   app.use('/uploads', helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
//     express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny' }));
