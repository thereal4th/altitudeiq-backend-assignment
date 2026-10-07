const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const db = require('./config/db');
const { createSessionStore } = require('./config/sessionStore');
const routes = require('./routes');
const sameOrigin = require('./middleware/sameOrigin');
const { notFound, errorHandler } = require('./middleware/errorHandler');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 random characters');
}

const isProduction = process.env.NODE_ENV === 'production';
const SESSION_IDLE_MS = 1000 * 60 * 60 * 24 * 2; // signed out after 2 days without activity
const app = express();

if (isProduction) app.set('trust proxy', 1); // behind a TLS-terminating proxy

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProduction && { upgradeInsecureRequests: [] }),
    },
  },
  strictTransportSecurity: isProduction, // HSTS only makes sense over HTTPS
}));
app.use(compression());

// Static files come before the session so asset requests never touch the session store.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, file) {
    // Fonts never change; everything else is revalidated with its ETag on each load.
    res.set('Cache-Control', file.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
}));

const sessionStore = createSessionStore(db, { expiration: SESSION_IDLE_MS });
app.locals.sessionStore = sessionStore;

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store'); // per-user data must not be cached
  next();
});
app.use('/api', express.json({ limit: '10kb' }));
app.use('/api', sameOrigin);
app.use('/api', session({
  name: 'wall.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // each request pushes the idle timeout back
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: SESSION_IDLE_MS,
  },
}));

app.use('/api', routes);
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
