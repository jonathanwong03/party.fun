export function noStoreApi(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.vary('Authorization');
  next();
}
