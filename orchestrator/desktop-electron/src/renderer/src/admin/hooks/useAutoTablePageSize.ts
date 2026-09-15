import { useEffect, useState } from 'react'

interface UseAutoTablePageSizeOptions {
  minRows?: number
  rowHeight?: number
  headerHeight?: number
}

export function useAutoTablePageSize(
  containerRef: React.RefObject<HTMLElement | null>,
  { minRows = 5, rowHeight = 54, headerHeight = 44 }: UseAutoTablePageSizeOptions = {}
): number {
  const [pageSize, setPageSize] = useState(minRows)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    function recalc(): void {
      const height = node?.clientHeight ?? 0
      const next = Math.max(minRows, Math.floor((height - headerHeight) / rowHeight))
      setPageSize(next)
    }

    recalc()
    const observer = new ResizeObserver(recalc)
    observer.observe(node)
    window.addEventListener('resize', recalc)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', recalc)
    }
  }, [containerRef, minRows, rowHeight, headerHeight])

  return pageSize
}
