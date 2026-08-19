const nodemailer = require('nodemailer');
const { query } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false }
});

const emailWrapper = (title, content) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#f0f4ff}
.container{max-width:600px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.12)}
.header{background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center}
.header h1{color:white;font-size:24px;font-weight:700}
.header p{color:rgba(255,255,255,0.85);margin-top:4px;font-size:14px}
.body{padding:40px}
.body h2{color:#1e1b4b;font-size:20px;margin-bottom:16px}
.body p{color:#4b5563;font-size:15px;line-height:1.7;margin-bottom:12px}
.info-card{background:#f5f3ff;border-left:4px solid #6366f1;border-radius:8px;padding:20px;margin:20px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e9e7f0}
.row:last-child{border-bottom:none}
.label{color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase}
.value{color:#1e1b4b;font-size:14px;font-weight:600}
.reference{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 20px;text-align:center;font-family:monospace;font-size:18px;font-weight:700;color:#92400e;letter-spacing:2px;margin:16px 0}
.footer{background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb}
.footer p{color:#9ca3af;font-size:12px}
</style>
</head>
<body>
<div class="container">
<div class="header">
  <h1>BookEase Pro</h1>
  <p>Virtual Availability and Booking System</p>
</div>
<div class="body">${content}</div>
<div class="footer">
  <p>&copy; ${new Date().getFullYear()} BookEase Pro | Mount Kenya University</p>
  <p>This is an automated message. Do not reply.</p>
</div>
</div>
</body>
</html>`;

async function sendBookingConfirmation(appointment, client, provider, serviceType) {
    const content = `
        <h2>Booking Confirmed</h2>
        <p>Dear <strong>${client.name}</strong>, your appointment has been successfully booked.</p>
        <div class="reference">${appointment.booking_reference}</div>
        <p>Save this reference number to reschedule or cancel.</p>
        <div class="info-card">
            <div class="row"><span class="label">Service</span><span class="value">${serviceType.name}</span></div>
            <div class="row"><span class="label">Provider</span><span class="value">${provider.business_name}</span></div>
            <div class="row"><span class="label">Date</span><span class="value">${new Date(appointment.appointment_date).toDateString()}</span></div>
            <div class="row"><span class="label">Time</span><span class="value">${appointment.start_time} - ${appointment.end_time}</span></div>
            <div class="row"><span class="label">Price</span><span class="value">KES ${parseFloat(appointment.price_charged).toLocaleString()}</span></div>
        </div>`;
    await sendEmail(
        client.email,
        `Appointment Confirmed - ${appointment.booking_reference}`,
        emailWrapper('Booking Confirmed', content)
    );
    await logNotification(appointment.id, client.email, null, 'email', 'booking_confirmation');
}

async function sendReminder48h(appointment, client, serviceType, provider) {
    const content = `
        <h2>Appointment Reminder - Tomorrow</h2>
        <p>Dear <strong>${client.name}</strong>, your appointment is <strong>tomorrow</strong>.</p>
        <div class="info-card">
            <div class="row"><span class="label">Reference</span><span class="value">${appointment.booking_reference}</span></div>
            <div class="row"><span class="label">Service</span><span class="value">${serviceType.name}</span></div>
            <div class="row"><span class="label">Provider</span><span class="value">${provider.business_name}</span></div>
            <div class="row"><span class="label">Time</span><span class="value">${appointment.start_time}</span></div>
        </div>`;
    await sendEmail(
        client.email,
        `Reminder: Appointment Tomorrow - ${appointment.booking_reference}`,
        emailWrapper('48-Hour Reminder', content)
    );
    await logNotification(appointment.id, client.email, null, 'email', 'reminder_48h');
}

async function sendReminder4h(appointment, client, serviceType, provider) {
    const content = `
        <h2>Appointment in 4 Hours</h2>
        <p>Dear <strong>${client.name}</strong>, your appointment starts in approximately <strong>4 hours</strong>.</p>
        <div class="info-card">
            <div class="row"><span class="label">Time</span><span class="value">${appointment.start_time} TODAY</span></div>
            <div class="row"><span class="label">Service</span><span class="value">${serviceType.name}</span></div>
            <div class="row"><span class="label">Provider</span><span class="value">${provider.business_name}</span></div>
            <div class="row"><span class="label">Contact</span><span class="value">${provider.phone}</span></div>
        </div>`;
    await sendEmail(
        client.email,
        `Today's Appointment - ${appointment.booking_reference}`,
        emailWrapper('4-Hour Reminder', content)
    );
    await logNotification(appointment.id, client.email, null, 'email', 'reminder_4h');
}

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: `"BookEase Pro" <${process.env.EMAIL_FROM}>`,
            to,
            subject,
            html
        });
        console.log('Email sent to ' + to);
        return true;
    } catch (error) {
        console.error('Email failed:', error.message);
        return false;
    }
}

async function logNotification(appointmentId, email, phone, type, event) {
    try {
        await query(
            `INSERT INTO notifications (id, appointment_id, recipient_email, recipient_phone, notification_type, notification_event, status, sent_at)
             VALUES (?,?,?,?,?,?,'sent',NOW())`,
            [uuidv4(), appointmentId, email, phone, type, event]
        );
    } catch (err) {
        console.error('Log notification error:', err.message);
    }
}

module.exports = { sendBookingConfirmation, sendReminder48h, sendReminder4h, sendEmail };
