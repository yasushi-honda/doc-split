#!/usr/bin/env node
/**
 * DocSplit Health Report Generator
 *
 * Usage:
 *   CLIENT_PROJECTS=cocoro:docsplit-cocoro,kanameone:docsplit-kanameone node generate-report.js
 *   DRY_RUN=true node generate-report.js
 *
 * Environment variables:
 *   CLIENT_PROJECTS         - comma-separated name:projectId pairs
 *   HEALTH_REPORT_SMTP_USER - Gmail SMTP user
 *   HEALTH_REPORT_SMTP_PASS - Gmail app password
 *   HEALTH_REPORT_TO        - recipient email
 *   HEALTH_REPORT_FROM      - sender display (e.g. "DocSplit <x@gmail.com>")
 *   DRY_RUN                 - skip email sending if "true"
 */

const fs = require('fs');
const path = require('path');
const gcpCollector = require('./lib/gcp-collector');
const firestoreCollector = require('./lib/firestore-collector');
const { generateReport } = require('./lib/report-formatter');
const { sendReport } = require('./lib/mailer');

function parseClientProjects(envValue) {
  if (!envValue) {
    console.error('CLIENT_PROJECTS environment variable is required.');
    console.error('Format: name1:projectId1,name2:projectId2');
    process.exit(1);
  }

  return envValue.split(',').map((pair) => {
    const [name, projectId] = pair.trim().split(':');
    if (!name || !projectId) {
      console.error(`Invalid CLIENT_PROJECTS entry: "${pair}"`);
      process.exit(1);
    }
    return { name, projectId };
  });
}

async function collectClientData(client) {
  console.log(`Collecting data for ${client.name} (${client.projectId})...`);

  try {
    const [gcp, firestore] = await Promise.all([
      gcpCollector.collectAll(client.projectId),
      firestoreCollector.collectAll(client.projectId),
    ]);

    console.log(`  ${client.name}: OK`);
    return { name: client.name, projectId: client.projectId, data: { gcp, firestore } };
  } catch (err) {
    console.error(`  ${client.name}: ERROR - ${err.message}`);
    return { name: client.name, projectId: client.projectId, error: err.message };
  }
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';
  const clients = parseClientProjects(process.env.CLIENT_PROJECTS);

  console.log(`=== DocSplit Health Report ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Targets: ${clients.map((c) => c.name).join(', ')}`);
  console.log('');

  // Collect data from all clients (sequentially to avoid gcloud conflicts)
  const results = [];
  for (const client of clients) {
    const result = await collectClientData(client);
    results.push(result);
  }

  // Generate HTML report
  const reportDate = new Date();
  const html = generateReport(results, reportDate);

  // Save report to file
  const outputDir = process.env.REPORT_OUTPUT_DIR || path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const dateStr = reportDate.toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `health-report-${dateStr}.html`);
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`\nReport saved: ${outputPath}`);

  // Send email
  const smtpUser = process.env.HEALTH_REPORT_SMTP_USER;
  const smtpPass = process.env.HEALTH_REPORT_SMTP_PASS;
  const to = process.env.HEALTH_REPORT_TO;
  const from = process.env.HEALTH_REPORT_FROM;

  if (!smtpUser || !smtpPass || !to || !from) {
    if (!dryRun) {
      console.error('Missing email configuration. Set HEALTH_REPORT_SMTP_USER, HEALTH_REPORT_SMTP_PASS, HEALTH_REPORT_TO, HEALTH_REPORT_FROM.');
      firestoreCollector.cleanup();
      process.exit(1);
    }
    console.log('[DRY_RUN] Email config not set, skipping.');
  } else {
    const subject = `[DocSplit] Health Report - ${dateStr}`;
    await sendReport(html, { smtpUser, smtpPass, from, to, subject, dryRun });
  }

  // Cleanup firebase-admin apps
  firestoreCollector.cleanup();

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  firestoreCollector.cleanup();
  process.exit(1);
});
