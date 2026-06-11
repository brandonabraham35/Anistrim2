// Backend/utils/cloudinaryUpload.js
// Safe Cloudinary uploader for AniStrim.
// Uses multer memory storage + Cloudinary upload_stream.
// No local /uploads folder. No multer-storage-cloudinary dependency.

const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const FIELD_NAMES = [
  'image',
  'file',
  'avatar',
  'photo',
  'picture',
  'thumbnail',
  'thumbnail_url',
  'cover',
  'cover_image',
  'banner',
  'banner_image',
];

const FOLDERS = {
  anime: 'anistrim/anime',
  banners: 'anistrim/banners',
  thumbnails: 'anistrim/thumbnails',
  avatars: 'anistrim/avatars',
  profiles: 'anistrim/avatars',
};

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

configureCloudinary();

const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed.'));
  },
}).fields(FIELD_NAMES.map((name) => ({ name, maxCount: 1 })));

function parseUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadParser(req, res, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

function firstUploadedFile(req) {
  if (req.file) return req.file;
  if (!req.files) return null;

  for (const name of FIELD_NAMES) {
    const value = req.files[name];
    if (Array.isArray(value) && value[0]) return value[0];
  }

  for (const value of Object.values(req.files)) {
    if (Array.isArray(value) && value[0]) return value[0];
  }

  return null;
}

function normalizeFolder(folderKey) {
  return FOLDERS[folderKey] || FOLDERS.anime;
}

function uploadBufferToCloudinary(file, folderKey) {
  return new Promise((resolve, reject) => {
    if (!file || !file.buffer) {
      return reject(new Error('No image file received.'));
    }

    const folder = normalizeFolder(folderKey);
    const safeName = String(file.originalname || 'image')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image';

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        public_id: `${folderKey || 'image'}-${Date.now()}-${safeName}`,
        overwrite: false,
        unique_filename: true,
        use_filename: false,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'],
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result || !result.secure_url) {
          return reject(new Error('Cloudinary did not return an image URL.'));
        }
        return resolve(result);
      }
    );

    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });
}

async function handleImageUpload(req, res, folderKey) {
  try {
    if (!hasCloudinaryConfig()) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Railway Variables.',
        code: 'CLOUDINARY_NOT_CONFIGURED',
      });
    }

    await parseUpload(req, res);
    const file = firstUploadedFile(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: `No image received. The form field must be one of: ${FIELD_NAMES.join(', ')}.`,
        code: 'NO_FILE_RECEIVED',
        acceptedFields: FIELD_NAMES,
      });
    }

    const result = await uploadBufferToCloudinary(file, folderKey);
    const url = result.secure_url;

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully.',
      url,
      imageUrl: url,
      image_url: url,
      secure_url: url,
      path: url,
      public_id: result.public_id,
      asset_id: result.asset_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      folder: folderKey,
    });
  } catch (err) {
    console.error('[cloudinaryUpload] Upload failed:', err);

    const isTooLarge = err && err.code === 'LIMIT_FILE_SIZE';
    const message = isTooLarge
      ? 'Image too large. Please upload an image smaller than 15 MB.'
      : (err && err.message) || 'Upload failed. Please try again.';

    return res.status(isTooLarge ? 413 : 400).json({
      success: false,
      message,
      code: (err && err.code) || 'UPLOAD_FAILED',
    });
  }
}

module.exports = {
  cloudinary,
  configureCloudinary,
  hasCloudinaryConfig,
  handleImageUpload,
  FIELD_NAMES,
  FOLDERS,
  MAX_FILE_SIZE,
};
