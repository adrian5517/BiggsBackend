const masterCtrl = require('../controllers/masterController')

async function run() {
  console.log('Reading index...')
  const idx = masterCtrl.listMasters()
  console.log('Generated at:', idx.generatedAt)
  console.log('Groups:', (idx.summary || []).length)
  if ((idx.summary || []).length === 0) return
  const first = idx.summary[0]
  console.log('Previewing first group:', first.key, first.file, 'count=', first.count)
  try {
    const rows = await masterCtrl.readFirstN(first.key, 5)
    console.log('Preview rows:', rows.length)
    console.dir(rows, { depth: 2 })
  } catch (e) {
    console.error('Error reading preview', e)
  }
}

if (require.main === module) run()

module.exports = { run }
