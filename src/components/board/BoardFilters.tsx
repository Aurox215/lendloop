import type { Id } from '../../../convex/_generated/dataModel'

export function BoardFilters({ search, onSearch, categoryId, onCategory, categories, showSearch = true }: {
  search: string
  onSearch: (value: string) => void
  categoryId?: Id<'categories'>
  onCategory: (value?: Id<'categories'>) => void
  categories: { id: Id<'categories'>; name: string }[]
  showSearch?: boolean
}) {
  return (
    <div className={`mb-6 grid w-full min-w-0 gap-3 ${showSearch ? 'sm:grid-cols-[minmax(0,1fr)_13rem]' : 'sm:grid-cols-[13rem]'}`}>
      {showSearch && <label className="min-w-0">
        <span className="sr-only">Search tools</span>
        <input type="search" maxLength={200} value={search} onChange={event => onSearch(event.target.value)} placeholder="Search tools"
          className="h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-4 text-sm focus:outline-2 focus:outline-emerald-700" />
      </label>}
      <label className="min-w-0">
        <span className="sr-only">Category</span>
        <select value={categoryId ?? ''} onChange={event => onCategory((event.target.value || undefined) as Id<'categories'> | undefined)}
          className="h-12 w-full min-w-0 truncate rounded-lg border border-stone-300 bg-white px-4 text-sm">
          <option value="">All categories</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
    </div>
  )
}
