const mongoose = require('mongoose');

const FileRecordSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  branch: { type: String },
  pos: { type: Number },
  workDate: { type: Date },
  fileType: { type: String },
  storage: {
    type: { type: String, enum: ['local', 'gridfs', 's3'], default: 'local' },
    path: { type: String },
  },
  fetchedAt: { type: Date, default: Date.now },
  size: { type: Number },
  status: { type: String, enum: ['raw', 'parsed', 'error'], default: 'raw' },
  error: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('FileRecord', FileRecordSchema);
