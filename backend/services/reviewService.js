// Per-event reviews: submit (RLS-guarded RPC), list all (the wall), and list the
// events the caller can still review. All go through SECURITY DEFINER RPCs.

export async function submitReview(sb, eventId, rating, body) {
  const { data, error } = await sb.rpc('submit_review', {
    p_event_id: eventId,
    p_rating: rating,
    p_body: body ?? null,
  });
  if (error) throw new Error(error.message);
  if (data?.error) return { error: data.error };
  return { status: 'ok' };
}

export async function listReviews(sb) {
  const { data, error } = await sb.rpc('get_reviews');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listReviewableEvents(sb) {
  const { data, error } = await sb.rpc('get_my_reviewable_events');
  if (error) throw new Error(error.message);
  return data ?? [];
}
