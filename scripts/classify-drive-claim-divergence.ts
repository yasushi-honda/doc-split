#!/usr/bin/env ts-node
/**
 * Issue #871 恒久対応: divergent claim の一覧化(read-only、承認付き再同期ワークフローの入口)
 *
 * `driveFolderLocks` を `state=='divergent'` で走査し、各claimについて期待値・Drive実体・
 * 差分・claimグラフ掃引・影響書類・プリフライト結果を集めてPlan(JSON)を出力する。
 * コア実装は`scripts/lib/buildDivergencePlan.ts`(fake Driveを注入してテスト可能)。
 * 判定ロジック本体(`determineResolution`/`evaluatePreflight`)は`scripts/lib/
 * divergenceResolutionPlan.ts`の純関数を使い、`execute-drive-claim-resync.ts`が
 * execute直前に同じ関数で再評価する(判定基準の単一化)。
 *
 * read-onlyであり、Drive/Firestoreへの書込みは一切行わない
 * (`diagnose-drive-folder-duplicate-causality.ts`と同じ位置づけ)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/classify-drive-claim-divergence.ts \
 *     --out /tmp/divergence-plan.json
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import type { drive_v3 } from 'googleapis';
import { buildDivergencePlan } from './lib/buildDivergencePlan';
import { readDriveApiVersionSnapshot } from './lib/driveApiVersionGate';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let outPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outPath = args[i + 1];
    i++;
  }
}
if (!outPath) {
  console.error('--out <path> を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });

async function main(): Promise<void> {
  // driveAuth.ts等はモジュールトップレベルでadmin.firestore()を評価するため、
  // admin.initializeApp()より前に静的importするとエラーになる(diagnose-drive-folder-
  // duplicate-causality.tsと同型の対策)。
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');
  const { SUPPORTS_ALL_DRIVES, FOLDER_MIME_TYPE, escapeQueryValue } = await import(
    '../functions/src/drive/driveApiConstants'
  );

  console.log(`プロジェクト: ${projectId}`);
  const drive: drive_v3.Drive = await getDriveClient();

  const plan = await buildDivergencePlan(
    { drive, supportsAllDrives: SUPPORTS_ALL_DRIVES, folderMimeType: FOLDER_MIME_TYPE, escapeQueryValue },
    {
      firestore: admin.firestore(),
      driveApiVersion: readDriveApiVersionSnapshot(),
      environment: projectId as string,
      projectId: projectId as string,
      log: (m) => console.log(m),
    }
  );

  fs.writeFileSync(outPath as string, JSON.stringify(plan, null, 2));

  console.log('---');
  console.log(
    `完了: 全${plan.summary.totalDivergent}件中、自動解決候補${plan.summary.autoResolvable}件・blocked${plan.summary.blocked}件。結果を書き込みました: ${outPath}`
  );
}

main().catch((err) => {
  console.error('classify-drive-claim-divergence が失敗しました:', err);
  process.exit(1);
});
