const Message = require('../models/messageModel');
const Comment = require('../models/commentModel');
const { HttpError } = require('../utils/httpError');
const { parseId } = require('../utils/parseId');
const { parseLimit } = require('../utils/parseLimit');

const MAX_LENGTH = 2000;
const PREVIEW_COMMENTS = 3;

function messageBody(req) {
  const body = String(req.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Message is required');
  if (body.length > MAX_LENGTH) throw new HttpError(400, `Message must be ${MAX_LENGTH} characters or fewer`);
  return body;
}

// One page of the feed: ?before=<id> for older, ?after=<id> for newer, neither for the newest.
// Memory per request depends only on the page size, never on how many messages exist.
async function list(req, res) {
  const { before, after } = req.query;
  if (before && after) throw new HttpError(400, 'Use either before or after, not both');
  const limit = parseLimit(req.query.limit);
  const viewerId = req.session.user.id;
  const messages = await Message.findPage({
    before: before && parseId(before, 'cursor'),
    after: after && parseId(after, 'cursor'),
    limit,
    viewerId,
  });

  const comments = await Comment.previews(messages.map((m) => m.id), PREVIEW_COMMENTS, viewerId);
  const byMessage = new Map(messages.map((m) => [m.id, []]));
  for (const c of comments) byMessage.get(c.message_id).push(c);

  res.json({
    messages: messages.map((m) => ({ ...m, comments: byMessage.get(m.id) })),
    // A full page means there may be more in that direction.
    hasMore: messages.length === limit,
  });
}

// Returns the whole new message so the client can show it without re-fetching the feed.
async function create(req, res) {
  const { id: userId, username } = req.session.user;
  const body = messageBody(req);
  const { id } = await Message.create(userId, body);
  res.status(201).json({
    id, user_id: userId, username, body,
    comment_count: 0, like_count: 0, liked_by_me: false,
    created_at: new Date(), edited_at: null, comments: [],
  });
}

async function update(req, res) {
  const body = messageBody(req);
  const updated = await Message.update(req.session.user.id, parseId(req.params.id), body);
  if (!updated) throw new HttpError(403, 'You can only edit your own messages');
  res.json({ ok: true, body, edited_at: updated.edited_at });
}

async function remove(req, res) {
  const found = await Message.remove(req.session.user.id, parseId(req.params.id));
  if (!found) throw new HttpError(403, 'You can only delete your own messages');
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
