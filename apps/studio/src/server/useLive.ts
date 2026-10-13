import { useStore } from 'zustand'
import { liveStore, type LiveState } from './live'

/** The live store in React. Select single fields (or wrap with useShallow): a new object each time loops. */
export function useLive<T>(selector: (s: LiveState) => T): T {
  return useStore(liveStore, selector)
}
