require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const activityRoutes = require('./routes/activity');
const analyticsRoutes = require('./routes/analytics');
const userRoutes = require('./routes/users');
const identityAccessRoutes = require('./routes/identityAccess');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and any explicitly configured origin.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('This origin is not allowed to access the SUMAT Eastvicians API.'));
    },
    credentials: true
  })
);

// General API-wide rate limit, on top of the stricter per-route limits in auth/reports.
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/identity-access', identityAccessRoutes);

// Multer and validation errors surface here with a clean JSON message instead of a stack trace.
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(err.status || 400).json({ error: err.message || 'Something went wrong.' });
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

const port = process.env.PORT || 5050;
app.listen(port, () => console.log(`SUMAT Eastvicians API listening on port ${port}`));
