import type { FetchMyErpTasksODataResult } from './workplace/fetchMyErpTasksOData'

declare global {
  interface Window {
    /** Dev-only: `await __ORCH_DEV__.fetchMyErpTasksOData()` in renderer console. */
    __ORCH_DEV__?: {
      fetchMyErpTasksOData: (limit?: number) => Promise<FetchMyErpTasksODataResult>
    }
  }
}

export {}
