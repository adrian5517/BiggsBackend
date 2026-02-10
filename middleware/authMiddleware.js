const jwt = require('jsonwebtoken');
const User = require('../models/usersModel');

exports.protect = async (req, res, next) => {
    let token;

    try {
        // Accept Authorization header with or without 'Bearer ' prefix
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader) {
            if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7).trim();
            else token = authHeader.trim();

            if (process.env.NODE_ENV !== 'production') {
                console.log('Extracted Token:', token);
            }

            // Verify token (use fallback secret in development)
            const secret = process.env.JWT_SECRET || 'dev_jwt_secret';
            const decoded = jwt.verify(token, secret);

            if (!decoded || !decoded.id) {
                return res.status(401).json({ message: 'Token is invalid or malformed' });
            }

            // Fetch user and attach to request object
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user) {
                return res.status(401).json({ message: 'User not found' });
            }

            return next(); // User is authorized, proceed
        }

        return res.status(401).json({ message: 'Not authorized, token missing' });
    } catch (error) {
        console.error("Auth middleware error:", error.message);
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};
