const nodemailer = require('nodemailer');

async function sendReport(htmlContent, options) {
  const { smtpUser, smtpPass, from, to, subject, dryRun } = options;

  if (dryRun) {
    console.log('[DRY_RUN] Mail sending skipped.');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    html: htmlContent,
  });

  console.log(`Mail sent to ${to}`);
}

module.exports = { sendReport };
