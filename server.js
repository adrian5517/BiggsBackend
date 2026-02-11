require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI;
const cron = require('node-cron');
const authRoutes = require('./routes/authRoutes');
const fetchRoutes = require('./routes/fetchRoutes');
const reportRoutes = require('./routes/reportRoutes');

// Middleware to parse JSON requests
    // Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function(origin, callback) {
    // allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // During local development allow any localhost/127.0.0.1 origin regardless of port
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(origin);
        const host = parsed.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          // allow
          console.log('CORS: allowing local dev origin', origin);
          return callback(null, true);
        }
      } catch (e) {
        // fall through to deny
      }
    }

    return callback(new Error('CORS policy: This origin is not allowed: ' + origin));
  },
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
};

app.use(cors(corsOptions));


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cloudinary upload endpoint
// Upload route (uses routes/upload.js)
const uploadRoute = require('./routes/upload');
// Mount both `/api/upload` and legacy `/upload` so clients/proxies hitting either path work
app.use('/api/upload', uploadRoute);
app.use('/upload', uploadRoute);

// Lightweight debug logger for upload/profile-picture requests to help diagnose client method issues
app.use((req, res, next) => {
  if (req.path.includes('/upload') || req.path.includes('/profile-picture')) {
    console.log('[BACKEND DEBUG]', req.method, req.originalUrl, 'Origin:', req.headers.origin || '-', 'Auth present:', !!req.headers.authorization)
  }
  next()
});

// Cron job (every 15 minutes)
cron.schedule('*/15 * * * *', () => {
  console.log('🕒 Cron job executed.');
});


//Routes
app.use('/api/auth', authRoutes);
app.use('/api/fetch', fetchRoutes);
app.use('/api/reports', reportRoutes);






mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB', err));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});




