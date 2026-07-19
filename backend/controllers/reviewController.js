import { submitReview, listReviews, listReviewableEvents } from '../services/reviewService.js';

const SUBMIT_ERRORS = {
  not_authenticated: { status: 401, message: 'Please sign in to leave a review.' },
  bad_rating: { status: 400, message: 'Choose a rating between 1 and 5 stars.' },
  not_found: { status: 404, message: 'That event could not be found.' },
  event_not_completed: { status: 400, message: 'You can only review an event after it has finished.' },
  not_attended: { status: 403, message: 'Only people who joined this event can review it.' },
};

export async function getReviews(req, res) {
  res.json({ reviews: await listReviews(req.supabase) });
}

export async function getReviewableEvents(req, res) {
  res.json({ events: await listReviewableEvents(req.supabase) });
}

export async function postReview(req, res) {
  const eventId = req.params.eventId;
  const { rating, body } = req.body ?? {};
  const result = await submitReview(req.supabase, eventId, Number(rating), body);
  if (result.error) {
    const mapped = SUBMIT_ERRORS[result.error] ?? { status: 400, message: 'Unable to submit review.' };
    res.status(mapped.status).json({ status: result.error, message: mapped.message });
    return;
  }
  res.json({ status: 'ok' });
}
