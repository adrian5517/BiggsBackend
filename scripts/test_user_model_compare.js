// Simple test for usersModel.comparePassword
const bcrypt = require('bcrypt');
const User = require('../models/usersModel');

async function run() {
  try {
    const plain = 'TestPass!234';
    const hash = await bcrypt.hash(plain, 10);
    // `User` is exported as a factory function that returns a User instance
    const user = User({ password: hash });
    const ok = await user.comparePassword(plain);
    if (ok) {
      console.log('usersModel.comparePassword: OK');
      process.exit(0);
    } else {
      console.error('usersModel.comparePassword: FAILED');
      process.exit(2);
    }
  } catch (err) {
    console.error('usersModel.comparePassword: ERROR', err && err.stack ? err.stack : err);
    process.exit(10);
  }
}

run();
