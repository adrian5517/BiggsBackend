const path = require('path')
const fs = require('fs')
const FileRecord = require('../models/fileRecordModel')
const importQueue = require('../services/importQueue')

async function handleUpload(req, res) {
  try {
    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' })

    const saved = []
    for (const f of files) {
      const rec = new FileRecord({
        filename: f.filename,
        branch: f.fieldname || null,
        storage: 'local',
        fetchedAt: new Date(),
        size: f.size || 0,
        status: 'uploaded'
      })
      await rec.save()
      saved.push({ id: rec._id, filename: f.filename })
    }

    // enqueue import job for the folder where multer saved files (best-effort)
    const folder = path.resolve(process.cwd(), 'latest')
    let job = null
    try {
      job = await importQueue.enqueueImportJob({ folder, files: files.map(f => f.filename) })
    } catch (e) {
      console.warn('[uploadController] could not enqueue import job:', e.message)
    }

    return res.json({ uploaded: saved.length, files: saved, jobId: job ? job.id : null })
  } catch (err) {
    console.error('[uploadController] error', err)
    return res.status(500).json({ error: err.message })
  }
}

module.exports = { handleUpload }
