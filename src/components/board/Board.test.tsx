import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'
import type { View } from '../../app/WorkspaceContext'
import ToolBoard from '../../app/ToolBoard'
import { Sidebar } from './Sidebar'

const current = vi.hoisted(() => ({ view: 'dashboard' as View, rows: [] as Record<string, unknown>[] }))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }))
vi.mock('convex/react', () => ({
  useQuery: () => [], useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({ results: current.rows, status: 'Exhausted', loadMore: vi.fn() }),
}))
vi.mock('../../app/WorkspaceContext', async importOriginal => ({
  ...await importOriginal<typeof import('../../app/WorkspaceContext')>(),
  useWorkspace: () => ({ view: current.view, ready: true, admin: true }),
}))
beforeEach(() => { current.view = 'dashboard'; current.rows = [] })

test('private listing/request/loan pages have no search input and listing creation is a button', () => {
  for (const view of ['my-listings', 'my-requests', 'incoming-requests', 'all-loans'] as View[]) {
    current.view = view
    const html = renderToStaticMarkup(<ToolBoard />)
    expect(html).not.toContain('type="search"')
    if (view === 'my-listings') {
      expect(html).toContain('New listing')
      expect(html).not.toContain('href="/tools/new"')
    }
  }
})

test('the users table displays roles and disables the current admin’s controls', () => {
  current.view = 'mark-lender'
  current.rows = [
    { id: 'self', name: 'Petro', email: null, role: 'admin', trusted: false, isActive: true, canEdit: false },
    { id: 'other', name: 'Neighbor', email: 'neighbor@example.invalid', role: 'user', trusted: true, isActive: true, canEdit: true },
  ]
  const html = renderToStaticMarkup(<ToolBoard />)
  expect(html).toContain('Trusted lender')
  expect(html).toContain('Petro')
  expect(html).toContain('neighbor@example.invalid')
  const rows = html.split('<tbody>')[1].split('</tbody>')[0].split('</tr>')
  expect(rows[0]).toMatch(/<select[^>]*\sdisabled=/)
  expect(rows[0].match(/<select[^>]*\sdisabled=/g)).toHaveLength(2)
  expect(rows[1]).not.toMatch(/<select[^>]*\sdisabled=/)
  expect(rows[1]).not.toContain('type="checkbox"')
  expect(rows[1]).not.toContain('Save</button>')
})

test('listing edits use a button rather than navigation to an edit page', () => {
  current.view = 'my-listings'
  current.rows = [{ id: 'tool', name: 'Drill', category: 'Tools', description: 'A drill', condition: 'good' }]
  const html = renderToStaticMarkup(<ToolBoard />)
  expect(html).toContain('Edit</button>')
  expect(html).not.toContain('/tools/tool/edit')
})

test('sidebar navigation has icons and categories, but signed-out users see only Dashboard', () => {
  const signedIn = renderToStaticMarkup(<Sidebar signedIn />)
  expect(signedIn).toContain('href="/admin/categories"')
  expect(signedIn).toContain('<svg')
  const signedOut = renderToStaticMarkup(<Sidebar signedIn={false} />)
  expect(signedOut).toContain('Dashboard')
  expect(signedOut).not.toContain('Admin')
  expect(signedOut).not.toContain('My listings')
})
