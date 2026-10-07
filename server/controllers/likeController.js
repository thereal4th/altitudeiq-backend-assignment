const Like = require('../models/likeModel');
const { HttpError } = require('../utils/httpError');
const { parseId } = require('../utils/parseId');

const LABEL = { message: 'Message', comment: 'Comment' };

// PUT likes and DELETE unlikes, so repeating a request never changes the outcome.
function setLike(target, liked) {
  return async function (req, res) {
    const id = parseId(req.params.id, `${target} id`);
    const result = await Like.set(target, req.session.user.id, id, liked);
    if (!result) throw new HttpError(404, `${LABEL[target]} not found`);
    res.json(result);
  };
}

module.exports = {
  likeMessage: setLike('message', true),
  unlikeMessage: setLike('message', false),
  likeComment: setLike('comment', true),
  unlikeComment: setLike('comment', false),
};
