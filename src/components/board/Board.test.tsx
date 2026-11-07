import DashboardPage from '../../app/page'
import MyListingsPage from '../../app/my-listings/page'
import MyRequestsPage from '../../app/my-requests/page'
import IncomingRequestsPage from '../../app/incoming-requests/page'
import CategoriesPage from '../../app/admin/categories/page'
import RemoveToolsPage from '../../app/admin/remove-tools/page'
import AllLoansPage from '../../app/admin/loans/page'
import LendersPage from '../../app/admin/lenders/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'
import { WorkspaceContext, viewNames, type View } from '../../app/WorkspaceContext'
import ToolBoard from '../../app/ToolBoard'
import { Sidebar } from './Sidebar'

const current = vi.hoisted(() => ({ view: 'dashboard' as View, rows: [] as Record<string, unknown>[] }))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }))
vi.mock('convex/react', () => ({
  useQuery: () => [], useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({ results: current.rows, status: 'Exhausted', loadMore: vi.fn() }),
}))
beforeEach(() => { current.view = 'dashboard'; current.rows = [] })

function renderBoard(view = current.view) {
  return renderToStaticMarkup(<WorkspaceContext value={{ view: 'dashboard', ready: true, admin: true }}><ToolBoard view={view} /></WorkspaceContext>)
}


test('private listing/request/loan pages have no search input and listing creation is a button', () => {
  for (const view of ['my-listings', 'my-requests', 'incoming-requests', 'all-loans'] as View[]) {
    current.view = view
    const html = renderBoard()
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
  const html = renderBoard()
  expect(html).toContain('Trusted lender')
  expect(html).toContain('Petro')
  expect(html).toContain('neighbor@example.invalid')
  const rows = html.split('<tbody>')[1].split('</tbody>')[0].split('</tr>')
  expect(rows[0]).toMatch(/<select[^>]*\sdisabled=/)
  expect(rows[0].match(/<select[^>]*\sdisabled=/g)).toHaveLength(3)
  expect(rows[1]).not.toMatch(/<select[^>]*\sdisabled=/)
  expect(rows[1]).not.toContain('type="checkbox"')
  expect(rows[1]).not.toContain('Save</button>')
})

test('listing edits use a button rather than navigation to an edit page', () => {
  current.view = 'my-listings'
  current.rows = [{ id: 'tool', name: 'Drill', category: 'Tools', description: 'A drill', condition: 'good' }]
  const html = renderBoard()
  expect(html).toContain('Edit</button>')
  expect(html).not.toContain('/tools/tool/edit')
})

test('sidebar navigation has icons and categories, but signed-out users see only Dashboard', () => {
  const signedIn = renderToStaticMarkup(<WorkspaceContext value={{ view: current.view, ready: true, admin: true }}><Sidebar signedIn /></WorkspaceContext>)
  expect(signedIn).toContain('href="/admin/categories"')
  expect(signedIn).toContain('<svg')
  const signedOut = renderToStaticMarkup(<WorkspaceContext value={{ view: current.view, ready: false, admin: false }}><Sidebar signedIn={false} /></WorkspaceContext>)
  expect(signedOut).toContain('Dashboard')
  expect(signedOut).not.toContain('Admin')
  expect(signedOut).not.toContain('My listings')
})

test('owners have no Borrow button on their tools', () => {
  current.rows = [{ id: 'own-tool', name: 'Drill', category: 'Tools', description: 'A drill', condition: 'good', isOwner: true }]
  expect(renderBoard()).not.toContain('>Borrow</button>')
  current.rows[0].isOwner = false
  expect(renderBoard()).toContain('>Borrow</button>')
})

test('pending and borrowed tools show status instead of a Borrow button', () => {
  for (const [availability, label] of [['pending', 'Pending approval'], ['borrowed', 'Borrowed'], ['overdue', 'Overdue']]) {
    current.rows = [{ id: 'tool', name: 'Drill', category: 'Tools', isOwner: false, canBorrow: false, availability }]
    const html = renderBoard()
    expect(html).toContain('>' + label + '</span>')
    expect(html).not.toContain('>Borrow</button>')
  }
})

test('tool titles are plain text rather than links to a detail page', () => {
  current.rows = [{ id: 'tool', name: 'Drill', category: 'Tools', availability: 'borrowed' }]
  const html = renderBoard()
  expect(html).toContain('>Drill</span>')
  expect(html).not.toContain('href="/tools/tool"')
  expect(html).not.toContain('Reserved')
})

test('incoming request cards show the borrower name without adding it to My requests', () => {
  const borrowerName = 'NeighborhoodBorrower'.repeat(10)
  current.rows = [{ id: 'request', toolId: 'tool', name: 'Drill', category: 'Tools', borrowerName,
    status: 'pending', startAt: 0, endAt: 86400000, loanId: null, loanStatus: null, dueAt: null, activity: null }]
  const incoming = renderBoard('incoming-requests')
  expect(incoming).toContain(`Borrower: ${borrowerName}`)
  expect(incoming).toContain('[overflow-wrap:anywhere]')
  expect(renderBoard('my-requests')).not.toContain('Borrower:')
})


test('each route selects its own content even when the shared layout still has the previous view', () => {
  const pages = { dashboard: DashboardPage, 'my-listings': MyListingsPage, 'my-requests': MyRequestsPage, 'incoming-requests': IncomingRequestsPage, categories: CategoriesPage, 'remove-tools': RemoveToolsPage, 'all-loans': AllLoansPage, 'mark-lender': LendersPage }
  for (const view of Object.keys(pages) as View[]) {
    const Page = pages[view]
    const html = renderToStaticMarkup(<WorkspaceContext value={{ view: 'dashboard', ready: true, admin: true }}><Page /></WorkspaceContext>)
    expect(html).toContain('>' + viewNames[view] + '</h1>')
  }
})
