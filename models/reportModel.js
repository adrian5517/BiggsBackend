const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    jobId: { type: String, index: true },
    branch: { type: String, index: true },
    pos: { type: Number, index: true },
    workDate: { type: Date, index: true },
    uniqueKey: { type: String },
    sourceFile: { type: String },
    ingestedAt: { type: Date, default: Date.now },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

reportSchema.index({ branch: 1, workDate: 1, pos: 1 });
reportSchema.index({ uniqueKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Report', reportSchema);
