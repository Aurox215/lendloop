export function isPublicPath(path: string) {
  return path === '/' || path === '/signin' || path.startsWith('/signin/') ||
    path === '/signup' || path.startsWith('/signup/') || path === '/favicon.ico' ||
    path.startsWith('/_next/') || path === '/__clerk' || path.startsWith('/__clerk/')
}
