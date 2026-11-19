/** The port the website listens on when `PORT` is not set. */
export const DEFAULT_SITE_PORT = 5173

/** The address the site has on this machine when no port is set; what tests use for an origin. */
export const DEFAULT_SITE_ORIGIN = `http://localhost:${DEFAULT_SITE_PORT}`

const MAX_PORT = 65_535

/**
 * The port the website listens on: `PORT`, or the default when it is not set
 * or blank. The dev server and the app's own settings both read it here, so
 * the site's address and the port it is served on cannot disagree.
 */
export function sitePort(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const value = environment.PORT?.trim()
  if (value === undefined || value === '') return DEFAULT_SITE_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`PORT: "${value}" is not a port from 1 to ${MAX_PORT}.`)
  }
  return port
}
