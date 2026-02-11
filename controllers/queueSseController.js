const { QueueEvents } = require('bullmq')

function writeEvent(res, event, data) {
  try {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  } catch (e) {
    // ignore write errors
  }
}

async function sse(req, res) {
  // SSE auth: require token if SSE_SECRET or JWT_SECRET present
  const secret = process.env.SSE_SECRET || process.env.JWT_SECRET || null
  if (secret) {
    const authHeader = req.headers.authorization || ''
    const qp = req.query && req.query.token ? String(req.query.token) : null
    const token = qp || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null)
    if (!token) {
      res.status(401).json({ error: 'SSE auth required' })
      return
    }
    try {
      const jwt = require('jsonwebtoken')
      const payload = jwt.verify(token, secret)
      // require admin role for admin-only functionality
      const role = payload && (payload.role || payload.roles || payload.scope || payload.scopes)
      const isAdmin = role === 'admin' || (Array.isArray(role) && role.includes('admin')) || payload.isAdmin === true
      if (!isAdmin) {
        res.status(403).json({ error: 'admin role required' })
        return
      }
    } catch (e) {
      res.status(401).json({ error: 'invalid token' })
      return
    }
  }

  const requested = (req.query.queue || 'all').split(',').map(s => String(s).trim()).filter(Boolean)
  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS || null

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write('\n')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  const subs = []
  const qnames = new Set()
  if (requested.includes('all')) { qnames.add('importQueue'); qnames.add('exportQueue') }
  requested.forEach(q => qnames.add(q))

  const qevents = []

  // heartbeat
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n') } catch (e) {} }, 15000)

  for (const qn of qnames) {
    if (!REDIS_URL) continue
    try {
      const qe = new QueueEvents(qn, { connection: { url: REDIS_URL } })
      const onCompleted = (jobId, returnvalue) => writeEvent(res, 'completed', { queue: qn, jobId, returnvalue })
      const onFailed = (jobId, failedReason) => writeEvent(res, 'failed', { queue: qn, jobId, failedReason })
      const onProgress = (jobId, progress) => writeEvent(res, 'progress', { queue: qn, jobId, progress })
      const onWaiting = (jobId) => writeEvent(res, 'waiting', { queue: qn, jobId })
      const onActive = (jobId, prev) => writeEvent(res, 'active', { queue: qn, jobId })
      const onStalled = (jobId) => writeEvent(res, 'stalled', { queue: qn, jobId })

      qe.on('completed', onCompleted)
      qe.on('failed', onFailed)
      qe.on('progress', onProgress)
      qe.on('waiting', onWaiting)
      qe.on('active', onActive)
      qe.on('stalled', onStalled)

      qevents.push({ qe, listeners: { onCompleted, onFailed, onProgress, onWaiting, onActive, onStalled } })
      writeEvent(res, 'connected', { queue: qn })
    } catch (e) {
      writeEvent(res, 'error', { queue: qn, message: String(e && e.message ? e.message : e) })
    }
  }

  req.on('close', async () => {
    clearInterval(hb)
    for (const { qe, listeners } of qevents) {
      try {
        qe.removeListener('completed', listeners.onCompleted)
        qe.removeListener('failed', listeners.onFailed)
        qe.removeListener('progress', listeners.onProgress)
        qe.removeListener('waiting', listeners.onWaiting)
        qe.removeListener('active', listeners.onActive)
        qe.removeListener('stalled', listeners.onStalled)
        await qe.close()
      } catch (e) {}
    }
  })
}

module.exports = { sse }
