export type BusinessResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
