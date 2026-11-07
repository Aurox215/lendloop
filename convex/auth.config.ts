import type { AuthConfig } from 'convex/server'

const clerkFrontendApiUrl = process.env.CLERK_FRONTEND_API_URL

if (!clerkFrontendApiUrl) {
  throw new Error('Set CLERK_FRONTEND_API_URL in the Convex deployment environment.')
}

export default {
  providers: [
    {
      domain: clerkFrontendApiUrl,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
