const input = $input.first().json;
// expectedSignature is produced by Crypto v2 using an encrypted n8n credential.
const expected = input.expectedSignature;
if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) ||
  typeof input.supplied !== 'string' || !/^[a-f0-9]{64}$/.test(input.supplied) ||
  Math.abs(Date.now() - Number(input.timestamp) * 1000) > 300000) throw new Error('Invalid webhook signature.');
let difference = 0;
for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ input.supplied.charCodeAt(i);
if (difference !== 0) throw new Error('Invalid webhook signature.');
const event = JSON.parse(input.payload);
if (!event || typeof event.eventId !== 'string' || typeof event.idempotencyKey !== 'string' ||
  typeof event.title !== 'string' || typeof event.message !== 'string') throw new Error('Invalid notification.');
// Mock delivery: in-app alarms already exist durably. Log metadata, never emails or secrets.
const recipients = event.notifications ?? [{ recipientKey: event.eventId, title: event.title, message: event.message, href: event.href }];
if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 10 || recipients.some(item => typeof item.recipientKey !== 'string' || typeof item.title !== 'string' || typeof item.message !== 'string')) throw new Error('Invalid recipients.');
for (const recipient of recipients) {
  console.log(JSON.stringify({ event: 'notification.mock', eventId: event.eventId, kind: event.kind, recipientKey: recipient.recipientKey, title: recipient.title }));
}
return [{ json: prepareRequest('/automation/complete', { eventId: event.eventId, idempotencyKey: event.idempotencyKey }) }];
