import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const folder = fileURLToPath(new URL('.', import.meta.url))
try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))) } catch { /* Public origin can be supplied through --site-url. */ }
const option = process.argv.indexOf('--site-url')
const origin = option >= 0 ? process.argv[option + 1] : process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.cloud$/, '.site') ?? 'https://YOUR-DEPLOYMENT.convex.site'
if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Provide a valid HTTPS Convex site origin.')
const source = name => readFile(`${folder}code/${name}.js`, 'utf8')
const preparation = (await source('prepare-request')).replace("'__CONVEX_SITE_URL__'", JSON.stringify(new URL(origin).origin))
const code = async name => `${preparation}\n${await source(name)}`
const node = (name, type, parameters, position, extra = {}) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: `n8n-nodes-base.${type}`, typeVersion: type === 'code' ? 2 : 1, parameters, position, ...extra })
const codeNode = (name, jsCode, x) => node(name, 'code', { jsCode }, [x, 0])
const hmac = (name, x, property = 'signature') => node(name, 'crypto', {
  action: 'hmac', type: 'SHA256', binaryData: false, value: '={{$json.signingInput}}', dataPropertyName: property, encoding: 'hex',
}, [x, 0], { typeVersion: 2, notes: 'Select the LendLoop HMAC credential. Never enter the secret in node parameters.' })
const http = (name, x) => node(name, 'httpRequest', {
  method: 'POST', url: '={{$json.url}}', sendHeaders: true,
  headerParameters: { parameters: [
    { name: 'x-lendloop-timestamp', value: '={{$json.timestamp}}' },
    { name: 'x-lendloop-signature', value: '={{$json.signature}}' },
  ] },
  sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{$json.body}}',
  options: { timeout: 20000 },
}, [x, 0], { typeVersion: 4.2, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 })
const connect = (...names) => Object.fromEntries(names.slice(0, -1).map((name, i) => [name, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]))
const settings = { executionOrder: 'v1', errorWorkflow: 'lendloop-errors', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none', executionTimeout: 300, timezone: 'UTC' }

const request = {
  id: 'lendloop-requests', name: 'LendLoop · Request notifications', active: false,
  nodes: [
    node('Borrow webhook', 'webhook', { httpMethod: 'POST', path: 'lendloop-requests', responseMode: 'responseNode', options: {} }, [0, 0], { typeVersion: 2, webhookId: 'lendloop-requests' }),
    codeNode('Validate envelope', await source('validate-envelope'), 200), hmac('Verify webhook HMAC', 400, 'expectedSignature'),
    codeNode('Verify and notify', await code('verify-request'), 600), hmac('Sign completion', 800), http('Record delivery', 1000),
    node('Acknowledge', 'respondToWebhook', { respondWith: 'json', responseBody: '{"delivered":true}', options: {} }, [1200, 0], { typeVersion: 1.4 }),
  ], connections: connect('Borrow webhook', 'Validate envelope', 'Verify webhook HMAC', 'Verify and notify', 'Sign completion', 'Record delivery', 'Acknowledge'), settings,
}
const overdue = {
  id: 'lendloop-overdue', name: 'LendLoop · Daily overdue reminders', active: false,
  nodes: [
    node('Daily at 08 UTC', 'scheduleTrigger', { rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] } }, [0, 0], { typeVersion: 1.2 }),
    codeNode('Start page', 'return [{json:{cursor:null,pages:0}}];', 200),
    codeNode('Prepare overdue request', await code('fetch-overdue'), 400), hmac('Sign overdue request', 600), http('Fetch overdue', 800),
    codeNode('Prepare reminders', await code('deliver-overdue'), 1000), hmac('Sign reminders', 1200), http('Record reminders', 1400),
    codeNode('Next page', "const page = $('Prepare reminders').item.json; return [{json:{cursor:page.cursor,isDone:page.isDone,pages:page.pages}}];", 1600),
    node('Finished', 'if', { conditions: { options: { typeValidation: 'strict' }, conditions: [{ leftValue: '={{$json.isDone}}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }, [1800, 0], { typeVersion: 2.2 }),
  ], connections: {
    ...connect('Daily at 08 UTC', 'Start page', 'Prepare overdue request', 'Sign overdue request', 'Fetch overdue', 'Prepare reminders', 'Sign reminders', 'Record reminders', 'Next page', 'Finished'),
    Finished: { main: [[], [{ node: 'Prepare overdue request', type: 'main', index: 0 }]] },
  }, settings,
}
const errors = {
  id: 'lendloop-errors', name: 'LendLoop · Automation errors', active: false,
  nodes: [node('Execution failed', 'errorTrigger', {}, [0, 0]), codeNode('Log failure', "const data=$input.first().json; console.error(JSON.stringify({event:'workflow.failed',workflowId:data.workflow?.id,executionId:data.execution?.id})); return [{json:{failed:true}}];", 240)],
  connections: connect('Execution failed', 'Log failure'), settings: { saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
}
await mkdir(`${folder}workflows`, { recursive: true })
for (const [name, workflow] of Object.entries({ requests: request, overdue, errors })) await writeFile(`${folder}workflows/${name}.json`, JSON.stringify(workflow, null, 2) + '\n')
console.log('Built three n8n workflows without embedded secrets.')
