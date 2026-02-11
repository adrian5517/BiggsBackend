const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')

function parseCsvFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8')
  return parse(txt, { relax_column_count: true, skip_empty_lines: true })
}

function buildItemMap(rows) {
  const map = new Map()
  for (const r of rows) {
    const code = r[0] && String(r[0]).trim()
    const name = r[1] && String(r[1]).trim()
    const dept = r[3] || r[12] || ''
    if (code) map.set(code, { name, dept })
  }
  return map
}

function buildSimpleMap(rows, keyIndex = 0, valueIndex = 1) {
  const map = new Map()
  for (const r of rows) {
    const k = r[keyIndex] && String(r[keyIndex]).trim()
    const v = r[valueIndex] && String(r[valueIndex]).trim()
    if (k) map.set(k, v)
  }
  return map
}

async function buildLookups(dir) {
  const abs = path.resolve(dir)
  const files = fs.existsSync(abs) ? fs.readdirSync(abs) : []

  const lookups = {
    rd5500: new Map(), // item_code -> { name, dept }
    rd1800: new Map(), // dept_code -> dept_name
    discount: new Map(), // discount_code -> discount_name
    rd5800: new Map(), // transno -> payment_code
    rd5900: new Map(), // payment_code -> payment_name
    blpr: new Map() // transKey -> phone
  }

  for (const f of files) {
    const p = path.join(abs, f)
    if (!fs.statSync(p).isFile()) continue
    const rows = parseCsvFile(p)
    const name = f.toLowerCase()
    if (name.includes('rd5500')) lookups.rd5500 = buildItemMap(rows)
    else if (name.includes('rd1800')) lookups.rd1800 = buildSimpleMap(rows, 0, 1)
    else if (name.includes('discount')) lookups.discount = buildSimpleMap(rows, 0, 1)
    else if (name.includes('rd5800')) lookups.rd5800 = buildSimpleMap(rows, 0, 11)
    else if (name.includes('rd5900')) lookups.rd5900 = buildSimpleMap(rows, 0, 1)
    else if (name.includes('blpr')) lookups.blpr = buildSimpleMap(rows, 3, 1)
  }

  return lookups
}

module.exports = { buildLookups }
