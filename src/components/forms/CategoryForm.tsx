'use client'

import { useState, type FormEvent } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { TEXT_LIMITS, textError } from '../../../shared/textLimits'
import { FieldLabel, fieldClassName, primaryButtonClassName, secondaryButtonClassName } from './FieldLabel'
import { notifyError } from '../../lib/feedback'
import { useMounted } from '../../hooks/useMounted'

export function CategoryForm({ category, onSaved, onCancel }: {
  category?: { id: Id<'categories'>; name: string; isActive: boolean }; onSaved: () => void; onCancel: () => void
}) {
  const create = useMutation(api.categories.create)
  const update = useMutation(api.categories.update)
  const [name, setName] = useState(category?.name ?? '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const mounted = useMounted()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = textError(name, 'Category', TEXT_LIMITS.category)
    if (validation) { setError(validation); toast.error(validation); return }
    setPending(true)
    setError('')
    try {
      if (category) await update({ categoryId: category.id, name, isActive })
      else await create({ name })
      toast.success(category ? 'Category updated.' : 'Category created.')
      if (mounted.current) onSaved()
    } catch (cause) {
      const message = notifyError('category.save', cause, 'Could not save the category. Try again.')
      if (mounted.current) setError(message)
    } finally { if (mounted.current) setPending(false) }
  }

  return <form onSubmit={submit} className="min-w-0 space-y-5">
    <div>
      <FieldLabel label="Category name" value={name} limit={TEXT_LIMITS.category} htmlFor="category-name" />
      <input id="category-name" className={fieldClassName} value={name} onChange={event => setName(event.target.value)} maxLength={TEXT_LIMITS.category}
        required aria-describedby="category-name-count" aria-invalid={name.length > TEXT_LIMITS.category} />
    </div>
    {category && <label className="block text-sm font-medium">Status<select value={String(isActive)} onChange={event => setIsActive(event.target.value === 'true')}
      className={`${fieldClassName} mt-2`}><option value="true">Active</option><option value="false">Inactive</option></select></label>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={onCancel} className={secondaryButtonClassName}>Cancel</button>
      <button disabled={pending} className={primaryButtonClassName}>{pending ? 'Saving…' : 'Save category'}</button></div>
  </form>
}
