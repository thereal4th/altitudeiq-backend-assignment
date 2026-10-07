const Comment = require('../models/commentModel');
const { HttpError } = require('../utils/httpError');
const { parseId } = require('../utils/parseId');
const { parseLimit } = require('../utils/parseLimit');

const MAX_LENGTH = 500;

function commentBody(req) {
  const body = String(req.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Comment is required');
  if (body.length > MAX_LENGTH) throw new HttpError(400, `Comment must be ${MAX_LENGTH} characters or fewer`);
  return body;
}

// Older comments of a message: ?before=<comment id>, newest first.
async function list(req, res) {
  const messageId = parseId(req.params.id, 'message id');
  const before = req.query.before && parseId(req.query.before, 'cursor');
  const limit = parseLimit(req.query.limit);
  const comments = await Comment.findPage(messageId, before, limit, req.session.user.id);
  res.json({ comments, hasMore: comments.length === limit });
}

async function create(req, res) {
  const messageId = parseId(req.params.id, 'message id');
  const body = commentBody(req);
  const { id: userId, username } = req.session.user;

  const created = await Comment.create(userId, messageId, body);
  if (!created) throw new HttpError(404, 'Message not found');
  res.status(201).json({
    id: created.id, message_id: messageId, user_id: userId, username, body,
    like_count: 0, liked_by_me: false, created_at: new Date(), edited_at: null,
  });
}

async function update(req, res) {
  const body = commentBody(req);
  const updated = await Comment.update(req.session.user.id, parseId(req.params.id, 'comment id'), body);
  if (!updated) throw new HttpError(403, 'You can only edit your own comments');
  res.json({ ok: true, body, edited_at: updated.edited_at });
}

async function remove(req, res) {
  const found = await Comment.remove(req.session.user.id, parseId(req.params.id, 'comment id'));
  if (!found) throw new HttpError(403, 'You can only delete your own comments');
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
