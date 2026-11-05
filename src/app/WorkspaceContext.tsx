'use client'

import { createContext, useContext } from 'react'

export type View = 'dashboard' | 'my-listings' | 'my-requests' | 'incoming-requests' | 'remove-tools' | 'all-loans' | 'mark-lender' | 'categories'
export const viewNames: Record<View, string> = {
  dashboard: 'Dashboard', 'my-listings': 'My listings', 'my-requests': 'My requests',
  'incoming-requests': 'Incoming requests', 'remove-tools': 'Remove Tools',
  'all-loans': 'View all loans', 'mark-lender': 'Mark a lender',
  categories: 'Categories',
}
export const WorkspaceContext = createContext<{ view: View; ready: boolean; admin: boolean }>({ view: 'dashboard', ready: false, admin: false })
export const viewPaths: Record<View, string> = {
  dashboard: '/', 'my-listings': '/my-listings', 'my-requests': '/my-requests',
  'incoming-requests': '/incoming-requests', 'remove-tools': '/admin/remove-tools',
  'all-loans': '/admin/loans', 'mark-lender': '/admin/lenders',
  categories: '/admin/categories',
}
export const useWorkspace = () => useContext(WorkspaceContext)
