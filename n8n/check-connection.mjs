import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'

try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))) } catch { /* Environment variables may be provided directly. */ }
const secret = process.env.AUTOMATION_SHARED_SECRET
const origin = process.env.CONVEX_SITE_URL
if (!secret || !origin || new URL(origin).protocol !== 'https:') throw new Error('Configure AUTOMATION_SHARED_SECRET and the HTTPS CONVEX_SITE_URL in private n8n/.env.')
const path = '/automation/complete'
const body = JSON.stringify({ events: [] })
const timestamp = String(Math.floor(Date.now() / 1000))
const headers = {
  'content-type': 'application/json', 'x-lendloop-timestamp': timestamp,
  'x-lendloop-signature': createHmac('sha256', secret).update(`${timestamp}.POST.${path}.${body}`).digest('hex'),
}
const call = async (value, signed) => {
  const response = await fetch(new URL(path, origin), { method: 'POST', body: value,
    headers: signed ? headers : { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) })
  await response.text()
  return response.status
}
// Empty completion batches do not change alarms, requests, loans, or counters.
const [unsigned, signed, tampered] = await Promise.all([call(body, false), call(body, true), call(body + ' ', true)])
console.log(JSON.stringify({ unsigned, signed, tampered }))
if (unsigned !== 401 || signed !== 200 || tampered !== 401) throw new Error('Convex integration checks failed. Check deployment, matching secret, and clock freshness. No secret values were printed.')
console.log('Convex HMAC authentication verified. This does not publish or verify n8n Cloud workflows.')
