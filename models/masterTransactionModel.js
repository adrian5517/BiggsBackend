const mongoose = require('mongoose')

const masterTransactionSchema = new mongoose.Schema({
  branch: { type: String, index: true },
  pos: { type: Number, index: true },
  date: { type: Date, index: true },
  time: String,
  transactionNumber: { type: String, index: true },
  productCode: { type: String, index: true },
  productName: String,
  departmentCode: { type: String, index: true },
  departmentName: String,
  quantity: Number,
  unitPrice: Number,
  amount: Number,
  sourceFile: String,
  ingestedAt: { type: Date, default: Date.now }
}, { timestamps: true })

masterTransactionSchema.index({ branch: 1, date: 1, pos: 1 })

module.exports = mongoose.model('MasterTransaction', masterTransactionSchema)
