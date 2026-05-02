const NEWAPI_INTERNAL_BASE_URL = process.env.NEWAPI_INTERNAL_BASE_URL || process.env.NEWAPI_BASE_URL || 'http://127.0.0.1:3000'

export interface NewApiTokenInfo {
  id: number
  name: string
  key: string
  status: number
  remain_quota: number
  unlimited_quota: boolean
  expired_time: number
  group: string
  model_limits_enabled: boolean
}

export interface NewApiSessionInfo {
  logged_in: boolean
  base_url: string
  user: {
    id: number
    username: string
    display_name?: string
    role: number
    group: string
  }
  tokens: NewApiTokenInfo[]
}

function newApiUrl(path: string) {
  const base = NEWAPI_INTERNAL_BASE_URL.replace(/\/+$/, '')
  return `${base}${path}`
}

function cookieHeader(req: any) {
  return String(req.headers?.cookie || '')
}

async function readJson(res: any) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  }
  catch {
    throw new Error(`New API returned non-JSON response: ${text.slice(0, 120)}`)
  }
}

export async function fetchNewApiSession(req: any): Promise<NewApiSessionInfo | null> {
  const cookie = cookieHeader(req)
  if (!cookie)
    return null

  try {
    const res = await fetch(newApiUrl('/api/chatgpt-web/session'), {
      headers: {
        Cookie: cookie,
        'Cache-Control': 'no-store',
      },
    })
    if (!res.ok)
      return null

    const json = await readJson(res)
    if (!json?.success || !json?.data?.logged_in)
      return null

    return json.data as NewApiSessionInfo
  }
  catch (error) {
    console.error('[newapi] session validation failed:', (error as any)?.message || error)
    return null
  }
}

export async function fetchNewApiTokenKey(req: any, tokenId: number): Promise<string> {
  const cookie = cookieHeader(req)
  if (!cookie)
    throw new Error('New API session cookie is missing')

  const res = await fetch(newApiUrl(`/api/chatgpt-web/token/${encodeURIComponent(String(tokenId))}/key`), {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Cache-Control': 'no-store',
    },
  })
  const json = await readJson(res)
  if (!res.ok || !json?.success || !json?.data?.key)
    throw new Error(json?.message || 'Failed to resolve New API token')

  return json.data.key as string
}
