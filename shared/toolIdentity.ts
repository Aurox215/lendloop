export const normalizeToolName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
