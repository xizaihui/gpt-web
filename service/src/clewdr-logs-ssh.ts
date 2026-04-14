import { Client } from 'ssh2'

const CLEWDR_SSH_HOST = process.env.CLEWDR_SSH_HOST || '38.150.32.190'
const CLEWDR_SSH_PORT = Number(process.env.CLEWDR_SSH_PORT) || 22
const CLEWDR_SSH_USER = process.env.CLEWDR_SSH_USER || 'root'
const CLEWDR_SSH_PASS = process.env.CLEWDR_SSH_PASS || 'Adm@xz527'

interface LogQueryParams {
  lines?: number       // number of lines (default 200)
  since?: string       // journalctl --since (e.g. "1 hour ago", "2026-04-10 10:00")
  until?: string       // journalctl --until
  grep?: string        // grep filter
  priority?: string    // journalctl priority (e.g. "err", "warning")
  unit?: string        // systemd unit (default "clewdr")
}

interface LogResult {
  logs: string[]
  count: number
  truncated: boolean
  unit: string
  host: string
}

function sshExec(command: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let output = ''
    let stderr = ''
    let done = false

    const timer = setTimeout(() => {
      if (!done) {
        done = true
        conn.end()
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    conn.on('ready', () => {
      conn.exec(command, (err: any, stream: any) => {
        if (err) {
          done = true
          clearTimeout(timer)
          conn.end()
          reject(err)
          return
        }
        stream.on('data', (data: Buffer) => { output += data.toString() })
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
        stream.on('close', () => {
          done = true
          clearTimeout(timer)
          conn.end()
          resolve(output)
        })
      })
    })

    conn.on('error', (err: any) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(err)
      }
    })

    conn.connect({
      host: CLEWDR_SSH_HOST,
      port: CLEWDR_SSH_PORT,
      username: CLEWDR_SSH_USER,
      password: CLEWDR_SSH_PASS,
      readyTimeout: 5000,
    })
  })
}

export async function queryClewdrSystemLogs(params: LogQueryParams = {}): Promise<LogResult> {
  const unit = params.unit || 'clewdr'
  const lines = Math.min(params.lines || 200, 2000)

  let cmd = `journalctl -u ${unit} --no-pager -o short-iso`

  if (params.since) {
    cmd += ` --since '${params.since.replace(/'/g, '')}'`
  }
  if (params.until) {
    cmd += ` --until '${params.until.replace(/'/g, '')}'`
  }
  if (params.priority) {
    cmd += ` -p ${params.priority.replace(/[^a-z0-9]/gi, '')}`
  }

  // Always limit lines
  cmd += ` -n ${lines}`

  // Apply grep if provided
  if (params.grep) {
    const safeGrep = params.grep.replace(/'/g, "'\\''")
    cmd += ` | grep -i '${safeGrep}'`
  }

  const output = await sshExec(cmd, 15000)
  const logLines = output.split('\n').filter(l => l.trim())
  const truncated = logLines.length >= lines

  return {
    logs: logLines,
    count: logLines.length,
    truncated,
    unit,
    host: CLEWDR_SSH_HOST,
  }
}

export async function streamClewdrLogs(params: LogQueryParams = {}): Promise<string[]> {
  // Get latest N lines for "tail" view
  const unit = params.unit || 'clewdr'
  const lines = Math.min(params.lines || 50, 500)
  const cmd = `journalctl -u ${unit} --no-pager -o short-iso -n ${lines}`
  const output = await sshExec(cmd, 10000)
  return output.split('\n').filter(l => l.trim())
}

export async function getClewdrServiceStatus(): Promise<{
  active: boolean
  status: string
  uptime: string
  memory: string
  pid: string
}> {
  const output = await sshExec(
    `systemctl show clewdr --property=ActiveState,SubState,MainPID,MemoryCurrent && systemctl show clewdr --property=ActiveEnterTimestamp`,
    10000,
  )
  const props: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const [key, ...val] = line.split('=')
    if (key && val.length) props[key.trim()] = val.join('=').trim()
  }

  const active = props.ActiveState === 'active'
  const status = `${props.ActiveState || 'unknown'} (${props.SubState || 'unknown'})`
  const memBytes = parseInt(props.MemoryCurrent || '0')
  const memory = memBytes > 0 ? `${(memBytes / 1024 / 1024).toFixed(1)} MB` : 'N/A'
  const pid = props.MainPID || 'N/A'

  // Calculate uptime
  let uptime = 'N/A'
  if (props.ActiveEnterTimestamp && props.ActiveEnterTimestamp !== '') {
    const start = new Date(props.ActiveEnterTimestamp)
    const now = new Date()
    const diffMs = now.getTime() - start.getTime()
    if (diffMs > 0) {
      const hours = Math.floor(diffMs / 3600000)
      const mins = Math.floor((diffMs % 3600000) / 60000)
      if (hours > 24) {
        const days = Math.floor(hours / 24)
        uptime = `${days}d ${hours % 24}h`
      } else {
        uptime = `${hours}h ${mins}m`
      }
    }
  }

  return { active, status, uptime, memory, pid }
}
