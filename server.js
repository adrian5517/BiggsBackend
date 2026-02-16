require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
let mongoose = null;
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
  try { mongoose = require('mongoose'); } catch (e) { mongoose = null }
}
const MONGO_URI = process.env.MONGO_URI;
const cron = require('node-cron');
const authRoutes = require('./routes/authRoutes');
const fetchRoutes = require('./routes/fetchRoutes');
const reportRoutes = require('./routes/reportRoutes');
const debugRoutes = require('./routes/debugRoutes');
const masterRoutes = require('./routes/masterRoutes');
const statusRoute = require('./routes/status');
const healthRoute = require('./routes/health');
const queueEventsRoute = require('./routes/queueEvents');
const adminRoutes = require('./routes/adminRoutes');
const { scheduleRetention } = require('./services/backupRetention');
let exportQueueService = null
try { exportQueueService = require('./services/exportQueue') } catch (e) { console.warn('exportQueue service not available', e.message) }
let importQueueService = null
try { importQueueService = require('./services/importQueue') } catch (e) { console.warn('importQueue service not available', e.message) }

// Middleware to parse JSON requests
    // Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function(origin, callback) {
    // allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) {
      console.log('[CORS] no origin (server-to-server or file://). Allowing');
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('[CORS] allowing origin', origin);
      return callback(null, true);
    }

    // During local development allow any localhost/127.0.0.1 origin regardless of port
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(origin);
        const host = parsed.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          console.log('[CORS] allowing local dev origin', origin);
          return callback(null, true);
        }
      } catch (e) {
        // fall through to deny
      }
    }

    console.warn('[CORS] denying origin', origin);
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
app.use('/api/debug', debugRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/status', statusRoute);
app.use('/api/health', healthRoute);
app.use('/api/queue/events', queueEventsRoute);
app.use('/api/admin', adminRoutes);

// Generic JSON error handler for API routes - ensures JSON responses on server errors
app.use((err, req, res, next) => {
  try {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
  } catch (e) {
    // ignore logging errors
  }

  if (res.headersSent) {
    return next(err);
  }

  const path = req && (req.originalUrl || req.url || req.path) ? String(req.originalUrl || req.url || req.path) : '';
  if (path.startsWith('/api/')) {
    // Map MongoDB storage/quota errors to 507 Insufficient Storage with a helpful message
    const isMongoQuotaError = err && (err.name === 'MongoServerError' || (err.message && String(err.message).toLowerCase().includes('over your space quota')));
    if (isMongoQuotaError) {
      console.error('MongoDB storage quota exceeded:', err && err.message ? err.message : err);
      return res.status(507).json({ message: 'MongoDB storage quota exceeded. Free up space or upgrade your plan.' });
    }

    const status = err && err.status ? err.status : 500;
    const message = err && err.message ? err.message : 'Server error';
    return res.status(status).json({ message });
  }

  return next(err);
});

// Start the export worker in background (non-blocking)
if (exportQueueService && exportQueueService.startWorker) {
  try { exportQueueService.startWorker().catch(e => console.error('exportQueue start failed', e)) } catch (e) { console.error('exportQueue start error', e) }
} else {
  console.log('exportQueue not configured; falling back to legacy worker if present')
  try { const exportWorker = require('./services/exportWorker'); exportWorker.start().catch(()=>{}) } catch (e) {}
}

// Start import queue worker if available
if (importQueueService && importQueueService.startWorker) {
  try { importQueueService.startWorker().catch(e => console.error('importQueue start failed', e)) } catch (e) { console.error('importQueue start error', e) }
} else {
  console.log('importQueue not configured; import jobs will not be processed by queue')
}






console.log('Resolved MONGO_URI =', MONGO_URI || '<missing>')
console.log(`Starting server on port ${port}...`)
// Connect to Mongo only when explicitly enabled. Default: Postgres-only mode (no Mongo connection).
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true' && MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Could not connect to MongoDB', err));
} else {
  console.log('MongoDB connection skipped (ENABLE_MONGO!=true). Running Postgres-only.')
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Schedule backup retention if enabled and keep handle for graceful shutdown
let _backupRetentionHandle = null;
try {
  const enable = process.env.POS_ENABLE_RETENTION !== 'false';
  if (enable) {
    const retentionDays = Number(process.env.POS_BACKUP_RETENTION_DAYS || 90);
    const hours = Number(process.env.POS_BACKUP_RETENTION_INTERVAL_HOURS || 24);
    const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;
    _backupRetentionHandle = scheduleRetention({ intervalMs, retentionDays });
    console.log(`Scheduled backup retention: every ${hours}h, keep ${retentionDays} days`);
  } else {
    console.log('Backup retention scheduling disabled (POS_ENABLE_RETENTION=false)');
  }
} catch (e) {
  console.error('Failed to schedule backup retention:', e && e.message ? e.message : e);
}

// Graceful shutdown: stop scheduled tasks and close DB connections
async function gracefulShutdown(signal) {
  console.log(`Received ${signal} - shutting down gracefully`);
  try {
    if (_backupRetentionHandle && typeof _backupRetentionHandle.stop === 'function') {
      _backupRetentionHandle.stop();
      console.log('Stopped backup retention scheduler');
    }
  } catch (e) {
    console.error('Error stopping backup retention scheduler:', e && e.message ? e.message : e);
  }

  try {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (e) {
    console.error('Error disconnecting MongoDB during shutdown:', e && e.message ? e.message : e);
  }

  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));




