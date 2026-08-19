const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne } = require('../config/db');
const { authenticate } = require('../middleware/auth');
require('dotenv').config();

router.post('/register', async (req, res) => {
    try {
        const { business_name, email, phone, password, description, category } = req.body;
        if (!business_name || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
        }
        const existing = await queryOne('SELECT id FROM providers WHERE email = ?', [email]);
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }
        const password_hash = await bcrypt.hash(password, 12);
        const id = uuidv4();
        await query(
            `INSERT INTO providers (id, business_name, email, phone, password_hash, description, category, is_verified)
             VALUES (?,?,?,?,?,?,?,1)`,
            [id, business_name, email, phone, password_hash, description || '', category || 'General']
        );
        const days = [1, 2, 3, 4, 5];
        for (const day of days) {
            await query(
                'INSERT INTO availability_slots (id, provider_id, day_of_week, start_time, end_time) VALUES (?,?,?,?,?)',
                [uuidv4(), id, day, '08:00:00', '17:00:00']
            );
        }
        const token = jwt.sign({ id, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
        res.status(201).json({
            success: true,
            message: 'Account created successfully.',
            token,
            provider: { id, business_name, email, phone, category }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed.' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required.' });
        }
        const provider = await queryOne('SELECT * FROM providers WHERE email = ?', [email]);
        if (!provider) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        const valid = await bcrypt.compare(password, provider.password_hash);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        if (!provider.is_active) {
            return res.status(401).json({ success: false, message: 'Account deactivated.' });
        }
        const token = jwt.sign(
            { id: provider.id, email: provider.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
        res.json({
            success: true,
            token,
            provider: {
                id: provider.id,
                business_name: provider.business_name,
                email: provider.email,
                phone: provider.phone,
                category: provider.category
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Login failed.' });
    }
});

router.get('/profile', authenticate, async (req, res) => {
    try {
        const provider = await queryOne(
            `SELECT id, business_name, email, phone, description, category,
                    working_hours_start, working_hours_end, buffer_time_minutes
             FROM providers WHERE id = ?`,
            [req.provider.id]
        );
        res.json({ success: true, provider });
    } catch (err) {
        console.error('Profile fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
    }
});

router.put('/profile', authenticate, async (req, res) => {
    try {
        const { business_name, phone, description, category, working_hours_start, working_hours_end, buffer_time_minutes } = req.body;
        await query(
            `UPDATE providers
             SET business_name=?, phone=?, description=?, category=?,
                 working_hours_start=?, working_hours_end=?, buffer_time_minutes=?
             WHERE id=?`,
            [business_name, phone, description, category, working_hours_start, working_hours_end, buffer_time_minutes, req.provider.id]
        );
        res.json({ success: true, message: 'Profile updated.' });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ success: false, message: 'Update failed.' });
    }
});

module.exports = router;