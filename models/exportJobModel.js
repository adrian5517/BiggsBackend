const mongoose = require('mongoose')

const exportJobSchema = new mongoose.Schema({
  jobId: { type: String, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending','running','done','failed','cancelled'], default: 'pending', index: true },
  params: { type: mongoose.Schema.Types.Mixed },
  fileName: String,
  error: String,
  progress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

exportJobSchema.pre('save', function() { this.updatedAt = new Date(); })

module.exports = mongoose.model('ExportJob', exportJobSchema)
