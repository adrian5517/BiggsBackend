const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const MasterTransaction = require('../models/masterTransactionModel')

const MASTER_DIR = path.join(__dirname, '..', 'master')
const INDEX_PATH = path.join(MASTER_DIR, 'index.json')

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { generatedAt: null, summary: [] }
  const txt = fs.readFileSync(INDEX_PATH, 'utf8')
  try {
    return JSON.parse(txt)
  } catch (e) {
    return { generatedAt: null, summary: [] }
  }
}

function listMasters() {
  const idx = readIndex()
  return idx
}

function listMastersFiltered(opts = {}) {
  const { page = 1, limit = 20, q, branch, date } = opts
  const idx = readIndex()
  let items = (idx.summary || []).slice()

  if (q) {
    const qq = String(q).toLowerCase()
    items = items.filter(i => (i.key || '').toLowerCase().includes(qq) || (i.file || '').toLowerCase().includes(qq))
  }
  if (branch) {
    const b = String(branch).toLowerCase()
    items = items.filter(i => (i.key || '').toLowerCase().startsWith(b) || (i.key || '').toLowerCase().includes(`_${b}_`))
  }
  if (date) {
    const d = String(date)
    items = items.filter(i => (i.key || '').includes(d) || (i.file || '').includes(d))
  }

  const total = items.length
  const p = Math.max(1, parseInt(page, 10) || 1)
  const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
  const start = (p - 1) * l
  const pageItems = items.slice(start, start + l)

  return { generatedAt: idx.generatedAt, total, page: p, pageSize: l, items: pageItems }
}

function getMasterFileForKey(key) {
  const idx = readIndex()
  const found = (idx.summary || []).find(s => s.key === key || s.file === key)
  if (!found) return null
  const filePath = path.join(MASTER_DIR, found.file)
  if (!fs.existsSync(filePath)) return null
  return { path: filePath, meta: found }
}

function streamMasterDecompressed(key, res) {
  const info = getMasterFileForKey(key)
  if (!info) {
    res.statusCode = 404
    res.end('Not found')
    return
  }
  res.setHeader('Content-Type', 'application/x-ndjson')
  const rs = fs.createReadStream(info.path)
  const gunzip = zlib.createGunzip()
  rs.pipe(gunzip).pipe(res)
}

function readFirstN(key, n = 5) {
  const info = getMasterFileForKey(key)
  if (!info) return { error: 'not_found' }
  const out = []
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(info.path)
    const gunzip = zlib.createGunzip()
    let leftover = ''
    gunzip.on('data', chunk => {
      const s = (leftover + chunk.toString())
      const parts = s.split('\n')
      leftover = parts.pop()
      for (const p of parts) {
        if (!p) continue
        try { out.push(JSON.parse(p)) } catch (e) { /* ignore */ }
        if (out.length >= n) {
          rs.destroy()
          gunzip.destroy()
          return resolve(out)
        }
      }
    })
    gunzip.on('end', () => resolve(out))
    gunzip.on('error', err => reject(err))
    rs.on('error', err => reject(err))
    rs.pipe(gunzip)
  })
}

async function searchTransactions(opts = {}) {
  const {
    page = 1,
    limit = 20,
    q,
    branch,
    pos,
    productCode,
    productName,
    minAmount,
    maxAmount,
    date,
    dateFrom,
    dateTo,
  } = opts

  const filter = {}
  if (branch) filter.branch = branch
  if (pos !== undefined && pos !== null) filter.pos = Number(pos)
  if (productCode) filter.productCode = productCode
  if (productName) filter.productName = new RegExp(productName, 'i')
  if (minAmount !== undefined || maxAmount !== undefined) {
    filter.amount = {}
    if (minAmount !== undefined) filter.amount.$gte = Number(minAmount)
    if (maxAmount !== undefined) filter.amount.$lte = Number(maxAmount)
  }

  // date handling: exact day or range
  if (date) {
    // treat date as YYYY-MM-DD
    const start = new Date(date)
    start.setHours(0,0,0,0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    filter.date = { $gte: start, $lt: end }
  } else if (dateFrom || dateTo) {
    filter.date = {}
    if (dateFrom) filter.date.$gte = new Date(dateFrom)
    if (dateTo) filter.date.$lte = new Date(dateTo)
  }

  if (q) {
    const re = new RegExp(String(q), 'i')
    filter.$or = [
      { productName: re },
      { productCode: re },
      { departmentName: re },
      { sourceFile: re },
    ]
  }

  const p = Math.max(1, parseInt(page, 10) || 1)
  const l = Math.max(1, Math.min(1000, parseInt(limit, 10) || 20))

  const [total, items] = await Promise.all([
    MasterTransaction.countDocuments(filter),
    MasterTransaction.find(filter).sort({ date: -1 }).skip((p-1)*l).limit(l).lean()
  ])

  return { total, page: p, pageSize: l, items }
}

function buildFilterFromOpts(opts = {}) {
  const {
    q,
    branch,
    pos,
    productCode,
    productName,
    minAmount,
    maxAmount,
    date,
    dateFrom,
    dateTo,
  } = opts
  const filter = {}
  if (branch) filter.branch = branch
  if (pos !== undefined && pos !== null) filter.pos = Number(pos)
  if (productCode) filter.productCode = productCode
  if (productName) filter.productName = new RegExp(productName, 'i')
  if (minAmount !== undefined || maxAmount !== undefined) {
    filter.amount = {}
    if (minAmount !== undefined && minAmount !== '') filter.amount.$gte = Number(minAmount)
    if (maxAmount !== undefined && maxAmount !== '') filter.amount.$lte = Number(maxAmount)
  }
  if (date) {
    const start = new Date(date)
    start.setHours(0,0,0,0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    filter.date = { $gte: start, $lt: end }
  } else if (dateFrom || dateTo) {
    filter.date = {}
    if (dateFrom) filter.date.$gte = new Date(dateFrom)
    if (dateTo) filter.date.$lte = new Date(dateTo)
  }
  if (q) {
    const re = new RegExp(String(q), 'i')
    filter.$or = [
      { productName: re },
      { productCode: re },
      { departmentName: re },
      { sourceFile: re },
    ]
  }
  return filter
}

function streamSearchCsvToStream(opts = {}, writable) {
  const filter = buildFilterFromOpts(opts)
  const cursor = MasterTransaction.find(filter).sort({ date: -1 }).cursor()
  const headers = ['branch','pos','date','time','transactionNumber','productCode','productName','departmentCode','departmentName','quantity','unitPrice','amount','sourceFile']

  return new Promise((resolve, reject) => {
    // write header
    writable.write(headers.join(',') + '\n')

    cursor.on('data', doc => {
      const line = headers.map(h => {
        let v = doc[h]
        if (v === undefined || v === null) return ''
        if (v instanceof Date) v = v.toISOString()
        return `"${String(v).replace(/"/g, '""')}"`
      }).join(',')
      const ok = writable.write(line + '\n')
      if (!ok) cursor.pause()
    })

    writable.on('drain', () => { try { cursor.resume() } catch (e) {} })

    cursor.on('end', () => {
      writable.end()
      resolve()
    })
    cursor.on('error', err => {
      try { writable.end() } catch (e) {}
      reject(err)
    })
  })
}

function streamSearchCsv(req, res) {
  const opts = {
    q: req.query.q || req.body.q,
    branch: req.query.branch || req.body.branch,
    pos: req.query.pos || req.body.pos,
    productCode: req.query.productCode || req.body.productCode,
    productName: req.query.productName || req.body.productName,
    minAmount: req.query.minAmount || req.body.minAmount,
    maxAmount: req.query.maxAmount || req.body.maxAmount,
    date: req.query.date || req.body.date,
    dateFrom: req.query.dateFrom || req.body.dateFrom,
    dateTo: req.query.dateTo || req.body.dateTo,
  }

  const accept = (req.headers['accept-encoding'] || '')
  const wantsGzip = /\bgzip\b/.test(accept)
  const baseName = `master-export-${new Date().toISOString().slice(0,10)}`
  if (wantsGzip) {
    const filename = `${baseName}.csv.gz`
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const gzip = zlib.createGzip()
    gzip.pipe(res)
    streamSearchCsvToStream(opts, gzip).then(() => {
      try { gzip.end() } catch (e) {}
    }).catch(err => {
      console.error('CSV export error', err)
      try { gzip.end() } catch (e) {}
      if (!res.headersSent) res.status(500).end('Export error')
    })
  } else {
    const filename = `${baseName}.csv`
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    streamSearchCsvToStream(opts, res).catch(err => {
      console.error('CSV export error', err)
      if (!res.headersSent) res.status(500).end('Export error')
      try { res.end() } catch (e) {}
    })
  }
}

module.exports = { listMasters, listMastersFiltered, streamMasterDecompressed, readFirstN, searchTransactions, streamSearchCsv, streamSearchCsvToStream }

