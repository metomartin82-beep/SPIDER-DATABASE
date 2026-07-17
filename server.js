require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: 'Too many requests, slow down.' });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many auth attempts, try again later.' });

app.use('/api', limiter);
app.use('/api/auth', authLimiter, authRoutes);

app.get('/api', (req, res) => {
  res.json({ status: 'SpiderDB engine is running 🕸', version: require('./package.json').version });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong' });
});

(async () => {
  try {
    await initDB();
    app.listen(PORT, () => console.log(`🕸 SpiderDB engine running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  }
})();
