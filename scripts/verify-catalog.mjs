import assert from 'node:assert/strict'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

// Read-only smoke check against the deployment selected in .env.local.
const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
const query = (name, args = {}) => client.query(makeFunctionReference(name), args)
const categories = await query('catalog:categories')
assert.ok(categories.length > 0, 'Expected active categories')
const paginationOpts = { numItems: 12, cursor: null }
const now = Date.now()
const tools = await query('catalog:publicTools', { now, paginationOpts })
assert.ok(tools.page.length <= 12, 'Expected at most twelve tools per page')
const allTools = [...tools.page]
let next = tools
while (!next.isDone) {
  next = await query('catalog:publicTools', { now, paginationOpts: { ...paginationOpts, cursor: next.continueCursor } })
  allTools.push(...next.page)
}
assert.ok(allTools.length > 0, 'Expected available listings')
assert.equal(new Set(allTools.map(tool => tool.id)).size, allTools.length)
await assert.rejects(query('tools:detail', { toolId: allTools[0].id, now }), /Sign in required/)
await assert.rejects(query('catalog:memberTools', { now, paginationOpts }), /Sign in required/)
for (const tool of allTools) {
  assert.deepEqual(Object.keys(tool).sort(), ['category', 'id', 'name'])
}
for (const category of categories) {
  const filtered = await query('catalog:publicTools', { categoryId: category.id, now, paginationOpts })
  assert.ok(filtered.page.every(tool => tool.category === category.name))
}
const searched = await query('catalog:publicTools', { search: 'drill', now, paginationOpts })
assert.ok(searched.page.length > 0)
assert.ok(searched.page.every(tool => tool.name.toLowerCase().includes('drill')))
async function searchAll(search) {
  const rows = []
  let cursor = null
  for (;;) {
    const result = await query('catalog:publicTools', { search, now, paginationOpts: { ...paginationOpts, cursor } })
    rows.push(...result.page)
    if (result.isDone) return rows
    cursor = result.continueCursor
  }
}
const descriptionMatches = await searchAll('brush')
assert.ok(descriptionMatches.length > 0, 'Expected description matches')
const conditionMatches = await searchAll('fair')
assert.ok(conditionMatches.length > 0, 'Expected condition matches')
await assert.rejects(query('catalog:myListings', { now, paginationOpts }), /Sign in required/)
await assert.rejects(query('workspace:loans', { paginationOpts }), /Sign in required/)
console.log('Catalog verified: categories, twelve-item pagination, name/description/condition search, category filters, owner privacy, and anonymous access denial.')
