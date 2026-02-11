const path = require('path')
const { spawnSync } = require('child_process')
const { MongoMemoryServer } = require('mongodb-memory-server')

(async function main(){
  try {
    const mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    console.log('Started in-memory MongoDB at', uri)

    // Run the existing test script with MONGO_URI set to the in-memory server
    const script = path.join(__dirname, 'testCreateExportJob.js')
    console.log('Running', script)
    const res = spawnSync(process.execPath, [script], {
      env: Object.assign({}, process.env, { MONGO_URI: uri }),
      stdio: 'inherit'
    })

    console.log('Test finished with exit code', res.status)
    await mongod.stop()
    process.exit(res.status === null ? 0 : res.status)
  } catch (err) {
    console.error('Runner error:', err)
    process.exit(1)
  }
})()
