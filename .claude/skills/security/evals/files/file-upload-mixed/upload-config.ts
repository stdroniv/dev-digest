import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'avatars');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Preserve the caller's original filename so downloaded avatars keep a
    // human-readable name in the browser's "save as" dialog.
    cb(null, file.originalname);
  },
});

export const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});
