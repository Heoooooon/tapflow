import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Where a client's token comes from, and how a rotated one reaches a process that is already running (T1).
 *
 * The token used to be read once, from `TAPFLOW_TOKEN`, so replacing it meant re-registering the MCP server. Now a
 * client resolves it **explicit first** (`--token`, then a non-empty `TAPFLOW_TOKEN`) **and then a credentials
 * file**, and a request the relay refuses with 401 re-reads the file and is retried once — rotating a token is then
 * "write the file".
 *
 * - **The file is the user's, on the machine that runs the client** — `$XDG_CONFIG_HOME/tapflow/credentials.json`,
 *   else `~/.config/tapflow/credentials.json`, or `TAPFLOW_TOKEN_FILE`. Never the relay's `tapflow.config.json` or
 *   `<dataDir>/.env`: those belong to the relay host, and the person running a coding agent often has no relay.
 * - **Keyed by relay origin**, so a token minted on one relay is never sent to another. Loopback hosts on the same
 *   port share a key: `localhost`, `127.0.0.1` and `[::1]` reach the same listener.
 * - **An explicit token is never replaced by the file.** It is what the person asked for; a refusal says so and
 *   points at the file instead.
 * - **Opt-in.** Reading the file is `resolveToken`, never a side effect of constructing a client — a third party
 *   using `RelayClient` with its own token must not have a file's token sent on its behalf.
 */

export type TokenOrigin = 'flag' | 'env' | 'file' | 'none'

export interface TokenSource {
  /** The token to send now; empty when there is none. */
  readonly token: string
  /** The relay origin it is keyed by, for messages. */
  readonly origin: string
  readonly from: TokenOrigin
  /** The credentials file this source reads (whether or not it exists). */
  readonly path: string
  /** Re-reads the file. Does nothing for an explicit token. */
  refresh(): void
}

interface CredentialsFile {
  version: 1
  relays: Record<string, { token: string }>
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The key a relay URL is stored under: its HTTP origin, with loopback hosts folded into one. */
export function originOf(relayUrl: string): string {
  const u = new URL(relayUrl)
  const protocol = u.protocol === 'wss:' || u.protocol === 'https:' ? 'https:' : 'http:'
  const host = LOOPBACK.has(u.hostname) ? 'localhost' : u.hostname
  const port = u.port && !((protocol === 'http:' && u.port === '80') || (protocol === 'https:' && u.port === '443')) ? `:${u.port}` : ''
  return `${protocol}//${host}${port}`
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['TAPFLOW_TOKEN_FILE']) return env['TAPFLOW_TOKEN_FILE']
  const base = env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
  return path.join(base, 'tapflow', 'credentials.json')
}

/** What the file says about one origin: its token, and the origins it has, for a message when this one misses. */
export function readCredential(file: string, origin: string, warn?: (line: string) => void): { token: string; origins: string[] } {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { token: '', origins: [] }
  }
  try {
    const mode = fs.statSync(file).mode
    // Not refused: refusing would break a working setup on upgrade. Said, because the file holds a credential.
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) warn?.(`${file} is readable by other users; run: chmod 600 ${file}`)
  } catch { /* the read above is what matters */ }
  let parsed: Partial<CredentialsFile>
  try {
    parsed = JSON.parse(raw) as Partial<CredentialsFile>
  } catch {
    warn?.(`${file} is not valid JSON; no token read from it`)
    return { token: '', origins: [] }
  }
  const relays = parsed.relays && typeof parsed.relays === 'object' ? parsed.relays : {}
  const keys = Object.keys(relays)
  // Keys are compared as origins, so a file written by hand with `ws://127.0.0.1:4000/` still matches.
  const hit = keys.find((k) => {
    try { return originOf(k) === origin } catch { return false }
  })
  const token = hit ? relays[hit]?.token : undefined
  return { token: typeof token === 'string' ? token.trim() : '', origins: keys }
}

/**
 * Resolves a client's token: `explicit` (a flag), then a non-empty `TAPFLOW_TOKEN`, then the credentials file.
 * `warn` hears about a file that is unreadable by JSON or by others' permissions, once per read.
 */
export function resolveToken(opts: { relayUrl: string; explicit?: string; env?: NodeJS.ProcessEnv; warn?: (line: string) => void }): TokenSource {
  const env = opts.env ?? process.env
  const origin = originOf(opts.relayUrl)
  const file = credentialsPath(env)
  const explicit = opts.explicit?.trim()
  if (explicit) return fixed(explicit, origin, 'flag', file)
  // Empty is unset: `TAPFLOW_TOKEN=` in an MCP registration must not hide the file.
  const envToken = env['TAPFLOW_TOKEN']?.trim()
  if (envToken) return fixed(envToken, origin, 'env', file)
  let token = readCredential(file, origin, opts.warn).token
  return {
    get token() { return token },
    origin,
    get from() { return token ? 'file' : 'none' },
    path: file,
    refresh() { token = readCredential(file, origin, opts.warn).token },
  }
}

/** A token given as a string, by a caller that resolves its own. Never re-read. */
export function fixedToken(token: string, relayUrl: string): TokenSource {
  return fixed(token, originOf(relayUrl), token ? 'flag' : 'none', credentialsPath())
}

function fixed(token: string, origin: string, from: TokenOrigin, file: string): TokenSource {
  return { token, origin, from, path: file, refresh() {} }
}

/** The bearer header for a source, or none when it has no token. */
export function authHeader(source: TokenSource): Record<string, string> {
  return source.token ? { Authorization: `Bearer ${source.token}` } : {}
}

/**
 * A fetch that carries the source's token and, on a 401, re-reads it and retries once **if the token changed since
 * this request was sent** — compared with the token the request carried, not with the last read, so requests in
 * flight together on an old token all retry. Every 401 from the relay comes from its auth middleware, before any
 * handler runs, so a retried POST has had no effect.
 */
export async function fetchWithToken(
  source: TokenSource,
  url: string,
  init: RequestInit & { headers?: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const used = source.token
  const res = await fetchImpl(url, { ...init, headers: { ...init.headers, ...authHeader(source) } })
  if (res.status !== 401) return res
  source.refresh()
  // Unchanged, or empty — a file read mid-write by a person editing it reads as no token, and a retry without one
  // can only be refused again. The next request reads the file afresh.
  if (source.token === used || !source.token) return res
  await res.body?.cancel().catch(() => {})
  return fetchImpl(url, { ...init, headers: { ...init.headers, ...authHeader(source) } })
}

/**
 * Why the relay refused, and the fix, by where the token came from. Every client's 401 says this, so a person sees
 * the same cause whichever tool met it.
 */
export function tokenRefusal(source: TokenSource): string {
  const store = `store one in ${source.path} under "${source.origin}"`
  switch (source.from) {
    case 'flag':
    case 'env': {
      const name = source.from === 'flag' ? '--token' : 'TAPFLOW_TOKEN'
      return `the relay at ${source.origin} did not accept the token from ${name} (unknown on this relay, revoked or expired): ` +
        `pass one minted on this relay, or remove ${name} and ${store}`
    }
    case 'file':
      return `the relay at ${source.origin} did not accept the token stored for it in ${source.path} ` +
        '(unknown on this relay, revoked or expired): replace it there with one minted on this relay'
    case 'none': {
      const others = readCredential(source.path, source.origin).origins
      return `no token for the relay at ${source.origin}: ${store}` +
        (others.length > 0 ? ` (the file has tokens for ${others.join(', ')})` : '')
    }
  }
}

