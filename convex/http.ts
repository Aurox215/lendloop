import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { verifyRequest } from './integrationAuth'

const http = httpRouter()

const integration = httpAction(async (ctx, request) => {
  const secret = process.env.AUTOMATION_SHARED_SECRET
  if (!secret) return new Response('Integration unavailable.', { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) return new Response('Payload too large.', { status: 413 })
  const body = await request.text()
  if (body.length > 16_384) return new Response('Payload too large.', { status: 413 })
  if (!await verifyRequest(request, body, secret)) return new Response('Unauthorized.', { status: 401 })
  let data: unknown
  try { data = JSON.parse(body) } catch { return new Response('Invalid JSON.', { status: 400 }) }
  if (!data || typeof data !== 'object') return new Response('Invalid payload.', { status: 400 })
  try {
    if (new URL(request.url).pathname === '/automation/overdue') {
      const cursor = 'cursor' in data ? data.cursor : null
      if (cursor !== null && typeof cursor !== 'string') return new Response('Invalid cursor.', { status: 400 })
      return Response.json(await ctx.runMutation(internal.automation.overdue, { cursor }))
    }
    const items: unknown[] = 'events' in data && Array.isArray(data.events) ? data.events : [data]
    if (items.length > 25) return new Response('Too many events.', { status: 400 })
    for (const item of items) {
      if (!item || typeof item !== 'object' || !('eventId' in item) || typeof item.eventId !== 'string' || !('idempotencyKey' in item) || typeof item.idempotencyKey !== 'string') return new Response('Invalid event.', { status: 400 })
      const normalized = await ctx.runQuery(internal.automation.normalizeEvent, { eventId: item.eventId })
      if (!normalized) return new Response('Invalid event.', { status: 400 })
      await ctx.runMutation(internal.automation.complete, { eventId: normalized, idempotencyKey: item.idempotencyKey })
    }
    return Response.json({ delivered: true })
  } catch {
    console.error(JSON.stringify({ event: 'automation.writeback_failed', path: new URL(request.url).pathname }))
    return new Response('Automation write-back failed.', { status: 500 })
  }
})

http.route({ path: '/automation/complete', method: 'POST', handler: integration })
http.route({ path: '/automation/overdue', method: 'POST', handler: integration })
export default http
