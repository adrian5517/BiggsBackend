exports.requireAdmin = (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin role required' });
    return next();
  } catch (e) {
    return res.status(500).json({ message: 'Server error' });
  }
};
