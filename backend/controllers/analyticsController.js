// Role-aware analytics: global discovery + (organiser) own-events + personal.
// The aggregation runs in the get_analytics() RPC (SECURITY DEFINER) so it can
// read across all organisers' bookings for the global ranking.
export async function getAnalytics(req, res) {
  const { data, error } = await req.supabase.rpc('get_analytics');
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  if (data?.error) return res.status(400).json({ status: 'error', message: data.error });
  res.json(data);
}
