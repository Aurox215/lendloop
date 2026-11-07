import type { ReactNode } from 'react'

type ToolSummary = {
  name: string
  category: string
  description?: string
  condition?: string
}

export function ToolCard({ tool, children }: { tool: ToolSummary; children?: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold">
        <span className="line-clamp-2 text-wrap [overflow-wrap:anywhere]" title={tool.name}>
          {tool.name}
        </span>
      </h2>
      <p className="mt-2 truncate text-sm text-emerald-800" title={tool.category}>{tool.category}</p>
      {tool.description && <p className="mt-4 line-clamp-3 text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]" title={tool.description}>
        {tool.description}
      </p>}
      {tool.condition && <p className="mt-3 text-sm text-stone-600">Condition: {tool.condition.replaceAll('_', ' ')}</p>}
      {children && <div className="mt-auto min-w-0 pt-4">{children}</div>}
    </article>
  )
}
