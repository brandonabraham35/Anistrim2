// routes/avatarRoutes.js
// Mount in server.js as: app.use('/api/auth', require('./routes/avatarRoutes'));
// Provides: POST /api/auth/avatar

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const auth = require('../middleware/auth');
const protect = auth.protect;

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const PUBLIC_DIR = '/uploads/avatars';
const FIELD_NAMES = ['avatar', 'image', 'file', 'photo', 'picture', 'profilePicture', 'profile_picture'];
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeExtension(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  const nameExt = path.extname(file.originalname || '').toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  if (ALLOWED_EXTS.has(nameExt)) return nameExt;
  return '.jpg';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const userId = req.user?.id || req.user?._id || 'user';
      const cleanUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
      cb(null, `avatar_${cleanUserId}_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExtension(file)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (mime.startsWith('image/') || ALLOWED_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Only image files are allowed (got ${file.mimetype || 'unknown'}).`));
  },
}).fields(FIELD_NAMES.map(name => ({ name, maxCount: 1 })));

function firstUploadedFile(req) {
  if (req.file) return req.file;
  if (!req.files) return null;
  for (const name of FIELD_NAMES) {
    if (Array.isArray(req.files[name]) && req.files[name][0]) return req.files[name][0];
  }
  for (const list of Object.values(req.files)) {
    if (Array.isArray(list) && list[0]) return list[0];
  }
  return null;
}

function getUserId(req) {
  return req.user?.id || req.user?._id || req.user?.userId || req.user?.user_id || null;
}

function optionalRequire(paths) {
  for (const p of paths) {
    try { return require(p); } catch (_) {}
  }
  return null;
}

async function updateAvatarIfDbExists(userId, avatarUrl) {
  if (!userId) return;

  const db = optionalRequire(['../config/db', '../db', '../database', '../config/database']);
  if (!db) return;

  // Your MySQL schema has avatar_url, so only update that column.
  // The old code used PostgreSQL placeholders ($1, $2), which breaks on mysql2.
  const sql = 'UPDATE users SET avatar_url = ? WHERE id = ?';

  try {
    if (typeof db.execute === 'function') {
      await db.execute(sql, [avatarUrl, userId]);
      return;
    }
    if (typeof db.query === 'function') {
      await db.query(sql, [avatarUrl, userId]);
      return;
    }
    if (typeof db.run === 'function') {
      await new Promise((resolve, reject) => db.run(sql, [avatarUrl, userId], err => err ? reject(err) : resolve()));
    }
  } catch (err) {
    console.warn('[avatarRoutes] Avatar saved but database update was skipped/failed:', err.message);
  }
}

router.post('/avatar', protect, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('[avatarRoutes] upload error:', err);
      const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        message: isTooLarge ? 'Image too large. Max 15 MB.' : (err.message || 'Upload failed. Please try again.'),
        code: err.code || 'UPLOAD_ERROR',
      });
    }

    const file = firstUploadedFile(req);
    if (!file) {
      console.error(`[avatarRoutes] no file received. Tried fields: ${FIELD_NAMES.join(', ')}`);
      return res.status(400).json({
        success: false,
        message: `No file received. Send the avatar using one of these form fields: ${FIELD_NAMES.join(', ')}.`,
      });
    }

    const avatarUrl = `${PUBLIC_DIR}/${file.filename}`;
    await updateAvatarIfDbExists(getUserId(req), avatarUrl);

    return res.json({
      success: true,
      message: 'Avatar uploaded successfully.',
      avatar: avatarUrl,
      avatarUrl,
      avatar_url: avatarUrl,
      imageUrl: avatarUrl,
      image_url: avatarUrl,
      url: avatarUrl,
      path: avatarUrl,
      filename: file.filename,
    });
  });
});

module.exports = router;
