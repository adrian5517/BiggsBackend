const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');


const {registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    uploadProfilePicture,
    getUserById,
    getAllUsers,
    debugGetRefreshTokens } = require('../controllers/authController');

//Registration Routesss
router.post('/register', registerUser);
//Login Route
router.post('/login',loginUser);
//Logout Route - allow unauthenticated requests so clients can clear refresh cookies even when access token expired
router.post('/logout', logoutUser);
//Refresh Token Route
router.post('/refresh-token', refreshAccessToken);
// Dev debug: list masked refresh tokens for identifier
router.get('/debug/refresh-tokens', debugGetRefreshTokens);
//Profile Picture Upload Route
router.post('/profile-picture', authMiddleware.protect, upload.single('profilePicture'), uploadProfilePicture);
//Get Users by ID Route
router.get('/users/:id', authMiddleware.protect, getUserById);
//Get ALl Users Route
router.get('/users', authMiddleware.protect, getAllUsers);

module.exports = router;


