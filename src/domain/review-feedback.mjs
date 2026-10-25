/** Owner feedback on retained reviews; not telemetry, billing or a proof ledger. */
const ratings = new Set(['useful', 'not-useful', 'unclear']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export class ReviewFeedbackError extends Error {
  constructor(code, message) { super(message); this.name = 'ReviewFeedbackError'; this.code = code; this.status = 400; }
}
function fail(message, code = 'invalid_feedback') { throw new ReviewFeedbackError(code, message); }
function exact(value, keys) { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Send only the documented feedback fields.'); }
function reasonText(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) fail('Keep the feedback reason to 500 characters of plain text.');
  if (/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+|[a-z][a-z0-9+.-]*:\/\/[^/\s]+:[^/\s]+@|[?&](?:token|key|secret|auth|signature)=|<\s*script\b/i.test(value)) fail('Remove passwords, keys, scripts and private access links from your feedback.');
  return value.trim();
}
function reviewId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) fail('Choose a saved review before adding feedback.');
  return value;
}
function feedbackValue(input, stored = false) {
  exact(input, stored ? ['rating', 'reason', 'savedAt'] : ['rating', 'reason']);
  if (!ratings.has(input.rating)) fail('Choose Useful, Not useful or Unclear (useful, not-useful or unclear in JSON).');
  const result = { rating: input.rating };
  if (own(input, 'reason')) { const reason = reasonText(input.reason); if (reason) result.reason = reason; }
  if (stored) {
    if (typeof input.savedAt !== 'string' || input.savedAt.length > 30 || Number.isNaN(Date.parse(input.savedAt)) || new Date(input.savedAt).toISOString() !== input.savedAt) fail('Saved feedback needs a valid ISO timestamp. Restore the original saved value.');
    result.savedAt = input.savedAt;
  }
  return result;
}
export function retainedReviewFeedback(state) {
  const input = state.reviewFeedback ?? {};
  if (!plain(input) || Object.keys(input).length > 100) fail('Feedback can cover up to 100 saved reviews.');
  const allowed = new Set((state.reviewRuns ?? []).map(review => review.id));
  const result = {};
  for (const [id, value] of Object.entries(input)) {
    reviewId(id);
    const feedback = feedbackValue(value, true);
    if (allowed.has(id)) result[id] = feedback;
  }
  return result;
}
export function recordReviewFeedback(state, input, now = new Date()) {
  exact(input, ['reviewId', 'rating', 'reason']);
  const id = reviewId(input.reviewId);
  if (!(state.reviewRuns ?? []).some(review => review.id === id)) fail('This review is no longer saved in your workspace. Choose a saved review before adding feedback.', 'review_not_found');
  const value = feedbackValue(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'reviewId')));
  const previous = retainedReviewFeedback(state);
  const old = previous[id];
  const unchanged = old?.rating === value.rating && old?.reason === value.reason;
  const feedback = { ...value, savedAt: unchanged ? old.savedAt : now.toISOString() };
  return { reviewId: id, feedback, reviewFeedback: { ...previous, [id]: feedback } };
}
