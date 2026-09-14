#!/usr/bin/env node
/**
 * status=processed の documents を1件だけ status=pending へリセットするスクリプト(ADR-0025)
 *
 * PaddleOCR canary展開(Pass1)で、既にstatus=processedの実顧客文書を対象に
 * 「そのまま再処理させて新しいOCRプロバイダの結果を確認する」ために使う。
 * `scripts/fix-stuck-documents.js`はerror/processing状態専用でこの用途には使えないため、
 * 別スクリプトとして新設する。
 *
 * 安全策:
 *   - status===processedの文書のみ対象(error/pending/processing等は拒否、誤用防止)
 *   - リセット前の全フィールドをバックアップJSON保存(backups/配下)
 *   - 既定はdry-run、--executeで実書込み
 *   - resolveClientName()でscripts/clients/*.envと照合(誤ったプロジェクトへの実行防止)
 *   - L2ゲート(settings/features.paddleOcr + paddleOcrAllowlist)とL1ゲート(processOCR
 *     Functionsの環境変数OCR_PROVIDER、`gcloud functions describe`で実機確認、
 *     roles/cloudfunctions.viewer相当の権限が必要)の両方がpaddleを指していなければ
 *     fail-closed(片方だけOKでは無意味なcanaryになるため)
 *
 * リセット内容は`scripts/reset-documents-by-office.js`と同一の最小フィールドセット
 * (status/retryCount/lastErrorMessage/updatedAt/pass2Promotion削除)。
 * customerId/officeId等の確定済みフィールドは一切変更しない
 * (再処理結果で上書きされるのは`processDocument()`が書き込むフィールドのみ)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/reset-document-to-pending.js \
 *     --doc-id <docId> --dry-run
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/reset-document-to-pending.js \
 *     --doc-id <docId> --execute
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const docId = getArg('--doc-id');
const execute = process.argv.includes('--execute');

if (!docId) {
  console.error('--doc-id <docId> を指定してください');
  process.exit(1);
}

/**
 * scripts/clients/*.env の PROJECT_ID と照合し、対象がどのクライアント環境かを解決する。
 * 一致しない場合は未登録プロジェクトへの誤操作の可能性があるため中断する。
 * (set-feature-flag.js / set-drive-allowlist.js resolveClientName() と同一ロジック)
 */
function resolveClientName(targetProjectId) {
  const clientsDir = path.join(__dirname, 'clients');
  const envFiles = fs.readdirSync(clientsDir).filter((f) => f.endsWith('.env'));
  for (const file of envFiles) {
    const content = fs.readFileSync(path.join(clientsDir, file), 'utf8');
    const m = content.match(/^PROJECT_ID=["']?([^"'\r\n]+)["']?/m);
    if (m && m[1] === targetProjectId) {
      return file.replace(/\.env$/, '');
    }
  }
  return null;
}

const clientName = resolveClientName(projectId);
if (!clientName) {
  console.error(
    `ERROR: FIREBASE_PROJECT_ID="${projectId}" は scripts/clients/*.env のどのPROJECT_IDとも一致しません。`
  );
  console.error('誤ったプロジェクトへの書込みを防ぐため中断します。');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function serializeTimestamps(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
      }
      return value;
    })
  );
}

async function main() {
  console.log(`環境: ${clientName} (project: ${projectId})`);
  console.log(`対象: documents/${docId}`);

  const ref = db.doc(`documents/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`ERROR: documents/${docId} が見つかりません`);
    process.exit(1);
  }

  const data = snap.data();
  if (data.status !== 'processed') {
    console.error(
      `ERROR: status="${data.status}" のため対象外です(processedのみ対象、誤用防止)。` +
        'error/processing状態のリセットは scripts/fix-stuck-documents.js を使用してください。'
    );
    process.exit(1);
  }

  console.log(`現在のstatus: ${data.status} / customerConfirmed: ${data.customerConfirmed} / officeConfirmed: ${data.officeConfirmed}`);
  console.log('→ status: pending へリセットします');

  // ADR-0025 PaddleOCR canary: このスクリプトの唯一の用途はPaddleOCR検証のため、
  // 実際にpaddleへ回るゲート状態(L2フラグ+allowlist)でなければfail-closedする
  // (codex review --strict-config P2指摘: ゲートOFFのままリセットするとGeminiで
  // 静かに再処理が完了し、「canary成功」に見えて実際は新プロバイダを検証していない)。
  const featuresSnap = await db.doc('settings/features').get();
  const featuresData = featuresSnap.data() || {};
  const paddleOcrEnabled = featuresData.paddleOcr === true;
  const allowlist = featuresData.paddleOcrAllowlist;
  // getPaddleOcrGate()(functions/src/utils/featureFlags.ts)と同一のnull/undefined判定に
  // 揃える(codex review strict P2指摘): フィールド自体が存在しない場合のみ無制限、
  // 存在してnull等の非配列値の場合はfail-closedで全docId拒否として扱う(不正形式が
  // 「無制限」と誤読されるとgate未整備のままGeminiへ流れてしまうため)。
  const allowlistFieldPresent = Object.prototype.hasOwnProperty.call(featuresData, 'paddleOcrAllowlist');
  // 全要素がstringであることも要求する(codex review strict P2指摘): getPaddleOcrGate()は
  // 混在型配列(非string要素を含む)もfail-closedで[]扱いにするため、判定を完全一致させる。
  const isValidAllowlist = Array.isArray(allowlist) && allowlist.every((v) => typeof v === 'string');
  const allowlistPermits = !allowlistFieldPresent || (isValidAllowlist && allowlist.includes(docId));
  if (!paddleOcrEnabled || !allowlistPermits) {
    console.error(
      `ERROR: PaddleOCRゲートが未整備です(paddleOcr=${paddleOcrEnabled}, allowlist=${JSON.stringify(allowlist)})。` +
        'このままリセットするとGeminiで再処理が完了し、canaryとして無意味です。' +
        'set-feature-flag --flag paddleOcr --value true / set-paddle-ocr-allowlist --set を先に実行してください。'
    );
    process.exit(1);
  }
  console.log('✓ L2ゲート確認OK(paddleOcr=true、対象docIdはallowlist許可範囲内)');

  // L1(デプロイ済みprocessOCR Functionsの環境変数OCR_PROVIDER)も実機確認する(codex review
  // strict P1指摘: L2がOKでもL1がgemini(デフォルト)のままなら resolveOcrProvider() は
  // 結局geminiを返す。ここが最終防衛線でありfail-loudする(gcloud呼出自体の失敗も許容しない)。
  let deployedProvider;
  try {
    deployedProvider = execFileSync(
      'gcloud',
      [
        'functions',
        'describe',
        'processOCR',
        '--gen2',
        '--region=asia-northeast1',
        `--project=${projectId}`,
        '--format=value(serviceConfig.environmentVariables.OCR_PROVIDER)',
      ],
      { encoding: 'utf8' }
    ).trim();
  } catch (err) {
    console.error(`ERROR: processOCR FunctionsのOCR_PROVIDER確認に失敗しました(gcloud呼出エラー): ${err.message}`);
    console.error('gcloud CLIの認証状態、またはprocessOCR未デプロイの可能性を確認してください。');
    process.exit(1);
  }
  if (deployedProvider !== 'paddle') {
    console.error(
      `ERROR: processOCR FunctionsのL1環境変数 OCR_PROVIDER="${deployedProvider || '(未設定=gemini)'}" です。` +
        'L2ゲートがOKでもL1がpaddleでなければresolveOcrProvider()はgeminiを返します。' +
        '"Deploy Cloud Functions" workflow(ocr_provider_override=paddle)を先に実行してください。'
    );
    process.exit(1);
  }
  console.log('✓ L1ゲート確認OK(processOCR FunctionsのOCR_PROVIDER=paddle)');

  if (!execute) {
    console.log('\nDRY RUN: 書込みは実行しません。--execute で実行してください。');
    return;
  }

  // ADR-0018 Phase D: 分割子ドキュメントは`detail/main.pageResults`にキャッシュ済みOCR結果を
  // 持ちうる。存在する場合、processDocument()のreuse-checkが働きOCRプロバイダ呼出自体を
  // スキップしてしまう(codex review --strict-config P2指摘)。canaryの目的は新プロバイダを
  // 実際に呼び出して検証することなので、対象がpageResultsを保持していれば必ずクリアする。
  const detailRef = db.doc(`documents/${docId}/detail/main`);
  const detailSnap = await detailRef.get();
  const hasCachedPageResults = detailSnap.exists && detailSnap.data()?.pageResults !== undefined;
  if (hasCachedPageResults) {
    console.log('detail/main.pageResults にキャッシュ済みOCR結果を検出 → 併せてクリアします');
  }

  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `reset-document-to-pending-${projectId}-${docId}-${ts}.json`);
  const backupPayload = { id: docId, data: serializeTimestamps(data) };
  if (hasCachedPageResults) {
    backupPayload.detailMain = serializeTimestamps(detailSnap.data());
  }
  fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');
  console.log(`✓ バックアップ保存: ${backupPath}`);

  const batch = db.batch();
  batch.update(ref, {
    status: 'pending',
    retryCount: 0,
    lastErrorMessage: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // ADR-0025 PR2: Pass2昇格の可観測化フィールド。前回実行時の値が計測を汚染するのを
    // 避けるため明示的にクリアする(reset-documents-by-office.jsと同一の配慮)。
    pass2Promotion: admin.firestore.FieldValue.delete(),
    // 自動error-rescue機構の閾値カウンタ。残存すると今回の手動リセット後に429等で
    // 失敗した場合、rescue上限到達済み扱いで自動復旧されなくなる(codex review strict
    // P2指摘、fix-stuck-documents.jsと同一の配慮)。
    errorRescueCount: admin.firestore.FieldValue.delete(),
    lastRescuedAt: admin.firestore.FieldValue.delete(),
    // 未来時刻のretryAfterが残っているとpendingポーラーが処理をスキップし続け、
    // 「リセット成功」に見えても即時再処理されない(codex review strict P2指摘、
    // fix-stuck-documents.jsと同一の配慮)。
    retryAfter: admin.firestore.FieldValue.delete(),
  });
  if (hasCachedPageResults) {
    // 本体updateと同一batchでのdetail/main書込み(ocrProcessor.tsの既存規約と同じく原子性を保つ)。
    batch.update(detailRef, { pageResults: admin.firestore.FieldValue.delete() });
  }
  await batch.commit();

  console.log(`✓ documents/${docId} を status=pending にリセットしました${hasCachedPageResults ? '(detail/main.pageResultsもクリア)' : ''}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
