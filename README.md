This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Clerk + Convex authentication

Set these variables in `.env.local` (keep this file untracked):

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
CLERK_SECRET_KEY=<Clerk secret key>
CONVEX_DEPLOYMENT=dev:<your development deployment>
NEXT_PUBLIC_CONVEX_URL=https://<your deployment>.convex.cloud
CLERK_FRONTEND_API_URL=https://<your Clerk instance>.clerk.accounts.dev
```

Enable the Convex integration in the Clerk dashboard. An existing Clerk JWT
template named `convex` with audience `convex` is also supported by the client.
Set `CLERK_FRONTEND_API_URL` in the **Convex deployment's environment variables**
as well: `.env.local` alone does not configure the remote backend. Use the Clerk
instance matching the environment (development or production).

Run `npx convex dev` alongside `npm run dev` to sync backend functions and auth
configuration. `ClerkProvider` wraps `ConvexProviderWithClerk`, which forwards and
refreshes Clerk tokens automatically. `/signin` and `/signup` remain local routes.

For components that call authenticated Convex functions, use `Authenticated` or
`useConvexAuth` from `convex/react` so calls wait for Convex to validate the token.
In backend functions, derive identity from `await ctx.auth.getUserIdentity()`;
reject missing identity and enforce ownership there, never trust a caller's user ID.

See the [Convex + Clerk guide](https://docs.convex.dev/auth/clerk) for dashboard
setup and separate development/production configuration.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
