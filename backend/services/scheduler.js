const schedule = require('node-schedule');
const { query } = require('../config/db');
const { sendReminder48h, sendReminder4h } = require('./emailService');

function startScheduler() {
    console.log('Reminder scheduler started');
    schedule.scheduleJob('0 * * * *', async () => {
        await send48hReminders();
        await send4hReminders();
    });
    setTimeout(async () => {
        await send48hReminders();
        await send4hReminders();
    }, 5000);
}

async function send48hReminders() {
    try {
        const appointments = await query(`
            SELECT a.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                   s.name as service_name, s.duration_minutes,
                   p.business_name, p.phone as provider_phone
            FROM appointments a
            JOIN clients c ON a.client_id = c.id
            JOIN service_types s ON a.service_type_id = s.id
            JOIN providers p ON a.provider_id = p.id
            WHERE a.status = 'confirmed'
              AND a.reminder_48h_sent = 0
              AND CONCAT(a.appointment_date, ' ', a.start_time)
                  BETWEEN DATE_ADD(NOW(), INTERVAL 44 HOUR)
                      AND DATE_ADD(NOW(), INTERVAL 52 HOUR)
        `);
        for (const appt of appointments) {
            await sendReminder48h(
                appt,
                { name: appt.client_name, email: appt.client_email, phone: appt.client_phone },
                { name: appt.service_name, duration_minutes: appt.duration_minutes },
                { business_name: appt.business_name, phone: appt.provider_phone }
            );
            await query('UPDATE appointments SET reminder_48h_sent = 1 WHERE id = ?', [appt.id]);
        }
    } catch (err) {
        console.error('48h reminder error:', err.message);
    }
}

async function send4hReminders() {
    try {
        const appointments = await query(`
            SELECT a.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                   s.name as service_name, s.duration_minutes,
                   p.business_name, p.phone as provider_phone
            FROM appointments a
            JOIN clients c ON a.client_id = c.id
            JOIN service_types s ON a.service_type_id = s.id
            JOIN providers p ON a.provider_id = p.id
            WHERE a.status = 'confirmed'
              AND a.reminder_4h_sent = 0
              AND CONCAT(a.appointment_date, ' ', a.start_time)
                  BETWEEN DATE_ADD(NOW(), INTERVAL 3 HOUR)
                      AND DATE_ADD(NOW(), INTERVAL 5 HOUR)
        `);
        for (const appt of appointments) {
            await sendReminder4h(
                appt,
                { name: appt.client_name, email: appt.client_email, phone: appt.client_phone },
                { name: appt.service_name, duration_minutes: appt.duration_minutes },
                { business_name: appt.business_name, phone: appt.provider_phone }
            );
            await query('UPDATE appointments SET reminder_4h_sent = 1 WHERE id = ?', [appt.id]);
        }
    } catch (err) {
        console.error('4h reminder error:', err.message);
    }
}

module.exports = { startScheduler };
