const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, getConnection } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { sendBookingConfirmation } = require('../services/emailService');

function generateReference() {
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `BK-${year}-${rand}`;
}

// GET available slots for a provider on a given date
router.get('/slots/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;
        const { date, service_type_id } = req.query;
        if (!date || !service_type_id) {
            return res.status(400).json({ success: false, message: 'Date and service_type_id required.' });
        }

        // Use local date parsing to avoid timezone shift
        const [year, month, day] = date.split('-').map(Number);
        const dayOfWeek = new Date(year, month - 1, day).getDay();

        const availability = await queryOne(
            'SELECT * FROM availability_slots WHERE provider_id = ? AND day_of_week = ? AND is_available = 1',
            [providerId, dayOfWeek]
        );
        if (!availability) {
            return res.json({ success: true, slots: [] });
        }

        const blocked = await queryOne(
            'SELECT id FROM blocked_dates WHERE provider_id = ? AND blocked_date = ?',
            [providerId, date]
        );
        if (blocked) {
            return res.json({ success: true, slots: [] });
        }

        const service = await queryOne(
            'SELECT duration_minutes FROM service_types WHERE id = ? AND is_active = 1',
            [service_type_id]
        );
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found.' });
        }

        const provider = await queryOne(
            'SELECT buffer_time_minutes FROM providers WHERE id = ?',
            [providerId]
        );

        const slotDuration = service.duration_minutes + (provider?.buffer_time_minutes || 0);

        const booked = await query(
            `SELECT start_time, end_time FROM appointments
             WHERE provider_id = ? AND appointment_date = ? AND status NOT IN ('cancelled')`,
            [providerId, date]
        );

        const slots = [];
        const [startH, startM] = availability.start_time.slice(0, 5).split(':').map(Number);
        const [endH, endM] = availability.end_time.slice(0, 5).split(':').map(Number);
        let current = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        while (current + service.duration_minutes <= endMinutes) {
            const slotStart = String(Math.floor(current / 60)).padStart(2, '0') + ':' + String(current % 60).padStart(2, '0');
            const slotEndMin = current + service.duration_minutes;
            const slotEnd = String(Math.floor(slotEndMin / 60)).padStart(2, '0') + ':' + String(slotEndMin % 60).padStart(2, '0');

            const isBooked = booked.some(b => {
                const bStart = b.start_time.slice(0, 5);
                const bEnd = b.end_time.slice(0, 5);
                return slotStart < bEnd && slotEnd > bStart;
            });

            if (!isBooked) {
                slots.push({ start: slotStart, end: slotEnd });
            }
            current += slotDuration;
        }

        res.json({ success: true, slots });
    } catch (err) {
        console.error('Slots error:', err);
        res.status(500).json({ success: false, message: 'Failed to get slots.' });
    }
});

// POST book an appointment
router.post('/book', async (req, res) => {
    const conn = await getConnection();
    try {
        await conn.beginTransaction();

        const {
            provider_id, service_type_id, appointment_date, start_time,
            client_name, client_email, client_phone, client_notes
        } = req.body;

        if (!provider_id || !service_type_id || !appointment_date || !start_time || !client_name || !client_email) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
        }

        const [serviceRows] = await conn.execute(
            'SELECT * FROM service_types WHERE id = ? AND is_active = 1',
            [service_type_id]
        );
        const service = serviceRows[0];
        if (!service) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ success: false, message: 'Service not found.' });
        }

        const [providerRows] = await conn.execute(
            'SELECT * FROM providers WHERE id = ? AND is_active = 1',
            [provider_id]
        );
        const provider = providerRows[0];
        if (!provider) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ success: false, message: 'Provider not found.' });
        }

        const [sh, sm] = start_time.split(':').map(Number);
        const endMinutes = sh * 60 + sm + service.duration_minutes;
        const end_time =
            String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' +
            String(endMinutes % 60).padStart(2, '0');

        const [conflicts] = await conn.execute(
            `SELECT id FROM appointments
             WHERE provider_id = ? AND appointment_date = ?
               AND status NOT IN ('cancelled')
               AND start_time < ? AND end_time > ?`,
            [provider_id, appointment_date, end_time, start_time]
        );
        if (conflicts.length > 0) {
            await conn.rollback();
            conn.release();
            return res.status(409).json({ success: false, message: 'Time slot no longer available.' });
        }

        let client = await queryOne('SELECT * FROM clients WHERE email = ?', [client_email]);
        if (!client) {
            const clientId = uuidv4();
            await conn.execute(
                'INSERT INTO clients (id, name, email, phone) VALUES (?,?,?,?)',
                [clientId, client_name, client_email, client_phone || null]
            );
            client = { id: clientId, name: client_name, email: client_email, phone: client_phone };
        }

        const appointmentId = uuidv4();
        const bookingRef = generateReference();

        await conn.execute(
            `INSERT INTO appointments
             (id, booking_reference, provider_id, service_type_id, client_id,
              appointment_date, start_time, end_time, status, client_notes, price_charged)
             VALUES (?,?,?,?,?,?,?,?,'confirmed',?,?)`,
            [appointmentId, bookingRef, provider_id, service_type_id, client.id,
             appointment_date, start_time, end_time, client_notes || null, service.price]
        );

        await conn.commit();
        conn.release();

        const appointment = {
            id: appointmentId,
            booking_reference: bookingRef,
            appointment_date,
            start_time,
            end_time,
            price_charged: service.price
        };

        sendBookingConfirmation(appointment, client, provider, service).catch(console.error);

        res.status(201).json({
            success: true,
            message: 'Appointment booked successfully.',
            booking_reference: bookingRef,
            appointment: { ...appointment, service_name: service.name }
        });
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('Booking error:', err);
        res.status(500).json({ success: false, message: 'Booking failed.' });
    }
});

// GET all appointments for authenticated provider
router.get('/', authenticate, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        let where = 'WHERE a.provider_id = ?';
        const params = [req.provider.id];
        if (status) {
            where += ' AND a.status = ?';
            params.push(status);
        }
        const appointments = await query(
            `SELECT a.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                    s.name as service_name, s.duration_minutes, s.color as service_color
             FROM appointments a
             JOIN clients c ON a.client_id = c.id
             JOIN service_types s ON a.service_type_id = s.id
             ${where}
             ORDER BY a.appointment_date DESC, a.start_time DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );
        res.json({ success: true, appointments });
    } catch (err) {
        console.error('Appointments fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch appointments.' });
    }
});

// GET today's appointments
router.get('/today', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const appointments = await query(
            `SELECT a.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                    s.name as service_name, s.color as service_color
             FROM appointments a
             JOIN clients c ON a.client_id = c.id
             JOIN service_types s ON a.service_type_id = s.id
             WHERE a.provider_id = ? AND a.appointment_date = ? AND a.status NOT IN ('cancelled')
             ORDER BY a.start_time ASC`,
            [req.provider.id, today]
        );
        res.json({ success: true, appointments, date: today });
    } catch (err) {
        console.error('Today appointments error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch today appointments.' });
    }
});

// PATCH update appointment status
router.patch('/:id/status', authenticate, async (req, res) => {
    try {
        const { status, cancellation_reason, provider_notes } = req.body;
        const validStatuses = ['confirmed', 'completed', 'cancelled', 'no_show'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status.' });
        }
        const result = await query(
            `UPDATE appointments
             SET status=?, cancellation_reason=?, provider_notes=?
             WHERE id=? AND provider_id=?`,
            [status, cancellation_reason || null, provider_notes || null, req.params.id, req.provider.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Appointment not found.' });
        }
        res.json({ success: true, message: `Appointment marked as ${status}.` });
    } catch (err) {
        console.error('Status update error:', err);
        res.status(500).json({ success: false, message: 'Update failed.' });
    }
});

// GET appointment by booking reference (public)
router.get('/reference/:ref', async (req, res) => {
    try {
        const appointment = await queryOne(
            `SELECT a.*, c.name as client_name, c.email as client_email,
                    s.name as service_name, p.business_name, p.phone as provider_phone
             FROM appointments a
             JOIN clients c ON a.client_id = c.id
             JOIN service_types s ON a.service_type_id = s.id
             JOIN providers p ON a.provider_id = p.id
             WHERE a.booking_reference = ?`,
            [req.params.ref]
        );
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }
        res.json({ success: true, appointment });
    } catch (err) {
        console.error('Reference lookup error:', err);
        res.status(500).json({ success: false, message: 'Lookup failed.' });
    }
});

// PATCH cancel by reference (client self-cancel)
router.patch('/cancel/:ref', async (req, res) => {
    try {
        const { client_email } = req.body;
        if (!client_email) {
            return res.status(400).json({ success: false, message: 'client_email is required.' });
        }
        const appointment = await queryOne(
            `SELECT a.* FROM appointments a
             JOIN clients c ON a.client_id = c.id
             WHERE a.booking_reference = ? AND c.email = ?`,
            [req.params.ref, client_email]
        );
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found or email does not match.' });
        }
        if (appointment.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Appointment is already cancelled.' });
        }
        if (appointment.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Cannot cancel a completed appointment.' });
        }
        await query(
            `UPDATE appointments SET status='cancelled', cancellation_reason='Cancelled by client' WHERE id=?`,
            [appointment.id]
        );
        res.json({ success: true, message: 'Appointment cancelled.' });
    } catch (err) {
        console.error('Cancel error:', err);
        res.status(500).json({ success: false, message: 'Cancellation failed.' });
    }
});

module.exports = router;
