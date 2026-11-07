'use client'

import { useEffect, useRef, type ReactNode } from 'react'

export const PAGE_SIZE = 12

type PaginationStatus = 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'

export function InfiniteList({ children, status, loadMore, count }: {
  children: ReactNode
  status: PaginationStatus
  loadMore: (count: number) => void
  count: number
}) {
  return <>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    <ListStatus status={status} loadMore={loadMore} count={count} />
  </>
}

export function ListStatus({ status, loadMore, count }: { status: PaginationStatus; loadMore: (count: number) => void; count: number }) {
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = sentinel.current
    if (!node || status !== 'CanLoadMore') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        loadMore(PAGE_SIZE)
      }
    }, { rootMargin: '150px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [status, loadMore, count])

  return (
    <>
      {count === 0 && status === 'Exhausted' && <p className="py-8 text-sm text-stone-500">No results.</p>}
      {(status === 'LoadingFirstPage' || status === 'LoadingMore') && <p role="status" className="py-6 text-sm text-stone-500">Loading…</p>}
      <div ref={sentinel} className="h-1" aria-hidden="true" />
    </>
  )
}
