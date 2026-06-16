import * as React from "react"

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * SSR-safe (defaults to `false` until mounted).
 */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setValue(e.matches)
    setValue(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return value
}
