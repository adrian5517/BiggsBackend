require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
    username:{type: String , required: true, unique: true},
    email:{type: String , required: true, unique: true},
    password:{type: String , required: true},
    role:{type: String , enum: ['user', 'admin'], default: 'user'},
    profilePicture: { type: String,default:""},
    refreshTokens: { type: [String], default: [] }

},{timestamps: true});

//hash before saving
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});
//compare password
userSchema.methods.comparePassword = async function(candidatePassword){
    return await bcrypt.compare(candidatePassword, this.password);
}
//generate access token
userSchema.methods.generateAccessToken = function(){
    const secret = process.env.JWT_SECRET || 'dev_jwt_secret';
    if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET is not set. Using development fallback secret.');
    return jwt.sign({id: this._id, role: this.role}, secret, {expiresIn: '15m'});
}

module.exports = mongoose.model('User', userSchema);

