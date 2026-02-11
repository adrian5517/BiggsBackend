const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  branch: { type: String },
  pos: { type: Number },
  workDate: { type: Date },
  sourceFile: { type: String },
  ingestedAt: { type: Date, default: Date.now },
  data: { type: mongoose.Schema.Types.Mixed },
  uniqueKey: { type: String, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
