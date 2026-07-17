const jwt = require('jsonwebtoken');
const { db } = require('../db');

const USER_FIELDS = 'id, email, username, is_verified, avatar, role, account_status, created_at';

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await db.execute({
      sql: `SELECT ${USER_FIELDS} FROM users WHERE id = ?`,
      args: [decoded.id]
    });
    if (result.rows.length === 0) return res.status(401).json({ message: 'User not found' });

    const user = result.rows[0];
    if (user.account_status === 'banned') return res.status(403).json({ message: 'Account banned' });
    if (user.account_status === 'suspended') return res.status(403).json({ message: 'Account suspended' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
};

module.exports = { protect, adminOnly };
