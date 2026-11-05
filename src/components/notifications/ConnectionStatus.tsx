'use client'

import { useEffect, useRef, useState } from 'react'
import { useConvexConnectionState } from 'convex/react'
import { WifiOff } from 'lucide-react'
import { toast } from 'sonner'

export function ConnectionStatus() {
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState()
  const [delayed, setDelayed] = useState(false)
  const warned = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDelayed(!isWebSocketConnected)
      if (!isWebSocketConnected && hasEverConnected && !warned.current) {
        warned.current = true
        console.warn(JSON.stringify({ event: 'connection.lost' }))
        toast.error('Connection lost. Reconnecting…', { id: 'database-connection' })
      } else if (isWebSocketConnected && warned.current) {
        warned.current = false
        console.info(JSON.stringify({ event: 'connection.restored' }))
        toast.success('Connection restored.', { id: 'database-connection' })
      }
    }, isWebSocketConnected ? 0 : 5000)
    return () => clearTimeout(timer)
  }, [isWebSocketConnected, hasEverConnected])

  return delayed ? <p role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><WifiOff size={16} className="shrink-0" />{hasEverConnected ? 'Connection lost. Reconnecting…' : 'Connecting to the database…'}</p> : null
}
