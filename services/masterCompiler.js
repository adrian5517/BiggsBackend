const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const debugController = require('../controllers/debugController')

const LATEST_DIR = path.join(__dirname, '..', 'latest')
const OUT_DIR = path.join(__dirname, '..', 'master')

function ensureOut() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR)
}

function readCsvToObjects(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const rows = debugController.parseCSV(text)
  if (!rows || rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map(h => (h || '').trim())
  const data = rows.slice(1).map(r => {
    const obj = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i] || `col${i}`] = (r[i] || '').trim()
    return obj
  })
  return { headers, rows: data }
}

function findFiles() {
  if (!fs.existsSync(LATEST_DIR)) return []
  const files = fs.readdirSync(LATEST_DIR).filter(f => f.endsWith('.csv'))
  return files
}

function groupByKey(files) {
  // key: branch_pos_date
  const groups = {}
  files.forEach(file => {
    // sample filename format: a_BRANCH_POS_rd5000_2026-02-09_20-00_.csv
    const parts = file.split('_')
    if (parts.length < 5) return
    const branch = parts[1]
    const pos = parts[2]
    // find date part: last tokens that look like YYYY-MM-DD
    const dateToken = parts.find(p => /^\d{4}-\d{2}-\d{2}$/.test(p)) || parts[parts.length-3]
    const key = `${branch}_${pos}_${dateToken}`
    groups[key] = groups[key] || []
    groups[key].push(file)
  })
  return groups
}

function normalizeGroup(key, files) {
  // find rd5000
  const rd5000 = files.find(f => f.includes('_rd5000_'))
  if (!rd5000) return null
  const rd5500 = files.find(f => f.includes('_rd5500_'))
  const rd1800 = files.find(f => f.includes('_rd1800_'))

  const rd5000Obj = readCsvToObjects(path.join(LATEST_DIR, rd5000))
  const rd5500Obj = rd5500 ? readCsvToObjects(path.join(LATEST_DIR, rd5500)) : { rows: [] }
  const rd1800Obj = rd1800 ? readCsvToObjects(path.join(LATEST_DIR, rd1800)) : { rows: [] }

  // maps
  const prodMap = {}
  rd5500Obj.rows.forEach(r => { if (r.INCODE) prodMap[r.INCODE] = { name: r.ITE_DESC || r.ITE_DESC || '', dep: r.DEP_CODE || r.DEP_CODE || '' } })
  const depMap = {}
  rd1800Obj.rows.forEach(r => { if (r.DEP_CODE) depMap[r.DEP_CODE] = r.DEPDESC || r.DEPDESC || '' })

  const normalized = rd5000Obj.rows.map(r => {
    const code = r.ITE_CODE || r.INCODE || r.ITEM || ''
    const prod = prodMap[code] || {}
    const depCode = prod.dep || r.DEP_CODE || r.DEP || ''
    return {
      branch: r.BRANCH || r.BRANCH || key.split('_')[0],
      pos: Number(r.POS || r.POS || key.split('_')[1]) || 0,
      date: r.TRANSDATE || r.DATE || key.split('_')[2] || null,
      time: r.TIME || r.Time || r.TIME || '',
      transactionNumber: r.TRANSACTION || r.TRANSDOC || r.TRAN_NO || r.TRANSDOC || '',
      productCode: code,
      productName: prod.name || r.ITE_DESC || r.ITE_DESC || '',
      departmentCode: depCode,
      departmentName: depMap[depCode] || '',
      quantity: Number(r.QUANTITY || r.QTY || r.Quantity || 0) || 0,
      unitPrice: parseFloat(r.UNIT_PRICE || r.PRICE || r.UNITPRICE || 0) || 0,
      amount: parseFloat(r.AMOUNT || r.TOTAL || r.AMT || 0) || 0,
      sourceFile: rd5000,
    }
  })

  return { key, count: normalized.length, rows: normalized }
}

function writeGz(key, rows) {
  ensureOut()
  const outPath = path.join(OUT_DIR, `${key}.ndjson.gz`)
  const gz = zlib.createGzip()
  const out = fs.createWriteStream(outPath)
  gz.pipe(out)
  rows.forEach(r => gz.write(JSON.stringify(r) + '\n'))
  gz.end()
  return outPath
}

async function compileAll() {
  ensureOut()
  const files = findFiles()
  const groups = groupByKey(files)
  const summary = []
  for (const key of Object.keys(groups)) {
    try {
      const res = normalizeGroup(key, groups[key])
      if (!res) continue
      const out = writeGz(key, res.rows)
      summary.push({ key, file: path.basename(out), count: res.count })
    } catch (e) {
      console.error('compile error', key, e)
    }
  }
  const metaPath = path.join(OUT_DIR, 'index.json')
  fs.writeFileSync(metaPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary }, null, 2))
  return summary
}

if (require.main === module) {
  compileAll().then(s => console.log('Compiled groups:', s.length)).catch(err => console.error(err))
}

module.exports = { compileAll }
