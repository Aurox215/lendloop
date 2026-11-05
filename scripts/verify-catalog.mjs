import assert from 'node:assert/strict'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

// Read-only smoke check against the deployment selected in .env.local.
const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
const query = (name, args = {}) => client.query(makeFunctionReference(name), args)
const categories = await query('catalog:categories')
assert.equal(categories.length, 8, 'Expected the eight seeded categories')
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
assert.ok(allTools.length >= 16, 'Expected the sixteen sample listings')
assert.equal(new Set(allTools.map(tool => tool.id)).size, allTools.length)
const detail = await query('tools:detail', { toolId: allTools[0].id })
assert.equal(detail.name, allTools[0].name)
assert.equal(detail.description, allTools[0].description)
assert.equal(detail.canEdit, false, 'Anonymous visitors cannot edit listings')
for (const tool of allTools) {
  assert.deepEqual(Object.keys(tool).sort(), ['category', 'condition', 'description', 'id', 'name'])
}
for (const category of categories) {
  const filtered = await query('catalog:publicTools', { categoryId: category.id, now, paginationOpts })
  assert.ok(filtered.page.length > 0, `Expected tools in ${category.name}`)
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
assert.ok(descriptionMatches.every(tool => tool.description.toLowerCase().includes('brush')))
const conditionMatches = await searchAll('fair')
assert.ok(conditionMatches.length > 0, 'Expected condition matches')
assert.ok(conditionMatches.every(tool => tool.condition === 'fair'))
await assert.rejects(query('catalog:myListings', { now, paginationOpts }), /Sign in required/)
await assert.rejects(query('workspace:loans', { paginationOpts }), /Sign in required/)
console.log('Catalog verified: categories, twelve-item pagination, name/description/condition search, category filters, owner privacy, and anonymous access denial.')
