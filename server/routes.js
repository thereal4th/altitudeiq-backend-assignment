const express = require('express');
const auth = require('./controllers/authController');
const messages = require('./controllers/messageController');
const comments = require('./controllers/commentController');
const likes = require('./controllers/likeController');
const requireLogin = require('./middleware/requireLogin');
const limits = require('./middleware/rateLimits');
const { asyncHandler } = require('./utils/httpError');

const router = express.Router();

// ---------- Auth ----------
router.post('/register', limits.register, asyncHandler(auth.register));
router.post('/login', limits.login, asyncHandler(auth.login));
router.post('/logout', auth.logout);
router.get('/me', auth.me);

// ---------- Messages (signed-in users read; only the author edits or deletes) ----------
router.use('/messages', requireLogin);
router.get('/messages', asyncHandler(messages.list));
router.post('/messages', limits.write, asyncHandler(messages.create));
router.put('/messages/:id', limits.write, asyncHandler(messages.update));
router.delete('/messages/:id', limits.write, asyncHandler(messages.remove));
router.put('/messages/:id/like', limits.like, asyncHandler(likes.likeMessage));
router.delete('/messages/:id/like', limits.like, asyncHandler(likes.unlikeMessage));

// ---------- Comments (anyone signed in reads and adds; only the author edits or deletes) ----------
router.get('/messages/:id/comments', asyncHandler(comments.list));
router.post('/messages/:id/comments', limits.write, asyncHandler(comments.create));
router.use('/comments', requireLogin);
router.put('/comments/:id', limits.write, asyncHandler(comments.update));
router.delete('/comments/:id', limits.write, asyncHandler(comments.remove));
router.put('/comments/:id/like', limits.like, asyncHandler(likes.likeComment));
router.delete('/comments/:id/like', limits.like, asyncHandler(likes.unlikeComment));

module.exports = router;
