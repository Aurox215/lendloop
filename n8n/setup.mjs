import { randomBytes } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const destination = fileURLToPath(new URL('.env', import.meta.url))
try {
  await access(destination)
  console.log('n8n/.env already exists; its configuration was preserved.')
} catch {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))) } catch { /* Fill the URL manually if needed. */ }
  const site = (process.env.NEXT_PUBLIC_CONVEX_URL ?? 'https://YOUR-DEPLOYMENT.convex.cloud').replace(/\.cloud$/, '.site')
  const contents = [
    `N8N_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
    `N8N_RUNNERS_AUTH_TOKEN=${randomBytes(32).toString('hex')}`,
    `AUTOMATION_SHARED_SECRET=${randomBytes(32).toString('hex')}`,
    `CONVEX_SITE_URL=${site}`, '',
  ].join('\n')
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 })
  console.log('Created ignored n8n/.env with random secrets. No secret values were printed.')
}
