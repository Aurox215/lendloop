const encoder = new TextEncoder()

export async function signature(secret: string, content: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(content))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyRequest(request: Request, body: string, secret: string) {
  const timestamp = request.headers.get('x-lendloop-timestamp') ?? ''
  const supplied = request.headers.get('x-lendloop-signature') ?? ''
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000 || !/^[a-f0-9]{64}$/.test(supplied)) return false
  const content = `${timestamp}.${request.method}.${new URL(request.url).pathname}.${body}`
  const expected = await signature(secret, content)
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i)
  return difference === 0
}
