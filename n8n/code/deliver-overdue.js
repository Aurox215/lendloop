const page = $input.first().json;
if (!Array.isArray(page.events) || page.events.length > 25) throw new Error('Invalid overdue page.');
for (const event of page.events) {
  console.log(JSON.stringify({ event: 'reminder.mock', eventId: event.eventId }));
}
return [{ json: {
  ...prepareRequest('/automation/complete', { events: page.events.map(event => ({ eventId: event.eventId, idempotencyKey: event.idempotencyKey })) }),
  cursor: page.cursor, isDone: page.isDone, pages: $('Prepare overdue request').item.json.pages,
} }];
