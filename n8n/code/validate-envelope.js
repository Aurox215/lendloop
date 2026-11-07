const input = $input.first().json;
const timestamp = String(input.headers?.['x-lendloop-timestamp'] ?? '');
const supplied = String(input.headers?.['x-lendloop-signature'] ?? '');
const payload = input.body?.payload;
if (typeof payload !== 'string' || payload.length > 16384 || !/^\d+$/.test(timestamp) ||
  Math.abs(Date.now() - Number(timestamp) * 1000) > 300000 || !/^[a-f0-9]{64}$/.test(supplied)) throw new Error('Invalid webhook signature.');
return [{ json: { timestamp, supplied, payload, signingInput: `${timestamp}.${payload}` } }];
