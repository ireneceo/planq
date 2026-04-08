const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('SMTP not configured. Email sending disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  return transporter;
};

const sendEmail = async ({ to, subject, html }) => {
  const transport = getTransporter();
  if (!transport) {
    console.warn(`Email skipped (no SMTP): to=${to}, subject=${subject}`);
    return false;
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@planq.kr',
      to,
      subject,
      html
    });
    return true;
  } catch (error) {
    console.error('Email send failed:', error.message);
    return false;
  }
};

module.exports = { sendEmail };
