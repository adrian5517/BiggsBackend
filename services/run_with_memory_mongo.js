#!/usr/bin/env node
const { MongoMemoryServer } = require('mongodb-memory-server')
const path = require('path')
const child_process = require('child_process')

(async () => {
  console.log('Starting in-memory MongoDB...')
  const mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  console.log('Memory Mongo URI:', uri)

  const env = Object.assign({}, process.env, { MONGO_URI: uri })

  const testFile = path.resolve(__dirname, 'testCreateExportJob.js')
  console.log('Running', testFile)
  const p = child_process.spawn(process.execPath, [testFile], { stdio: 'inherit', env })

  p.on('exit', async (code) => {
    console.log('Test process exited with', code)
    await mongod.stop()
    process.exit(code || 0)
  })
})().catch(err => {
  console.error(err)
  process.exit(1)
})
