const User = require('../models/usersModel');
const jwt = require('jsonwebtoken');
const streamifier = require('streamifier');
const cloudinary = require('../cloudinary');

// Use a fallback JWT secret in development to avoid runtime crashes when env is missing.
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
if (!process.env.JWT_SECRET) {
    console.warn('Warning: JWT_SECRET is not set. Using development fallback secret. Set JWT_SECRET in production.');
}

// Cookie parsing helpers (used by multiple auth handlers)
function parseCookies(req) {
    const header = req && req.headers && req.headers.cookie;
    if (!header) return {};
    return header.split(';').reduce((acc, part) => {
        const [key, ...rest] = part.trim().split('=');
        if (!key) return acc;
        acc[key] = decodeURIComponent(rest.join('='));
        return acc;
    }, {});
}

function readCookie(req, name) {
    if (!req || !name) return null;
    const cookies = parseCookies(req);
    return cookies[name] || null;
}

const registerUser = async (req, res) => {
    const { username, email, password, role } = req.body;

    try {
        // Server-side password policy:
        // - Minimum length: 8
        // - At least one uppercase letter
        // - At least one number
        // - At least one symbol (non-alphanumeric)
        if (!password) {
            return res.status(400).json({ message: 'Password is required' });
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ 
                message: 'Password does not meet complexity requirements. It must be at least 8 characters long and include at least one uppercase letter, one number, and one symbol.'
            });
        }


        // Check if email already exists
        const existingEmail = await User.findOne({ email });
        if (existingEmail) return res.status(400).json({ message: 'Email already exists' });

        // Check if username already exists
        const existingUsername = await User.findOne({ username });
        if (existingUsername) return res.status(400).json({ message: 'Username already exists' });

        const profilePicture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`;

        const newUser = new User({
            username,
            email,
            password,
            role,
            profilePicture
        });

        await newUser.save();

        // Use the access token generator defined on the model (with fallback secret)
        const token = newUser.generateAccessToken ? newUser.generateAccessToken() : jwt.sign({ id: newUser._id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

        // Don't send password in response
        const userResponse = {
            _id: newUser._id,
            username: newUser.username,
            email: newUser.email,
            profilePicture: newUser.profilePicture,
            role: newUser.role,
            createdAt: newUser.createdAt,
            updatedAt: newUser.updatedAt
        };

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: userResponse,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
};

const loginUser = async (req, res) => {
    const { identifier, email, username, password } = req.body;

    // Accept `identifier` (preferred), or `email` or `username` for backward compatibility
    const loginKey = (identifier || email || username || '').trim();
    if (!loginKey || !password) {
        return res.status(400).json({ message: 'Identifier (email or username) and password are required' });
    }

    try {
        console.log('Login attempt with identifier:', loginKey);

        const user = await User.findOne({ $or: [{ email: loginKey }, { username: loginKey }] });
        console.log('User found:', user ? 'Yes' : 'No');

        if (!user) {
            console.log('User not found with identifier:', loginKey);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        console.log('Comparing passwords...');
        const isPasswordMatch = await user.comparePassword(password);
        console.log('Password match:', isPasswordMatch);

        if (!isPasswordMatch) {
            console.log('Password does not match for identifier:', loginKey);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Prefer model method if present; fall back to signing directly
        const token = user.generateAccessToken ? user.generateAccessToken() : jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        // Create a refresh token (rotatable) and store it on the user
        const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev_refresh_secret';
        const refreshToken = jwt.sign({ id: user._id }, refreshSecret, { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' });

        // Persist refresh token to user document
        try {
            user.refreshTokens = user.refreshTokens || [];
            user.refreshTokens.push(refreshToken);
            await user.save();
        } catch (e) {
            console.warn('Failed to persist refresh token for user:', e && e.message ? e.message : e);
        }

        // Set HttpOnly refresh token cookie (accessible only to server)
        try {
            const isProd = process.env.NODE_ENV === 'production';
            const forceSecure = isProd || String(process.env.FORCE_SECURE_COOKIES || '').toLowerCase() === 'true';
            // In local/dev environments we avoid SameSite=None without Secure because modern
            // browsers will ignore such cookies. Use 'lax' for dev and 'none' (with secure)
            // for production/cross-site scenarios.
            const cookieOpts = { httpOnly: true, sameSite: forceSecure ? 'none' : 'lax', secure: !!forceSecure };
            if (process.env.COOKIE_DOMAIN) cookieOpts.domain = process.env.COOKIE_DOMAIN;
            // maxAge set to 7 days
            res.cookie('refreshToken', refreshToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' });
        } catch (e) {
            console.warn('Failed to set refresh token cookie:', e && e.message ? e.message : e);
        }
            try {
                const cookieOpts = { httpOnly: true, sameSite: 'none' };
                // For cross-site cookies, SameSite=None requires Secure attribute.
                // Ensure Secure is set when SameSite is 'none'. In production this will
                // also restrict cookies to HTTPS. If you need to test on localhost over
                // HTTP, consider using a local HTTPS dev server or an env flag.
                if (String(cookieOpts.sameSite).toLowerCase() === 'none') {
                    cookieOpts.secure = true;
                }
                if (process.env.COOKIE_DOMAIN) cookieOpts.domain = process.env.COOKIE_DOMAIN;
                res.cookie('refreshToken', refreshToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' });
            } catch (e) {
                console.warn('Failed to set refresh token cookie:', e && e.message ? e.message : e);
            }

        // Don't send password in response
        const userResponse = {
            _id: user._id,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture,
            address: user.address,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };

        res.status(200).json({
            message: 'Login Successful',
            token,
            user: userResponse
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error Logging in', error: error.message });
    }
};

const authMiddleware = async (req, res, next) => {
    const token = readCookie(req, 'token') || req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select('-password');
        if (!req.user) return res.status(401).json({ message: 'User not found' });
        next();
    } catch (error) {
        // Log detailed token verification errors for local debugging (mask token)
        try {
            const masked = token ? `${String(token).slice(0,6)}...${String(token).slice(-6)}` : '<no-token>';
            console.error('Auth middleware JWT verify failed:', { maskedToken: masked, error: error && error.message });
        } catch (lgErr) {
            console.error('Auth middleware verify error (failed to log token):', error && error.message);
        }
        res.status(401).json({ message: 'Unauthorized', error: error.message });
    }
};

const logoutUser = async (req, res) => {
    try {
        // Remove refresh token (if present) and clear cookie
        const refreshToken = readCookie(req, 'refreshToken');
        if (refreshToken) {
            try {
                const user = await User.findOne({ refreshTokens: refreshToken });
                if (user) {
                    user.refreshTokens = (user.refreshTokens || []).filter(t => t !== refreshToken);
                    await user.save();
                }
            } catch (e) {
                console.warn('Failed to remove refresh token on logout:', e && e.message ? e.message : e);
            }
        }
        res.clearCookie('refreshToken');
        res.clearCookie('token');
            // Clear cookies with matching attributes to ensure proper removal in cross-site contexts
            try {
                res.clearCookie('refreshToken', { path: '/', sameSite: 'none', secure: true });
            } catch (e) {
                res.clearCookie('refreshToken');
            }
            try {
                res.clearCookie('token', { path: '/', sameSite: 'none', secure: true });
            } catch (e) {
                res.clearCookie('token');
            }
        res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error: error.message });
    }
};

// Refresh access token using refresh token cookie
const refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = readCookie(req, 'refreshToken');
        if (!refreshToken) return res.status(401).json({ message: 'No refresh token' });

        const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev_refresh_secret';
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, refreshSecret);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid refresh token', error: err.message });
        }

        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ message: 'User not found' });

        // Check that this refresh token is still valid (in user's list)
        if (!user.refreshTokens || !user.refreshTokens.includes(refreshToken)) {
            return res.status(401).json({ message: 'Refresh token revoked' });
        }

        // Issue new access token (and rotate refresh token)
        const newAccessToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: process.env.ACCESS_EXPIRES_IN || '1h' });

        // Rotate refresh token: remove old, add new
        const newRefreshToken = jwt.sign({ id: user._id }, refreshSecret, { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' });
        user.refreshTokens = (user.refreshTokens || []).filter(t => t !== refreshToken);
        user.refreshTokens.push(newRefreshToken);
        await user.save();

        // Set cookie
                try {
                    const isProd = process.env.NODE_ENV === 'production';
                    const forceSecure = isProd || String(process.env.FORCE_SECURE_COOKIES || '').toLowerCase() === 'true';
                    const cookieOpts = { httpOnly: true, sameSite: forceSecure ? 'none' : 'lax', secure: !!forceSecure };
                    if (process.env.COOKIE_DOMAIN) cookieOpts.domain = process.env.COOKIE_DOMAIN;
                    res.cookie('refreshToken', newRefreshToken, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' });
                } catch (e) {
                    console.warn('Failed to set new refresh token cookie:', e && e.message ? e.message : e);
                }

        return res.status(200).json({ success: true, token: newAccessToken, user: { _id: user._id, username: user.username, email: user.email, role: user.role } });
    } catch (error) {
        console.error('Refresh token error:', error);
        return res.status(500).json({ message: 'Failed to refresh token', error: error.message });
    }
};



function uploadBufferToCloudinary(buffer, folder = 'rentify/profiles') {
    return new Promise((resolve, reject) => {
        try {
            const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
            streamifier.createReadStream(buffer).pipe(stream);
        } catch (err) {
            reject(err);
        }
    });
}

const uploadProfilePicture = async (req, res) => {
    try {
        // Accept userId from params (`userId` or `id`) or fallback to authenticated user
        const userId = req.params.userId || req.params.id || (req.user && req.user._id);
        let { imageUrl } = req.body;

        // If files were uploaded (single-step flow), upload the first file to Cloudinary
        if (req.files && req.files.length > 0) {
            const file = req.files[0];
            try {
                const result = await uploadBufferToCloudinary(file.buffer, 'rentify/profiles');
                imageUrl = result.secure_url || result.url;
            } catch (err) {
                console.error('Cloudinary upload failed:', err);
                return res.status(500).json({ success: false, message: 'Image upload failed', error: String(err.message || err) });
            }
            
        }

        if (!imageUrl) {
            return res.status(400).json({ 
                success: false,
                message: 'Image URL is required' 
            });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { profilePicture: imageUrl },
            { returnDocument: 'after' }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }

        res.status(200).json({ success: true, message: 'Profile picture updated successfully', user });
    } catch (error) {
        console.error('Upload profile picture error:', error);
        res.status(500).json({ success: false, message: 'Error updating profile picture', error: error.message });
    }
};



const getUserById = async (req, res) => {
    try {
        // Accept `userId` or `id` param; fallback to authenticated user
        const userId = req.params.userId || req.params.id || (req.user && req.user._id);

        if (!userId) {
            return res.status(400).json({ 
                success: false,
                message: 'User ID is required' 
            });
        }

        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }

        res.status(200).json({ 
            success: true,
            user 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            message: 'Error fetching user', 
            error: error.message 
        });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.status(200).json({ 
            success: true,
            count: users.length,
            users 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            message: 'Error fetching users', 
            error: error.message 
        });
    }
};

module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    authMiddleware,
    uploadProfilePicture,
    getUserById,
    getAllUsers
};
