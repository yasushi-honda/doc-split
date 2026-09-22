#!/usr/bin/env ts-node
/**
 * ADR-0027 PR2b 実装ステップ4: Sarashina要約Cloud Run実機ゲートハーネスのCLIエントリ。
 *
 * テスト可能なロジック(ゲート判定・レポート生成・リトライ・CLI引数解析)は
 * `scripts/lib/sarashinaSummaryVerify.ts`に集約し、本ファイルはI/O(gcloud呼出し・HTTP・
 * ファイル書き出し)の配線のみを担う(`scripts/paddle-ocr-verify.ts`とは異なりmain()自体は
 * 単体テスト対象外、`scripts/lib/sarashinaSummaryVerify.test.ts`が配線先の各関数をテストする)。
 *
 * 実行例:
 *   npx ts-node scripts/sarashina-summary-verify.ts --runs=3
 *   npx ts-node scripts/sarashina-summary-verify.ts --docs=D9,D10 --runs=1 (疎通確認用)
 */

import * as fs from 'fs';
import * as path from 'path';
import { requireEnvField, IdTokenProvider } from './lib/cloudRunVerifyCommon';
import {
  DEV_ENV_PATH,
  MANIFEST_PATH,
  resolveServiceUrl,
  getServiceSnapshot,
  fetchProps,
  checkRuntimeContract,
  buildChatRequestBody,
  sendSummaryWithRetries,
  scoreRunRecord,
  buildReport,
  buildStepSummaryMarkdown,
  determineExitCode,
  emptyReportSkeleton,
  parseArgs,
  loadMetaRaw,
  loadMetaByDoc,
  loadFullSourceText,
  sourceTextForScoring,
  buildPromptForDoc,
  type CliArgs,
  type RuntimeManifest,
  type RuntimeContractCheck,
  type SummaryRunRecord,
} from './lib/sarashinaSummaryVerify';

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let args: CliArgs | undefined;

  const writeJsonAndSummary = (reportJson: unknown, summaryMarkdown: string, outPath: string) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(reportJson, null, 2));
    console.log(`レポートを書き出しました: ${outPath}`);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      fs.appendFileSync(summaryPath, summaryMarkdown + '\n');
    }
    process.exitCode = exitCode;
  };

  try {
    args = parseArgs(process.argv.slice(2));

    const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
    const projectId = requireEnvField(devEnvContent, 'PROJECT_ID', DEV_ENV_PATH);
    const region = requireEnvField(devEnvContent, 'CLOUD_RUN_LOCATION', DEV_ENV_PATH);
    const serviceUrl = resolveServiceUrl({
      explicitUrl: args.url,
      envVarUrl: process.env.SARASHINA_SUMMARY_URL,
      devEnvContent,
      devEnvPathForError: DEV_ENV_PATH,
    });

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as RuntimeManifest;
    const metaRaw = loadMetaRaw();
    const metaByDoc = loadMetaByDoc();

    const serviceSnapshotStart = await getServiceSnapshot(projectId, region);
    console.log('開始時スナップショット:', serviceSnapshotStart);

    const tokenProvider = new IdTokenProvider(serviceUrl);
    const records: SummaryRunRecord[] = [];
    let runtimeContract: RuntimeContractCheck | null = null;
    const loopStartedAt = Date.now();

    requestLoop: for (const docId of args.docs) {
      const fullText = loadFullSourceText(docId);
      const prompt = buildPromptForDoc(docId, fullText, metaRaw);
      const scoringSource = sourceTextForScoring(fullText);
      const requestBody = buildChatRequestBody(prompt, { maxTokens: args.maxTokens, temperature: args.temperature });

      for (let run = 1; run <= args.runs; run++) {
        if (Date.now() - loopStartedAt > args.budgetMs) {
          console.warn(`実行時間の予算(${args.budgetMs / 60000}分)を超過したため、残りのdoc/run送信を打ち切ります。`);
          break requestLoop;
        }
        let record: SummaryRunRecord;
        try {
          const outcome = await sendSummaryWithRetries({ requestBody, serviceUrl, tokenProvider });
          record = scoreRunRecord(docId, run, scoringSource, metaByDoc[docId], outcome);
        } catch (caseErr) {
          record = {
            docId,
            run,
            wallMs: 0,
            httpStatus: null,
            retriedCount: 0,
            timedOut: false,
            fatal: true,
            fatalReason: `doc/run処理中に想定外の例外が発生しました: ${caseErr instanceof Error ? caseErr.message : String(caseErr)}`,
          };
        }
        records.push(record);
        console.log(
          `[${docId}#${record.run}] wallMs=${record.wallMs} fatal=${record.fatal} timedOut=${record.timedOut} ` +
            `mustCoverOk=${record.coverage?.mustCoverSatisfied ?? 'N/A'}`
        );

        // runtime-contractは最初に得られた成功レスポンスの直後(既にwarm化済み)にのみ取得する。
        if (runtimeContract === null && !record.fatal && !record.timedOut) {
          try {
            const token = await tokenProvider.getToken();
            const props = await fetchProps(serviceUrl, token);
            runtimeContract = checkRuntimeContract(props, manifest);
          } catch (propsErr) {
            console.error('/propsの取得に失敗しました:', propsErr);
          }
        }
      }
    }

    let serviceSnapshotEnd;
    try {
      serviceSnapshotEnd = await getServiceSnapshot(projectId, region);
      console.log('終了時スナップショット:', serviceSnapshotEnd);
    } catch (snapshotErr) {
      serviceSnapshotEnd = null;
      console.error('終了時スナップショットの取得に失敗しました:', snapshotErr);
    }

    const finishedAt = new Date().toISOString();
    const report = buildReport({
      serviceUrl,
      startedAt,
      finishedAt,
      serviceSnapshotStart,
      serviceSnapshotEnd,
      runtimeContract,
      records,
      metaByDoc,
      expectedDocs: args.docs,
      expectedRunsPerDoc: args.runs,
    });

    exitCode = determineExitCode(report);
    writeJsonAndSummary(report, buildStepSummaryMarkdown(report), args.out);
  } catch (err) {
    exitCode = 1;
    const fatalError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    const outPath = args?.out ?? path.join(process.cwd(), 'sarashina-summary-verify.json');
    const report = emptyReportSkeleton(startedAt, new Date().toISOString(), args?.url ?? 'unresolved', fatalError);
    writeJsonAndSummary(report, buildStepSummaryMarkdown(report), outPath);
    console.error(err);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('main()が予期せぬ形で失敗しました(レポート書き出し自体が失敗した可能性があります):', err);
    process.exitCode = 1;
  });
}
