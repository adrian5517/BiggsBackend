const mongoose = require('mongoose');

const fetchLogSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
    },
    mode: { type: String, default: 'range' },
    startDate: { type: String },
    endDate: { type: String },
    branches: [{ type: String }],
    positions: [{ type: Number }],
    rowsInserted: { type: Number, default: 0 },
    filesTotal: { type: Number, default: 0 },
    filesCompleted: { type: Number, default: 0 },
    errors: [{ type: String }],
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FetchLog', fetchLogSchema);
