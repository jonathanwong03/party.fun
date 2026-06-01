export function createPlaceholderHandler(page, options = {}) {
  return (req, res) => {
    res.json({
      route: req.originalUrl,
      page,
      status: 'not_implemented',
      ...options,
      ...(req.params.eventId ? { eventId: req.params.eventId } : {}),
    });
  };
}
