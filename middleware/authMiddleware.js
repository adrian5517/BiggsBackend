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

            if (process.env.LOG_AUTH_TOKENS === 'true' || String(process.env.ENABLE_DEBUG_ENDPOINTS || '').toLowerCase() === 'true') {
                const masked = token ? `${String(token).slice(0, 6)}...${String(token).slice(-6)}` : '<no-token>';
                console.log('[auth-debug] Extracted Token from header:', masked);
            }

            // Verify token (use fallback secret in development)
            const secret = process.env.JWT_SECRET || 'dev_jwt_secret';

            // Detect common misconfiguration: JWT_SECRET accidentally set to a JWT string
            try {
                if (secret && typeof secret === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secret)) {
                    console.error('CRITICAL: your process.env.JWT_SECRET looks like a JWT (starts with eyJ and contains 2 dots).');
                    console.error('This means your signing secret was overwritten with a token string. Restore the original secret in your .env and restart the server.');
                }
            } catch (e) {
                // ignore detection errors
            }

            if (process.env.LOG_AUTH_TOKENS === 'true') {
                try {
                    // Attempt to decode token header/payload without verifying signature for debugging
                    const parts = String(token || '').split('.');
                    if (parts.length === 3) {
                        const decode = (s) => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString();
                        const header = JSON.parse(decode(parts[0]));
                        const payload = JSON.parse(decode(parts[1]));
                        console.log('Decoded token header:', header);
                        console.log('Decoded token payload:', payload);
                    }
                } catch (e) {
                    // ignore decode errors
                }
            }
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

        // Fall back: allow token in query, JSON body, or cookies for tooling/CLI convenience
        if (!token && req.query && req.query.token) token = String(req.query.token).trim();
        if (!token && req.body && req.body.token) token = String(req.body.token).trim();
        if (!token && req.cookies && req.cookies.token) token = String(req.cookies.token).trim();

        if (process.env.LOG_AUTH_TOKENS === 'true' || String(process.env.ENABLE_DEBUG_ENDPOINTS || '').toLowerCase() === 'true') {
            const source = (req.headers && (req.headers.authorization || req.headers.Authorization)) ? 'header' : (req.query && req.query.token) ? 'query' : (req.body && req.body.token) ? 'body' : (req.cookies && req.cookies.token) ? 'cookie' : 'none';
            const masked = token ? `${String(token).slice(0, 6)}...${String(token).slice(-6)}` : '<no-token>';
            console.log(`[auth-debug] token source=${source} masked=${masked} path=${req.originalUrl || req.url || req.path}`);
        }

        if (!token) {
            return res.status(401).json({ message: 'Not authorized, token missing (expected Authorization header, ?token query, JSON body.token, or cookie)' });
        }
    } catch (error) {
        console.error("Auth middleware error:", error.message);
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

exports.protectWithQueryToken = async (req, res, next) => {
    let token;

    try {
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader) {
            if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7).trim();
            else token = authHeader.trim();
            if (process.env.LOG_AUTH_TOKENS === 'true' || String(process.env.ENABLE_DEBUG_ENDPOINTS || '').toLowerCase() === 'true') {
                const masked = token ? `${String(token).slice(0, 6)}...${String(token).slice(-6)}` : '<no-token>';
                console.log('[auth-debug] protectWithQueryToken extracted from header:', masked);
            }
        }

        if (!token && req.query && req.query.token) {
            token = String(req.query.token).trim();
        }
        if (!token && req.body && req.body.token) token = String(req.body.token).trim();
        if (!token && req.cookies && req.cookies.token) token = String(req.cookies.token).trim();

        if (!token) {
            if (process.env.LOG_AUTH_TOKENS === 'true' || String(process.env.ENABLE_DEBUG_ENDPOINTS || '').toLowerCase() === 'true') {
                console.log('[auth-debug] protectWithQueryToken missing token; path=', req.originalUrl || req.url || req.path);
            }
            return res.status(401).json({ message: 'Not authorized, token missing (expected Authorization header, ?token, JSON body.token, or cookie)' });
        }

        const secret = process.env.JWT_SECRET || 'dev_jwt_secret';
        const decoded = jwt.verify(token, secret);

        if (!decoded || !decoded.id) {
            return res.status(401).json({ message: 'Token is invalid or malformed' });
        }

        req.user = await User.findById(decoded.id).select('-password');

        if (!req.user) {
            return res.status(401).json({ message: 'User not found' });
        }

        return next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};
