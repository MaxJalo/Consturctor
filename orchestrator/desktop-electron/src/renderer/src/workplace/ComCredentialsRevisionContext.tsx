import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { getComCredentialsRevision } from '../store/session'

type ComCredentialsRevisionContextValue = {
  revision: number
  bumpComCredentialsRevision: () => void
}

const ComCredentialsRevisionContext = createContext<ComCredentialsRevisionContextValue | null>(
  null
)

export function ComCredentialsRevisionProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [revision, setRevision] = useState(() => getComCredentialsRevision())
  const bumpComCredentialsRevision = useCallback(() => {
    setRevision(getComCredentialsRevision())
  }, [])
  const value = useMemo(
    () => ({ revision, bumpComCredentialsRevision }),
    [revision, bumpComCredentialsRevision]
  )
  return (
    <ComCredentialsRevisionContext.Provider value={value}>
      {children}
    </ComCredentialsRevisionContext.Provider>
  )
}

export function useComCredentialsRevision(): number {
  const ctx = useContext(ComCredentialsRevisionContext)
  if (!ctx) {
    return getComCredentialsRevision()
  }
  return ctx.revision
}

export function useBumpComCredentialsRevision(): () => void {
  const ctx = useContext(ComCredentialsRevisionContext)
  if (!ctx) {
    return () => undefined
  }
  return ctx.bumpComCredentialsRevision
}
