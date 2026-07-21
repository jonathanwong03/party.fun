import express from 'express';
import { getReviews, getReviewableEvents, postReview } from '../controllers/reviewController.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// Public: reviews feed the landing-page carousel, which guests can see. optionalAuth attaches
// an anon client when there's no token; get_reviews is SECURITY DEFINER and granted to anon.
router.get('/', optionalAuth, getReviews);                 // the 20 most recent reviews
router.get('/reviewable', requireAuth, getReviewableEvents); // events the caller can still review
router.post('/events/:eventId', requireAuth, postReview);    // submit / edit a review

export default router;
