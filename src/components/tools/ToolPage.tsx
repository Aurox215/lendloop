'use client'

import Link from 'next/link'
import { useQuery } from 'convex/react'
import { useAuth } from '@clerk/nextjs'
import { api } from '../../../convex/_generated/api'
import { useWorkspace } from '../../app/WorkspaceContext'
import { ToolForm } from './ToolForm'

export function ToolPage({ toolId, edit = false }: { toolId?: string; edit?: boolean }) {
  const { ready } = useWorkspace()
  const { isLoaded, isSignedIn } = useAuth()
  const tool = useQuery(api.tools.detail, toolId ? { toolId } : 'skip')

  if ((edit || !toolId) && !ready) {
    return <main className="p-8" role="status">{isLoaded && !isSignedIn ? 'Sign in required.' : 'Loading account…'}</main>
  }

  if (!toolId) {
    return (
      <main className="min-w-0 p-5 sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold">New listing</h1>
        <ToolForm />
      </main>
    )
  }
  if (tool === undefined) return <p role="status" className="p-8">Loading…</p>
  if (tool === null) return <p className="p-8">Tool not found.</p>
  if (edit && !tool.canEdit) return <p role="alert" className="p-8">You can edit only your own listings.</p>

  return (
    <main className="w-full min-w-0 p-5 sm:p-8">
      <Link href={edit ? `/tools/${tool.id}` : '/'} className="mb-6 inline-block text-sm underline">{edit ? 'Tool details' : 'Dashboard'}</Link>
      <h1 className="mb-6 whitespace-pre-wrap text-2xl font-semibold [overflow-wrap:anywhere]">{edit ? 'Edit listing' : tool.name}</h1>
      {edit ? <ToolForm key={tool.id} tool={tool} /> : (
        <div className="min-w-0 space-y-5">
          <p className="whitespace-pre-wrap text-emerald-800 [overflow-wrap:anywhere]">{tool.category}</p>
          <p className="whitespace-pre-wrap leading-7 text-stone-600 [overflow-wrap:anywhere]">{tool.description}</p>
          <p className="text-sm text-stone-600">Condition: {tool.condition.replaceAll('_', ' ')}</p>
          {tool.canEdit && <Link href={`/tools/${tool.id}/edit`} className="inline-block rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-white">Edit listing</Link>}
        </div>
      )}
    </main>
  )
}
