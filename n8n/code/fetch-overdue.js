const state = $input.first().json;
const pages = (state.pages ?? 0) + 1;
if (pages > 500) throw new Error('Overdue page limit reached; resume manually using the last cursor.');
return [{ json: { ...prepareRequest('/automation/overdue', { cursor: state.cursor ?? null }), pages } }];
