// Shared passcode check. The site is public, so every API call must carry
// the passcode set in the APP_PASSCODE environment variable.
export function checkPass(req, res) {
  const need = process.env.APP_PASSCODE;
  if (!need) {
    res.status(503).json({ error: 'no_passcode', message: 'APP_PASSCODE is not set on the server.' });
    return false;
  }
  const got = req.headers['x-app-pass'];
  if (typeof got !== 'string' || got !== need) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
