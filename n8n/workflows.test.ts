import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { expect, test, vi } from 'vitest'

const source = (name: string) => readFileSync(new URL(`./code/${name}.js`, import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const secret = 'test-shared-secret'
const prepare = source('prepare-request').replace('__CONVEX_SITE_URL__', 'https://example.convex.site')
const execute = (name: string, input: unknown) => new AsyncFunction('$input', 'console', '$', prepare + '\n' + source(name))(
  { first: () => ({ json: input }) }, { log: vi.fn() }, () => ({ item: { json: { pages: 2 } } }),
)

test('Cloud Code nodes verify credential-produced HMAC and prepare exact write-back bytes', async () => {
  const payload = JSON.stringify({ eventId: 'event', idempotencyKey: 'once', title: 'Requested', message: 'Drill', kind: 'request_notification' })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const input = { body: { payload }, headers: { 'x-lendloop-timestamp': timestamp, 'x-lendloop-signature': createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex') } }
  const envelope = (await execute('validate-envelope', input))[0].json
  const expectedSignature = createHmac('sha256', secret).update(envelope.signingInput).digest('hex')
  const result = await execute('verify-request', { ...envelope, expectedSignature })
  const request = result[0].json
  expect(request.url).toBe('https://example.convex.site/automation/complete')
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(request.signingInput).toBe(`${request.timestamp}.POST./automation/complete.${request.body}`)
  const tampered = (await execute('validate-envelope', { ...input, body: { payload: payload + ' ' } }))[0].json
  await expect(execute('verify-request', { ...tampered, expectedSignature: createHmac('sha256', secret).update(tampered.signingInput).digest('hex') })).rejects.toThrow('Invalid webhook signature')
  await expect(execute('validate-envelope', { ...input, headers: { ...input.headers, 'x-lendloop-timestamp': '1' } })).rejects.toThrow('Invalid webhook signature')
})

test('overdue pagination signs each cursor and preserves an empty continuation page', async () => {
  const fetch = (await execute('fetch-overdue', { cursor: 'next-cursor', pages: 1 }))[0].json
  expect(JSON.parse(fetch.body)).toEqual({ cursor: 'next-cursor' })
  expect(fetch.pages).toBe(2)
  const delivery = (await execute('deliver-overdue', { events: [], cursor: 'another-page', isDone: false }))[0].json
  expect(delivery).toMatchObject({ cursor: 'another-page', isDone: false, pages: 2 })
  expect(JSON.parse(delivery.body)).toEqual({ events: [] })
})

test('workflow exports contain no literal secrets and route failures to the error workflow', () => {
  for (const name of ['requests', 'overdue']) {
    const workflow = JSON.parse(readFileSync(new URL(`./workflows/${name}.json`, import.meta.url), 'utf8'))
    expect(workflow.settings.errorWorkflow).toBe('lendloop-errors')
    expect(workflow.settings.saveDataErrorExecution).toBe('all')
    expect(workflow.nodes.filter((node: { type: string }) => node.type.endsWith('httpRequest')).every((node: { retryOnFail: boolean }) => node.retryOnFail)).toBe(true)
    expect(JSON.stringify(workflow)).not.toContain(secret)
    expect(JSON.stringify(workflow)).not.toContain('$env')
    expect(JSON.stringify(workflow)).not.toContain("require('crypto')")
    const crypto = workflow.nodes.filter((node: { type: string }) => node.type.endsWith('.crypto'))
    expect(crypto).toHaveLength(2)
    for (const node of crypto) {
      expect(node.typeVersion).toBe(2)
      expect(node.parameters).toMatchObject({ action: 'hmac', type: 'SHA256', encoding: 'hex' })
      expect(node.parameters).not.toHaveProperty('secret')
    }
  }
})
