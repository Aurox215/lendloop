import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Id } from '../../../convex/_generated/dataModel'
import { ToolForm } from './ToolForm'

vi.mock('convex/react', () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

test('edit forms keep complete legacy values while declaring the new input limits', () => {
  const name = 'UnbrokenTitle'.repeat(20)
  const description = 'UnbrokenDescription'.repeat(60)
  const category = 'UnbrokenCategory'.repeat(5)
  const html = renderToStaticMarkup(<ToolForm tool={{
    id: 'legacy-tool' as Id<'tools'>,
    categoryId: 'legacy-category' as Id<'categories'>,
    name, description, category, condition: 'good',
  }} />)

  expect(html).toContain(`value="${name}"`)
  expect(html).toContain(description)
  expect(html).toContain(category)
  expect(html).toMatch(/maxlength="80"/i)
  expect(html).toMatch(/maxlength="500"/i)
  expect(html).toContain(`${name.length}/80`)
  expect(html).toContain(`${description.length}/500`)
})
