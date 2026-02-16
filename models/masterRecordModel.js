if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
  module.exports = {};
} else {
  const mongoose = require('mongoose')

  const MasterRecordSchema = new mongoose.Schema({
    branch: { type: String, index: true },
    pos: { type: String, index: true },
    date: { type: Date, index: true },
    time: String,
    or: String,
    item_code: String,
    qty: Number,
    unit_price: Number,
    amount: Number,
    discount_code: String,
    discount_name: String,
    dept_code: String,
    dept_name: String,
    product_name: String,
    transaction_type: String,
    payment_code: String,
    payment_name: String,
    phone: String,
    source_file: String,
    createdAt: { type: Date, default: Date.now }
  }, { collection: 'master_records_temp' })

  MasterRecordSchema.index({ branch: 1, pos: 1, date: 1 })

  module.exports = mongoose.model('MasterRecord', MasterRecordSchema)
}
