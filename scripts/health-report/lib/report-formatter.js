function generateReport(clientResults, reportDate) {
  const dateStr = reportDate.toISOString().split('T')[0];

  const sections = clientResults.map((client) => renderClientSection(client)).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>DocSplit 健全性レポート - ${dateStr}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #333; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
    h2 { color: #333; margin-top: 32px; padding: 8px 12px; background: #e8f0fe; border-radius: 4px; }
    .card-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
    .card { padding: 12px 16px; border-radius: 8px; background: #fff; border: 1px solid #ddd; min-width: 100px; text-align: center; }
    .card .label { font-size: 12px; color: #666; }
    .card .value { font-size: 24px; font-weight: bold; margin-top: 4px; }
    .card.ok { border-left: 4px solid #34a853; }
    .card.warn { border-left: 4px solid #fbbc04; }
    .card.error { border-left: 4px solid #ea4335; background: #fce8e6; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f8f9fa; font-weight: 600; }
    .status-active { color: #34a853; font-weight: bold; }
    .status-error { color: #ea4335; font-weight: bold; }
    .env-error { padding: 16px; background: #fce8e6; border: 1px solid #ea4335; border-radius: 8px; margin: 12px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DocSplit 健全性レポート</h1>
    <p>${dateStr} 09:00 JST</p>
    ${sections}
    <div class="footer">
      DocSplit 健全性レポートシステムにより自動生成
    </div>
  </div>
</body>
</html>`;
}

function renderClientSection(client) {
  if (client.error) {
    return `
    <h2>${escapeHtml(client.name)} (${escapeHtml(client.projectId)})</h2>
    <div class="env-error">アクセスエラー: ${escapeHtml(client.error)}</div>`;
  }

  const { gcp, firestore } = client.data;
  let html = `<h2>${escapeHtml(client.name)} (${escapeHtml(client.projectId)})</h2>`;

  // Cloud Functions
  html += renderFunctions(gcp.functions);

  // Cloud Scheduler
  html += renderScheduler(gcp.schedulerJobs);

  // Documents
  html += renderDocumentStats(firestore.documentStats);

  // Error Documents
  html += renderErrorDocuments(firestore.errorDocuments);

  // Storage
  html += renderStorage(gcp.storageSize);

  return html;
}

function renderFunctions(data) {
  if (data.error) {
    return `<h3>Cloud Functions</h3><div class="env-error">${escapeHtml(data.error)}</div>`;
  }

  const allActive = data.active === data.total;
  const cardClass = allActive ? 'ok' : 'error';

  let html = `<h3>Cloud Functions</h3>
  <div class="card-row">
    <div class="card ${cardClass}">
      <div class="label">稼働状況</div>
      <div class="value">${data.active}/${data.total} 稼働中</div>
    </div>
  </div>`;

  if (data.inactive.length > 0) {
    html += `<table><tr><th>関数名</th><th>状態</th></tr>`;
    for (const fn of data.inactive) {
      html += `<tr><td>${escapeHtml(fn.name)}</td><td class="status-error">${escapeHtml(fn.state)}</td></tr>`;
    }
    html += `</table>`;
  }

  return html;
}

function renderScheduler(data) {
  if (data.error) {
    return `<h3>Cloud Scheduler</h3><div class="env-error">${escapeHtml(data.error)}</div>`;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return `<h3>Cloud Scheduler</h3><p>スケジューラジョブが見つかりません。</p>`;
  }

  let html = `<h3>Cloud Scheduler</h3>
  <table>
    <tr><th>ジョブ名</th><th>スケジュール</th><th>最終実行</th><th>状態</th></tr>`;

  for (const job of data) {
    const stateClass = job.state === 'ENABLED' ? 'status-active' : 'status-error';
    const lastRun = job.lastAttemptTime ? formatDateTime(job.lastAttemptTime) : '-';
    html += `<tr>
      <td>${escapeHtml(job.name)}</td>
      <td>${escapeHtml(job.schedule)}</td>
      <td>${escapeHtml(lastRun)}</td>
      <td class="${stateClass}">${escapeHtml(job.state)}</td>
    </tr>`;
  }

  html += `</table>`;
  return html;
}

function renderDocumentStats(stats) {
  if (typeof stats.error === 'string') {
    return `<h3>書類</h3><div class="env-error">${escapeHtml(stats.error)}</div>`;
  }

  const entries = [
    { label: '処理済み', key: 'processed', type: 'ok' },
    { label: '待機中', key: 'pending', type: 'warn' },
    { label: '処理中', key: 'processing', type: 'warn' },
    { label: 'エラー', key: 'error', type: 'error' },
    { label: '分割済み', key: 'split', type: 'ok' },
  ];

  let html = `<h3>書類</h3><div class="card-row">`;
  for (const entry of entries) {
    const value = stats[entry.key] ?? '?';
    const isUnknown = typeof value !== 'number';
    const cardClass = isUnknown ? 'warn'
      : (entry.type === 'error' && value > 0) ? 'error'
      : (entry.type === 'warn' && value > 0) ? 'warn'
      : 'ok';
    html += `<div class="card ${cardClass}">
      <div class="label">${entry.label}</div>
      <div class="value">${value}</div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function renderErrorDocuments(errors) {
  if (!errors || errors.length === 0) return '';

  let html = `<h3>エラー書類（直近 ${errors.length} 件）</h3>
  <table>
    <tr><th>ファイル名</th><th>エラー内容</th></tr>`;

  for (const err of errors) {
    html += `<tr>
      <td>${escapeHtml(err.fileName)}</td>
      <td>${escapeHtml(err.errorMessage)}</td>
    </tr>`;
  }

  html += `</table>`;
  return html;
}

function renderStorage(size) {
  return `<h3>ストレージ</h3>
  <div class="card-row">
    <div class="card ok">
      <div class="label">合計容量</div>
      <div class="value">${escapeHtml(size || 'N/A')}</div>
    </div>
  </div>`;
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  } catch {
    return '-';
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { generateReport };
