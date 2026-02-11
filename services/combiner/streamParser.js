const fs = require('fs')
const { parse } = require('csv-parse')

function excelSafe(val) {
  if (val == null) return ''
  const s = String(val)
  if (/^0\d+/.test(s) || s.length > 15) return `="${s.replace(/"/g, '""')}"`
  return s
}

/**
 * processRd5000(filePath, lookups, onBatch)
 * - lookups: object returned from buildLookups
 * - onBatch: async function(docs) called for each batch
 */
function processRd5000(filePath, lookups, onBatch, opts = {}) {
  const batchSize = opts.batchSize || 1000
  return new Promise((resolve, reject) => {
    const instream = fs.createReadStream(filePath)
    const parser = parse({ relax_column_count: true })
    const batch = []

    parser.on('readable', () => {
      let record
      while ((record = parser.read())) {
        // map rd5000 indices per documentation
        const item_code = record[4]
        const qty = Number(record[5]) || 0
        const unit_price = Number(record[6]) || 0
        const amount = Number(record[7]) || 0
        const dept_code = record[11]
        const date = record[12]
        const time = record[13]
        const transno = record[37]

        const item = lookups.rd5500.get(item_code) || { name: '', dept: '' }
        const product_name = item.name || ''
        const department_name = lookups.rd1800.get(dept_code) || ''
        const discount_name = lookups.discount.get(record[18]) || ''
        const payment_code = lookups.rd5800.get(transno) || ''
        const payment_name = lookups.rd5900.get(payment_code) || ''
        const phone = lookups.blpr.get(transno) || ''

        const doc = {
          pos: record[0],
          or: record[2],
          item_code: excelSafe(item_code),
          qty,
          unit_price,
          amount,
          discount_code: record[18],
          discount_name,
          dept_code,
          dept_name: department_name,
          product_name,
          transaction_type: record[21],
          date,
          time,
          payment_code,
          payment_name,
          phone,
          source_file: filePath
        }

        batch.push(doc)
        if (batch.length >= batchSize) {
          const toSend = batch.splice(0, batch.length)
          try {
            onBatch(toSend)
          } catch (e) {
            return reject(e)
          }
        }
      }
    })

    parser.on('error', err => reject(err))
    parser.on('end', async () => {
      if (batch.length) {
        await onBatch(batch.splice(0, batch.length))
      }
      resolve()
    })

    instream.pipe(parser)
  })
}

module.exports = { processRd5000, excelSafe }
