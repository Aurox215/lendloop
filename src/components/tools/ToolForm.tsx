'use client'

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { TEXT_LIMITS, textError } from '../../../shared/textLimits'
import { FieldLabel, fieldClassName, primaryButtonClassName, secondaryButtonClassName } from '../forms/FieldLabel'
import { notifyError } from '../../lib/feedback'
import { useMounted } from '../../hooks/useMounted'

type EditableTool = Pick<Doc<'tools'>, 'name' | 'description' | 'condition' | 'categoryId'> & {
  id: Id<'tools'>
  category: string
}

export function ToolForm({ tool, onSaved, onCancel }: { tool?: EditableTool; onSaved?: () => void; onCancel?: () => void }) {
  const categories = useQuery(api.catalog.categories)
  const create = useMutation(api.tools.create)
  const update = useMutation(api.tools.update)
  const router = useRouter()
  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [condition, setCondition] = useState<Doc<'tools'>['condition']>(tool?.condition ?? 'good')
  const [categoryId, setCategoryId] = useState(tool?.categoryId ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const mounted = useMounted()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = textError(name, 'Title', TEXT_LIMITS.title)
      ?? textError(description, 'Description', TEXT_LIMITS.description)
    if (validationError || !categoryId) {
      const message = validationError ?? 'Choose a category.'
      setError(message)
      toast.error(message)
      return
    }
    setPending(true)
    setError('')
    try {
      const fields = { name, description, condition, categoryId: categoryId as Id<'categories'> }
      let id: Id<'tools'>
      if (tool) {
        await update({ ...fields, toolId: tool.id })
        id = tool.id
      } else {
        id = await create(fields)
      }
      toast.success(tool ? 'Listing updated.' : 'Listing created.')
      if (mounted.current) {
        if (onSaved) onSaved()
        else router.push(`/tools/${id}`)
      }
    } catch (cause) {
      const message = notifyError(tool ? 'tool.update' : 'tool.create', cause, 'Could not save the listing. Try again.')
      if (mounted.current) setError(message)
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full min-w-0 max-w-2xl space-y-5">
      <div>
        <FieldLabel label="Title" value={name} limit={TEXT_LIMITS.title} htmlFor="tool-title" />
        <input id="tool-title" value={name} onChange={event => setName(event.target.value)} maxLength={TEXT_LIMITS.title}
          aria-describedby="tool-title-count" aria-invalid={name.length > TEXT_LIMITS.title} required className={fieldClassName} />
      </div>
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Category
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)} required className={`${fieldClassName} mt-2 truncate`}>
            <option value="">Choose a category</option>
            {tool && categories && !categories.some(category => category.id === tool.categoryId) && <option value={tool.categoryId}>{tool.category}</option>}
            {categories?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">Condition
          <select value={condition} onChange={event => setCondition(event.target.value as Doc<'tools'>['condition'])} className={`${fieldClassName} mt-2`}>
            <option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option>
          </select>
        </label>
      </div>
      <div>
        <FieldLabel label="Description" value={description} limit={TEXT_LIMITS.description} htmlFor="tool-description" />
        <textarea id="tool-description" rows={7} value={description} onChange={event => setDescription(event.target.value)} maxLength={TEXT_LIMITS.description}
          aria-describedby="tool-description-count" aria-invalid={description.length > TEXT_LIMITS.description} required className={`${fieldClassName} resize-y [overflow-wrap:anywhere]`} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700 [overflow-wrap:anywhere]">{error}</p>}
      <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
        {onCancel ? <button type="button" onClick={onCancel} className={secondaryButtonClassName}>Cancel</button> : <Link href={tool ? `/tools/${tool.id}` : '/my-listings'} className={`${secondaryButtonClassName} text-center`}>Cancel</Link>}
        <button type="submit" disabled={pending || !categories} className={primaryButtonClassName}>{pending ? 'Saving…' : 'Save listing'}</button>
      </div>
    </form>
  )
}
