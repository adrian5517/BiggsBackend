if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
  module.exports = {};
} else {
  const mongoose = require('mongoose');
  const reportBackupSchema = new mongoose.Schema(
    {
      originalId: { type: mongoose.Schema.Types.ObjectId, index: true },
      jobId: { type: String, index: true },
      branch: { type: String, index: true },
      pos: { type: Number, index: true },
      workDate: { type: Date, index: true },
      uniqueKey: { type: String },
      sourceFile: { type: String },
      ingestedAt: { type: Date },
      data: { type: mongoose.Schema.Types.Mixed },
      replacedAt: { type: Date },
      replacedByJob: { type: String },
    },
    { timestamps: true }
  );

  reportBackupSchema.index({ branch: 1, workDate: 1, pos: 1 });

  module.exports = mongoose.model('ReportBackup', reportBackupSchema);
}
