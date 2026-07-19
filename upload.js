const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.mov', '.avi',
  '.mp3', '.wav', '.m4a',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'
]);

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, process.env.UPLOAD_DIR || './uploads'),
  filename: (req, file, callback) => {
    const safeExtension = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(20).toString('hex');
    callback(null, `${randomName}${safeExtension}`);
  }
});

function fileFilter(req, file, callback) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return callback(new Error('That file type is not accepted as evidence.'));
  }
  callback(null, true);
}

const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxUploadBytes, files: 10 }
});

module.exports = upload;
