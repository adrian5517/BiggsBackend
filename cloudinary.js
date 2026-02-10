// Lightweight Cloudinary wrapper with safe fallback
// Tries to load `cloudinary` package and configure it from env vars.
// If the package isn't installed, provides a clear runtime error when used.

let cloudinary;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} catch (err) {
  // Provide a stub that surfaces a friendly error when called.
  cloudinary = {
    uploader: {
      upload_stream: (opts, cb) => {
        const message = 'cloudinary package not installed. Install with `npm install cloudinary` and set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.';
        process.nextTick(() => cb(new Error(message)));
      }
    }
  };
}

module.exports = cloudinary;
