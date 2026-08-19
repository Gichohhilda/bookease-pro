const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, queryOne } = require('../config/db');
const { authenticate } = require('../middleware/auth');

//  All specific/named routes MUST come before /:id routes 

// GET all providers (public)
router.get('/', async (req, res) => {
    try {
        const { category, search } = req.query;
        let where = 'WHERE p.is_active = 1 AND p.is_verified = 1';
        const params = [];
        if (category) {
            where += ' AND p.category = ?';
            params.push(category);
        }
        if (search) {
            where += ' AND (p.business_name LIKE ? OR p.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        const providers = await query(
            `SELECT p.id, p.business_name, p.description, p.category, p.phone,
                    p.working_hours_start, p.working_hours_end,
                    COUNT(DISTINCT s.id) as service_count,
                    COUNT(DISTINCT a.id) as total_bookings
             FROM providers p
             LEFT JOIN service_types s ON p.id = s.provider_id AND s.is_active = 1
             LEFT JOIN appointments a ON p.id = a.provider_id AND a.status = 'completed'
             ${where}
             GROUP BY p.id
             ORDER BY total_bookings DESC`,
            params
        );
        res.json({ success: true, providers });
    } catch (err) {
        console.error('Providers fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch providers.' });
    }
});

// GET authenticated provider's own services
router.get('/services/mine', authenticate, async (req, res) => {
    try {
        const services = await query(
            'SELECT * FROM service_types WHERE provider_id = ? ORDER BY created_at DESC',
            [req.provider.id]
        );
        res.json({ success: true, services });
    } catch (err) {
        console.error('Services fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch services.' });
    }
});

// POST create a new service
router.post('/services', authenticate, async (req, res) => {
    try {
        const { name, description, duration_minutes, price, color } = req.body;
        if (!name || !duration_minutes) {
            return res.status(400).json({ success: false, message: 'Name and duration required.' });
        }
        const id = uuidv4();
        await query(
            'INSERT INTO service_types (id, provider_id, name, description, duration_minutes, price, color) VALUES (?,?,?,?,?,?,?)',
            [id, req.provider.id, name, description || '', duration_minutes, price || 0, color || '#6366f1']
        );
        res.status(201).json({ success: true, message: 'Service created.', id });
    } catch (err) {
        console.error('Service create error:', err);
        res.status(500).json({ success: false, message: 'Failed to create service.' });
    }
});

// PUT update a service
router.put('/services/:id', authenticate, async (req, res) => {
    try {
        const { name, description, duration_minutes, price, color, is_active } = req.body;
        await query(
            `UPDATE service_types
             SET name=?, description=?, duration_minutes=?, price=?, color=?, is_active=?
             WHERE id=? AND provider_id=?`,
            [name, description, duration_minutes, price, color, is_active, req.params.id, req.provider.id]
        );
        res.json({ success: true, message: 'Service updated.' });
    } catch (err) {
        console.error('Service update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update service.' });
    }
});

// DELETE (soft) a service
router.delete('/services/:id', authenticate, async (req, res) => {
    try {
        await query(
            'UPDATE service_types SET is_active = 0 WHERE id = ? AND provider_id = ?',
            [req.params.id, req.provider.id]
        );
        res.json({ success: true, message: 'Service removed.' });
    } catch (err) {
        console.error('Service delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to remove service.' });
    }
});

// GET authenticated provider's availability
router.get('/availability/mine', authenticate, async (req, res) => {
    try {
        const slots = await query(
            'SELECT * FROM availability_slots WHERE provider_id = ? ORDER BY day_of_week',
            [req.provider.id]
        );
        res.json({ success: true, slots });
    } catch (err) {
        console.error('Availability fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch availability.' });
    }
});

// POST save availability slots (replaces all existing)
router.post('/availability', authenticate, async (req, res) => {
    try {
        const { slots } = req.body;
        if (!Array.isArray(slots)) {
            return res.status(400).json({ success: false, message: 'Slots must be an array.' });
        }
        await query('DELETE FROM availability_slots WHERE provider_id = ?', [req.provider.id]);
        for (const slot of slots) {
            await query(
                'INSERT INTO availability_slots (id, provider_id, day_of_week, start_time, end_time, is_available) VALUES (?,?,?,?,?,?)',
                [uuidv4(), req.provider.id, slot.day_of_week, slot.start_time, slot.end_time, slot.is_available ? 1 : 0]
            );
        }
        res.json({ success: true, message: 'Availability updated.' });
    } catch (err) {
        console.error('Availability update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update availability.' });
    }
});

// POST block a date
router.post('/blocked-dates', authenticate, async (req, res) => {
    try {
        const { blocked_date, reason } = req.body;
        if (!blocked_date) {
            return res.status(400).json({ success: false, message: 'blocked_date is required.' });
        }
        await query(
            `INSERT INTO blocked_dates (id, provider_id, blocked_date, reason)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE reason=?`,
            [uuidv4(), req.provider.id, blocked_date, reason || null, reason || null]
        );
        res.json({ success: true, message: 'Date blocked.' });
    } catch (err) {
        console.error('Block date error:', err);
        res.status(500).json({ success: false, message: 'Failed to block date.' });
    }
});

// DELETE unblock a date
router.delete('/blocked-dates/:date', authenticate, async (req, res) => {
    try {
        await query(
            'DELETE FROM blocked_dates WHERE provider_id = ? AND blocked_date = ?',
            [req.provider.id, req.params.date]
        );
        res.json({ success: true, message: 'Date unblocked.' });
    } catch (err) {
        console.error('Unblock date error:', err);
        res.status(500).json({ success: false, message: 'Failed to unblock date.' });
    }
});

//  Wildcard /:id route LAST to avoid swallowing named routes above 

// GET public provider profile (must be last)
router.get('/:id/public', async (req, res) => {
    try {
        const provider = await queryOne(
            `SELECT id, business_name, description, category, phone,
                    working_hours_start, working_hours_end
             FROM providers WHERE id = ? AND is_active = 1`,
            [req.params.id]
        );
        if (!provider) {
            return res.status(404).json({ success: false, message: 'Provider not found.' });
        }
        const services = await query(
            'SELECT * FROM service_types WHERE provider_id = ? AND is_active = 1',
            [req.params.id]
        );
        const availability = await query(
            'SELECT day_of_week, start_time, end_time FROM availability_slots WHERE provider_id = ? AND is_available = 1',
            [req.params.id]
        );
        res.json({ success: true, provider, services, availability });
    } catch (err) {
        console.error('Provider public fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch provider.' });
    }
});

module.exports = router;
