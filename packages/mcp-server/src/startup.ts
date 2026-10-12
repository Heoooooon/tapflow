import { fetchWithToken, resolveToken, tokenRefusal } from '@tapflowio/flow-runner'
import { TapflowClient } from './client.js'

/**
 * Connects the MCP server's client, or says why it cannot and answers null (the process then exits 1).
 *
 * The token is `TAPFLOW_TOKEN`, else the credentials file for this relay — re-read when the relay refuses it, so
 * rotating a token is writing the file rather than re-registering this server (T1).
 */
export async function startClient(env: NodeJS.ProcessEnv, stderr: (line: string) => void): Promise<TapflowClient | null> {
  const relayUrl = env['TAPFLOW_RELAY_URL'] ?? 'ws://localhost:4000'
  const tokens = resolveToken({ relayUrl, env, warn: stderr })
  const client = new TapflowClient(relayUrl, tokens)

  try {
    await client.connect()
  } catch (e) {
    stderr(`Failed to connect to relay at ${relayUrl}: ${(e as Error).message}`)
    return null
  }

  // **Whether a token is needed is not decided from the URL.** The relay knows whether this socket is local — its
  // tunnel port and a Docker bridge are not, though both are `localhost` here — and says so by closing it 1008
  // right after the upgrade. One round trip finds out; a refusal is fatal as it always was, now naming the relay,
  // where the token came from, and the fix.
  try {
    await client.listDevices()
  } catch (e) {
    stderr(`The relay at ${tokens.origin} refused this connection: ${(e as Error).message}`)
    stderr(tokens.token ? tokenRefusal(tokens) : `${tokenRefusal(tokens)} (the relay's own Mac needs none)`)
    client.disconnect()
    return null
  }

  // A token the socket accepts can still be refused by REST (screenshot, ui-tree, builds), which checks it even on
  // loopback. Said at start, where the MCP log is read; not fatal, since the socket tools still work.
  if (tokens.token) {
    const res = await fetchWithToken(tokens, new URL('/api/v1/apps', tokens.origin).toString(), {}).catch(() => null)
    if (res?.status === 401) stderr(tokenRefusal(tokens))
    else if (res?.status === 403) stderr(`the token for ${tokens.origin} lacks the view scope, so screenshot, query_ui_tree and list_builds will be refused`)
    await res?.body?.cancel().catch(() => {})
  } else {
    stderr(`${tokenRefusal(tokens)}; until then screenshot, query_ui_tree and list_builds are refused`)
  }
  return client
}
