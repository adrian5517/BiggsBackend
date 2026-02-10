const multer = require('multer');

// Allowed image MIME types
const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'image/gif'
];

// Allow PDFs for verification documents (frontend accepts .pdf)
ALLOWED_MIME_TYPES.push('application/pdf');

// Max file size in bytes (default 5MB) — configurable via env UPLOAD_MAX_FILE_SIZE
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_FILE_SIZE || 5 * 1024 * 1024);

const storage = multer.memoryStorage(); // Use memory storage for Sharp processing

function fileFilter(req, file, cb) {
	if (!file || !file.mimetype) return cb(new Error('Invalid file upload'));
	if (ALLOWED_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
		cb(null, true);
	} else {
		cb(new Error('Invalid file type. Only image files are allowed.'));
	}
}

const upload = multer({
	storage,
	limits: { fileSize: MAX_FILE_SIZE },
	fileFilter,
});

module.exports = upload;

