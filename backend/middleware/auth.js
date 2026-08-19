const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/db');
require('dotenv').config();

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const provider = await queryOne(
            'SELECT id, email, business_name, is_active FROM providers WHERE id = ?',
            [decoded.id]
        );
        if (!provider) {
            return res.status(401).json({ success: false, message: 'Provider not found.' });
        }
        if (!provider.is_active) {
            return res.status(401).json({ success: false, message: 'Account deactivated.' });
        }
        req.provider = provider;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
        }
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
};

module.exports = { authenticate };
