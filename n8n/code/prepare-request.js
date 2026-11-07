// Public configuration, substituted when workflows are generated.
const convexOrigin = '__CONVEX_SITE_URL__';
function prepareRequest(path, value) {
  if (!convexOrigin.startsWith('https://')) throw new Error('Configure the Convex HTTPS origin.');
  const body = JSON.stringify(value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { url: convexOrigin.replace(/\/$/, '') + path, body, timestamp,
    signingInput: `${timestamp}.POST.${path}.${body}` };
}
