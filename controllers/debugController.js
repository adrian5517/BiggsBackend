const fs = require('fs')
const path = require('path')

function parseCSV(text) {
  const rows = []
  let cur = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\r') { continue }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else { cur += ch }
    }
  }
  // push last
  if (cur !== '' || row.length > 0) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

exports.getCsv = async (req, res) => {
  try {
    const filename = req.query.filename || 'CntroOct8_cleaned.csv'
    const q = (req.query.q || '').toString().trim().toLowerCase()
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.max(1, parseInt(req.query.limit) || 50)

    const filePath = path.join(__dirname, '..', 'documents', filename)
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' })

    const text = fs.readFileSync(filePath, 'utf8')
    const rows = parseCSV(text)
    if (rows.length === 0) return res.json({ items: [], total: 0, page, pageSize: limit, headers: [] })

    const headers = rows[0].map(h => h.trim())
    const data = rows.slice(1).map(r => {
      const obj = {}
      for (let i = 0; i < headers.length; i++) obj[headers[i] || `col${i}`] = (r[i] || '').trim()
      return obj
    })

    let filtered = data
    if (q) {
      filtered = data.filter(row => Object.values(row).some(v => String(v || '').toLowerCase().includes(q)))
    }

    const total = filtered.length
    const start = (page - 1) * limit
    const items = filtered.slice(start, start + limit)

    res.json({ items, total, page, pageSize: limit, headers })
  } catch (err) {
    console.error('CSV debug error:', err)
    res.status(500).json({ message: 'Failed to read CSV', error: String(err && err.message) })
  }
}

// export parser for reuse
exports.parseCSV = parseCSV

