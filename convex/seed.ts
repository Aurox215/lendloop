import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import { validatedText } from './textValidation'
import { TEXT_LIMITS } from '../shared/textLimits'

// Fixture keys associate sample tools; only the category name is stored.
const categories = {
  'power-tools': 'Power Tools', painting: 'Painting', automotive: 'Automotive',
  kitchen: 'Kitchen', gardening: 'Gardening', 'hand-tools': 'Hand Tools',
  camping: 'Camping', cleaning: 'Cleaning',
} as const

type SampleTool = {
  category: keyof typeof categories
  name: string
  condition: Doc<'tools'>['condition']
  description: string
}

const tools: SampleTool[] = [
  { category: 'power-tools', name: '18V cordless drill kit', condition: 'good', description: 'Drill with two batteries, charger, and a set of wood and masonry bits. Please return both batteries charged.' },
  { category: 'power-tools', name: 'Random orbital sander', condition: 'like_new', description: '125 mm sander with dust bag. Bring sanding discs suited to your project.' },
  { category: 'painting', name: 'Paint roller and tray set', condition: 'good', description: 'Two roller frames, extension pole, and reusable trays. Supply your own sleeves and wash the trays before returning.' },
  { category: 'painting', name: 'Wallpaper steamer', condition: 'good', description: 'Steam plate with a long hose for stripping wallpaper. Allow it to cool and drain the tank before returning.' },
  { category: 'automotive', name: 'Digital tire inflator', condition: 'like_new', description: '12V inflator with pressure gauge and adapters. Plugs into a vehicle accessory socket.' },
  { category: 'automotive', name: 'Socket wrench set', condition: 'good', description: 'Metric sockets from 8 to 22 mm with ratchet and extension bar in a carry case. Please check every socket is back in its slot.' },
  { category: 'kitchen', name: 'Stand mixer', condition: 'good', description: 'Five-liter mixer with bowl, whisk, dough hook, and flat beater. Wash and dry the attachments after use.' },
  { category: 'kitchen', name: 'Pasta maker', condition: 'like_new', description: 'Manual pasta roller with spaghetti and fettuccine cutters and a countertop clamp. Brush clean; do not immerse in water.' },
  { category: 'gardening', name: 'Garden fork and spade', condition: 'fair', description: 'Full-size steel fork and spade with worn but sturdy handles. Please brush off soil before returning.' },
  { category: 'gardening', name: 'Telescopic pruning loppers', condition: 'good', description: 'Extendable handles for trimming small branches up to 30 mm thick. Wipe the blades clean after use.' },
  { category: 'hand-tools', name: 'Household repair toolkit', condition: 'good', description: 'Hammer, screwdrivers, pliers, adjustable wrench, and tape measure in a small toolbox. Ideal for furniture assembly.' },
  { category: 'hand-tools', name: 'Claw hammer', condition: 'new', description: 'Unused 16 oz claw hammer with a rubber grip for light carpentry and household repairs.' },
  { category: 'camping', name: 'Four-person camping tent', condition: 'good', description: 'Tent with rainfly, groundsheet, poles, and pegs. Please dry it completely before packing it away.' },
  { category: 'camping', name: 'Two-burner camping stove', condition: 'good', description: 'Compact outdoor stove with wind guards and carry case. Fuel is not included; use outdoors only.' },
  { category: 'cleaning', name: 'Carpet spot cleaner', condition: 'like_new', description: 'Portable upholstery and carpet cleaner with hose attachment. Use compatible solution and rinse both tanks after use.' },
  { category: 'cleaning', name: 'Electric pressure washer', condition: 'good', description: 'Pressure washer with patio attachment and an eight-meter hose. Requires an outdoor tap and electrical outlet.' },
]

// Operator-only: never expose role initialization or demo data creation to clients.
export const run = internalMutation({
  args: { includeDemoTools: v.optional(v.boolean()) },
  returns: v.object({
    rolesCreated: v.number(),
    categoriesCreated: v.number(),
    usersCreated: v.number(),
    toolsCreated: v.number(),
  }),
  handler: async (ctx, { includeDemoTools = true }) => {
    const now = Date.now()
    const result = { rolesCreated: 0, categoriesCreated: 0, usersCreated: 0, toolsCreated: 0 }
    let userRoleId: Id<'roles'> | undefined

    for (const name of ['user', 'admin'] as const) {
      const existing = await ctx.db.query('roles')
        .withIndex('by_name', q => q.eq('name', name)).unique()
      const id = existing?._id ?? await ctx.db.insert('roles', {
        name,
        description: name === 'admin'
          ? 'Manage all listings, view all loans, and designate trusted lenders.'
          : 'Manage own listings and participate in borrowing and lending.',
        updatedAt: now,
      })
      if (!existing) result.rolesCreated++
      if (name === 'user') userRoleId = id
    }

    const categoryIds = new Map<string, Id<'categories'>>()
    for (const [sortOrder, [seedKey, name]] of Object.entries(categories).entries()) {
      validatedText(name, 'Category', TEXT_LIMITS.category)
      const existing = await ctx.db.query('categories')
        .withIndex('by_name', q => q.eq('name', name)).unique()
      const id = existing?._id ?? await ctx.db.insert('categories', {
        name, sortOrder, isActive: true, updatedAt: now,
      })
      if (!existing) result.categoriesCreated++
      categoryIds.set(seedKey, id)
    }

    if (!includeDemoTools) return result
    if (!userRoleId) throw new Error('The user role was not initialized.')

    // Reserved fictional identity; this is not a Clerk account or a login credential.
    const tokenIdentifier = 'https://seed.lendloop.invalid|demo-lender'
    const existingOwner = await ctx.db.query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier)).unique()
    const ownerId = existingOwner?._id ?? await ctx.db.insert('users', {
      tokenIdentifier,
      clerkId: 'lendloop_seed_demo_lender',
      name: 'LendLoop Demo Neighbor',
      email: 'test@gmail.com',
      roleId: userRoleId,
      isTrustedLender: false,
      isActive: true,
      updatedAt: now,
    })
    if (!existingOwner) result.usersCreated++
    else if (existingOwner.email !== 'test@gmail.com') {
      await ctx.db.patch('users', ownerId, { email: 'test@gmail.com', updatedAt: now })
    }

    const existingNames = new Set<string>()
    for await (const tool of ctx.db.query('tools')
      .withIndex('by_ownerId_and_status', q => q.eq('ownerId', ownerId))) {
      existingNames.add(tool.name)
    }

    for (const { category, ...tool } of tools) {
      validatedText(tool.name, 'Title', TEXT_LIMITS.title)
      validatedText(tool.description, 'Description', TEXT_LIMITS.description)
      if (existingNames.has(tool.name)) continue
      const categoryId = categoryIds.get(category)
      if (!categoryId) throw new Error(`Missing category: ${category}`)
      const categoryDoc = await ctx.db.get('categories', categoryId)
      if (!categoryDoc?.isActive) continue
      if (existingOwner && !existingOwner.isActive) continue
      await ctx.db.insert('tools', {
        ...tool, ownerId, categoryId, status: 'active', updatedAt: now,
      })
      result.toolsCreated++
    }
    return result
  },
})
