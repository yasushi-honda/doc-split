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
 *   npx ts-node scripts/sarashina-summary-verify.ts --docs=D9,D10 --runs=1 --smoke=true (疎通確認用。
 *   `--smoke=true`が無いと、D9/D10のみ・runs=1という組み合わせはcoverage-aggregate/determinismが
 *   構造的にNOT_EVALUATEDになり、サービスが正常でも必ずexitCode=1になる。codex review指摘)
 */

import * as fs from 'fs';
import * as path from 'path';
import { requireEnvField, IdTokenProvider } from './lib/cloudRunVerifyCommon';
import {
  DEV_ENV_PATH,
  MANIFEST_PATH,
  REQUEST_TIMEOUT_MS,
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
    let runtimeContractError: string | null = null;
    const loopStartedAt = Date.now();

    requestLoop: for (const docId of args.docs) {
      const fullText = loadFullSourceText(docId);
      const prompt = buildPromptForDoc(docId, fullText, metaRaw);
      const scoringSource = sourceTextForScoring(fullText);
      const requestBody = buildChatRequestBody(prompt, { maxTokens: args.maxTokens, temperature: args.temperature });

      for (let run = 1; run <= args.runs; run++) {
        // codex review指摘(P2、3回目): budget残量が0になっていなくても、1リクエストの
        // 最悪ケース所要時間(REQUEST_TIMEOUT_MS、リトライのbackoff込みでさらに超過しうる)
        // より残り予算が少なければ、このリクエストを開始した時点で予算超過が確定する。
        // 開始前に打ち切ることで、`--budget-minutes=1`のような小さい予算でも
        // 実際の超過を最小限に抑える。
        const remainingBudgetMs = args.budgetMs - (Date.now() - loopStartedAt);
        if (remainingBudgetMs < REQUEST_TIMEOUT_MS) {
          console.warn(
            `実行時間の予算(${args.budgetMs / 60000}分)の残りが1リクエストの最悪所要時間(${REQUEST_TIMEOUT_MS / 60000}分)未満のため、残りのdoc/run送信を打ち切ります。`
          );
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
            kind: 'fatal',
            fatalReason: `doc/run処理中に想定外の例外が発生しました: ${caseErr instanceof Error ? caseErr.message : String(caseErr)}`,
          };
        }
        records.push(record);
        console.log(
          `[${docId}#${record.run}] wallMs=${record.wallMs} kind=${record.kind} ` +
            `mustCoverOk=${record.kind === 'evaluated' ? record.coverage.mustCoverSatisfied : 'N/A'}`
        );

        // runtime-contractは最初に得られた成功レスポンスの直後(既にwarm化済み)にのみ取得する。
        if (runtimeContract === null && record.kind === 'evaluated') {
          try {
            const token = await tokenProvider.getToken();
            const props = await fetchProps(serviceUrl, token);
            runtimeContract = checkRuntimeContract(props, manifest);
          } catch (propsErr) {
            // silent-failure-hunter指摘(High): console.errorのみだとJSONレポート(artifact)に
            // 理由が残らずpost-mortem時にjobログを漁る必要があった。実際のエラー内容を
            // レポート(runtime-contractゲートのdetail)へ持ち越す。
            runtimeContractError = propsErr instanceof Error ? propsErr.message : String(propsErr);
            console.error('/propsの取得に失敗しました:', propsErr);
          }
        }
      }
    }

    let serviceSnapshotEnd;
    let serviceSnapshotEndError: string | null = null;
    try {
      serviceSnapshotEnd = await getServiceSnapshot(projectId, region);
      console.log('終了時スナップショット:', serviceSnapshotEnd);
    } catch (snapshotErr) {
      serviceSnapshotEnd = null;
      serviceSnapshotEndError = snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr);
      console.error('終了時スナップショットの取得に失敗しました:', snapshotErr);
    }

    const finishedAt = new Date().toISOString();
    const report = buildReport({
      serviceUrl,
      startedAt,
      finishedAt,
      serviceSnapshotStart,
      serviceSnapshotEnd,
      serviceSnapshotEndError,
      runtimeContract,
      runtimeContractError,
      records,
      metaByDoc,
      expectedDocs: args.docs,
      expectedRunsPerDoc: args.runs,
    });

    exitCode = determineExitCode(report, { allowNotEvaluated: args.smoke });
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
