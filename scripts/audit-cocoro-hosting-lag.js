#!/usr/bin/env node
/**
 * cocoro Firebase Hosting 未反映検知スクリプト (read-only)
 *
 * cocoro の Hosting デプロイは .github/workflows/deploy-hosting.yml の対象外
 * (VITE_FIREBASE_*_COCORO Secrets 未登録) で、ローカル手動
 * `./scripts/deploy-to-project.sh cocoro` が正規デプロイ経路。このため
 * frontend/ 変更のマージ漏れ検知が構造的にCIの外側にあった。
 *
 * frontend/ への最新マージ済みcommit時刻と、cocoro Hosting の最新release時刻を比較し、
 * 閾値(デフォルト48時間)を超えて反映が遅延している場合に exit 1 する。
 *
 * 使用方法:
 *   GH_TOKEN=<token> node scripts/audit-cocoro-hosting-lag.js [--threshold-hours 48]
 *
 * 前提:
 *   - gh CLI が認証済み (GH_TOKEN or 既存 gh auth login)
 *   - gcloud CLI が docsplit-cocoro 向けに認証済み
 *     (CI: google-github-actions/auth@v2 + secrets.GCP_SA_KEY)
 */

const { execSync } = require('child_process');

const REPO = 'yasushi-honda/doc-split';
const SITE_ID = 'docsplit-cocoro';

function parseThresholdHours(argv) {
  let thresholdHours = 48;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--threshold-hours' && argv[i + 1]) {
      const n = parseInt(argv[i + 1], 10);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`--threshold-hours は非負整数を指定してください (got: ${argv[i + 1]})`);
        process.exit(1);
      }
      thresholdHours = n;
      i++;
    }
  }
  return thresholdHours;
}

function getLatestFrontendCommitTime() {
  const out = execSync(
    `gh api "repos/${REPO}/commits?path=frontend&sha=main&per_page=1" --jq '.[0].commit.committer.date'`,
    { encoding: 'utf8' }
  ).trim();
  if (!out) {
    throw new Error('frontend/ の最新commit取得に失敗しました');
  }
  return new Date(out);
}

async function getLatestCocoroReleaseTime() {
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  const res = await fetch(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE_ID}/releases?pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Firebase Hosting API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const release = data.releases && data.releases[0];
  if (!release) {
    throw new Error('cocoro Hosting のrelease履歴が取得できませんでした');
  }
  return new Date(release.releaseTime);
}

async function main() {
  const thresholdHours = parseThresholdHours(process.argv.slice(2));

  const [commitTime, releaseTime] = await Promise.all([
    Promise.resolve(getLatestFrontendCommitTime()),
    getLatestCocoroReleaseTime(),
  ]);

  const lagHours = (commitTime.getTime() - releaseTime.getTime()) / (1000 * 60 * 60);

  console.log(`frontend/ 最新commit: ${commitTime.toISOString()}`);
  console.log(`cocoro Hosting 最新release: ${releaseTime.toISOString()}`);
  console.log(`lag: ${lagHours.toFixed(1)}時間 (閾値: ${thresholdHours}時間)`);

  if (lagHours > thresholdHours) {
    console.error(
      `cocoro Hosting反映が閾値を超えて遅延しています (${lagHours.toFixed(1)}h > ${thresholdHours}h)`
    );
    process.exit(1);
  }

  console.log('OK: 閾値内です');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
