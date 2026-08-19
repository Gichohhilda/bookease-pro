const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/summary', authenticate, async (req, res) => {
    try {
        const id = req.provider.id;
        const today = new Date().toISOString().split('T')[0];
        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        const monthStart = firstOfMonth.toISOString().split('T')[0];

        const [todayRow] = await query(
            `SELECT COUNT(*) as count FROM appointments
             WHERE provider_id=? AND appointment_date=? AND status NOT IN ('cancelled')`,
            [id, today]
        );
        const [monthRow] = await query(
            `SELECT COUNT(*) as count FROM appointments
             WHERE provider_id=? AND appointment_date>=? AND status NOT IN ('cancelled')`,
            [id, monthStart]
        );
        const [totalRow] = await query(
            `SELECT COUNT(*) as count FROM appointments WHERE provider_id=?`,
            [id]
        );
        const [revenueRow] = await query(
            `SELECT COALESCE(SUM(price_charged),0) as total FROM appointments
             WHERE provider_id=? AND status='completed' AND appointment_date>=?`,
            [id, monthStart]
        );
        const [noShowRow] = await query(
            `SELECT COUNT(*) as count FROM appointments
             WHERE provider_id=? AND status='no_show' AND appointment_date>=?`,
            [id, monthStart]
        );
        const [completedRow] = await query(
            `SELECT COUNT(*) as count FROM appointments
             WHERE provider_id=? AND status='completed' AND appointment_date>=?`,
            [id, monthStart]
        );
        const [pendingRow] = await query(
            `SELECT COUNT(*) as count FROM appointments
             WHERE provider_id=? AND status='confirmed' AND appointment_date>=?`,
            [id, today]
        );

        res.json({
            success: true,
            summary: {
                today_appointments: todayRow.count,
                month_appointments: monthRow.count,
                total_appointments: totalRow.count,
                month_revenue: parseFloat(revenueRow.total),
                no_show_count: noShowRow.count,
                completed_count: completedRow.count,
                pending_count: pendingRow.count
            }
        });
    } catch (err) {
        console.error('Summary error:', err);
        res.status(500).json({ success: false, message: 'Failed to load summary.' });
    }
});

router.get('/bookings-by-day', authenticate, async (req, res) => {
    try {
        const data = await query(
            `SELECT appointment_date as date,
                    COUNT(*) as count,
                    SUM(CASE WHEN status='completed' THEN price_charged ELSE 0 END) as revenue
             FROM appointments
             WHERE provider_id=? AND appointment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             GROUP BY appointment_date
             ORDER BY appointment_date ASC`,
            [req.provider.id]
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error('Bookings by day error:', err);
        res.status(500).json({ success: false, message: 'Failed to load chart data.' });
    }
});

router.get('/by-service', authenticate, async (req, res) => {
    try {
        const data = await query(
            `SELECT s.name as service_name, s.color,
                    COUNT(a.id) as count,
                    SUM(CASE WHEN a.status='completed' THEN a.price_charged ELSE 0 END) as revenue
             FROM appointments a
             JOIN service_types s ON a.service_type_id = s.id
             WHERE a.provider_id=?
             GROUP BY a.service_type_id, s.name, s.color
             ORDER BY count DESC`,
            [req.provider.id]
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error('By service error:', err);
        res.status(500).json({ success: false, message: 'Failed to load service data.' });
    }
});

router.get('/status-breakdown', authenticate, async (req, res) => {
    try {
        const data = await query(
            `SELECT status, COUNT(*) as count FROM appointments WHERE provider_id=? GROUP BY status`,
            [req.provider.id]
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error('Status breakdown error:', err);
        res.status(500).json({ success: false, message: 'Failed to load status data.' });
    }
});

router.get('/top-clients', authenticate, async (req, res) => {
    try {
        const data = await query(
            `SELECT c.name, c.email, c.phone,
                    COUNT(a.id) as bookings,
                    SUM(CASE WHEN a.status='completed' THEN a.price_charged ELSE 0 END) as total_spent
             FROM appointments a
             JOIN clients c ON a.client_id = c.id
             WHERE a.provider_id=?
             GROUP BY c.id, c.name, c.email, c.phone
             ORDER BY bookings DESC
             LIMIT 10`,
            [req.provider.id]
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error('Top clients error:', err);
        res.status(500).json({ success: false, message: 'Failed to load top clients.' });
    }
});

router.get('/monthly-revenue', authenticate, async (req, res) => {
    try {
        const data = await query(
            `SELECT DATE_FORMAT(appointment_date,'%Y-%m') as month,
                    COUNT(*) as appointments,
                    SUM(CASE WHEN status='completed' THEN price_charged ELSE 0 END) as revenue
             FROM appointments
             WHERE provider_id=?
             GROUP BY month
             ORDER BY month DESC
             LIMIT 12`,
            [req.provider.id]
        );
        res.json({ success: true, data: data.reverse() });
    } catch (err) {
        console.error('Monthly revenue error:', err);
        res.status(500).json({ success: false, message: 'Failed to load revenue.' });
    }
});

module.exports = router;
