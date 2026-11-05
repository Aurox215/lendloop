export function FieldLabel({ label, value, limit, htmlFor }: {
  label: string
  value: string
  limit: number
  htmlFor: string
}) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2 text-sm">
      <label htmlFor={htmlFor} className="font-medium">{label}</label>
      <span id={`${htmlFor}-count`} className={value.length > limit ? 'text-red-700' : 'text-stone-500'}>
        {value.length}/{limit}
      </span>
    </div>
  )
}

export const fieldClassName = 'w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-emerald-700'
export const primaryButtonClassName = 'max-w-full rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white whitespace-normal [overflow-wrap:anywhere] hover:bg-emerald-900 disabled:opacity-50'
export const secondaryButtonClassName = 'max-w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 whitespace-normal [overflow-wrap:anywhere] hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50'
