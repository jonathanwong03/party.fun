import express from 'express';
import { getReviews, getReviewableEvents, postReview } from '../controllers/reviewController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getReviews);                  // the collated reviews wall
router.get('/reviewable', requireAuth, getReviewableEvents); // events the caller can still review
router.post('/events/:eventId', requireAuth, postReview);    // submit / edit a review

export default router;
