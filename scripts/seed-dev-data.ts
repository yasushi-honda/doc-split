#!/usr/bin/env ts-node
/**
 * dev 環境 seed データ投入スクリプト (Issue #528)
 *
 * kaname 要望 B/D/E/F (#524/#525/#526/#527) の dev 検証基盤として、
 * 実運用 (FAX 中心) 相当のテストデータを doc-split-dev に投入する。
 *
 * 投入内容:
 *   1. マスターデータ: ケアマネ 3 / 顧客 12 (CM 紐付け+ふりがな) / 事業所 2 / 書類種別 4 (category 付き)
 *   2. processed 書類 ~145 件: 担当CM×利用者×書類種別 の階層 (F 用)。
 *      CM1 配下は 120 件超でグループ展開ページング (pageSize 100) 境界を跨ぐ
 *   3. totalPages: 0 の書類 (D のフォールバック表示検証用)
 *   4. error 状態書類 3 件 (メタ付き。B のグループビュー行「再試行」検証用)
 *   5. 複数書類混在の複数ページ PDF 2 件を Storage に実アップロードし status: 'pending' で投入
 *      → dev の実 OCR パイプラインが処理 (E の分割 E2E 素材)
 *
 * 冪等性:
 *   - マスター / processed / error 書類: seed- prefix 固定 ID の set() 上書きで何度でも再実行可
 *   - pending 書類: 既に存在する場合はスキップ (OCR 完了・手動検証済みの状態を保護)。
 *     再投入して OCR からやり直したい場合のみ --force-pending を付ける (Vertex AI 再課金)
 *
 * ガード:
 *   - FIREBASE_PROJECT_ID が 'doc-split-dev' 以外なら即終了 (本番誤投入防御)
 *   - 書込対象は seed- prefix の固定 ID のみ。既存データには触れない
 *   - Storage は original/seed_*.pdf のみ (実パイプラインと同 prefix、固定パス上書き)
 *   - STORAGE_BUCKET は env 未指定時 scripts/clients/dev.env から取得 (projectId からの推測はしない)
 *
 * 使用方法 (推奨: GitHub Actions 経由、ADC 不要):
 *   Actions → "Run Operations Script" → environment: dev / script: seed-dev-data を選択して実行
 *
 * ローカル実行 (ADC 認証が必要な場合のフォールバック):
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/seed-dev-data.ts --dry-run  # プレビュー
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/seed-dev-data.ts            # 投入
 *
 * PDF fixture 再生成 (ローカル専用。日本語フォントが必要なため GHA では実行しない):
 *   npx ts-node scripts/seed-dev-data.ts --generate-pdfs
 *   → scripts/fixtures/seed/*.pdf を再生成 (git commit 対象)。
 *      投入モードはコミット済み fixture を読むだけなのでフォント・pdf-lib 不要。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { generateDisplayFileName } from '../shared/generateDisplayFileName';

const ALLOWED_PROJECT_ID = 'doc-split-dev';
const FIXTURE_SEED_DIR = path.join(__dirname, 'fixtures', 'seed');

const dryRun = process.argv.includes('--dry-run');
const generatePdfs = process.argv.includes('--generate-pdfs');
const forcePending = process.argv.includes('--force-pending');

// ============================================
// seed データ定義 (deterministic)
// ============================================

const CARE_MANAGERS = [
  { id: 'seed-cm-01', name: '佐々木恵子' },
  { id: 'seed-cm-02', name: '高橋誠' },
  { id: 'seed-cm-03', name: '森さくら' },
];

const OFFICES = [
  { id: 'seed-office-01', name: 'ひまわり訪問介護ステーション', shortName: 'ひまわり' },
  { id: 'seed-office-02', name: 'あおぞらデイサービスセンター', shortName: 'あおぞら' },
];

const DOC_TYPES = [
  { id: 'seed-doctype-01', name: 'ケアプラン', category: '計画', dateMarker: '作成日', keywords: ['居宅サービス計画', 'ケアプラン'] },
  { id: 'seed-doctype-02', name: 'サービス提供票', category: '計画', dateMarker: '提供月', keywords: ['提供票', 'サービス提供'] },
  { id: 'seed-doctype-03', name: '訪問看護報告書', category: '医療', dateMarker: '報告日', keywords: ['訪問看護', '報告書'] },
  { id: 'seed-doctype-04', name: '請求書', category: '請求', dateMarker: '発行日', keywords: ['請求書', 'ご請求'] },
];

/** 顧客 12 名。CM1: 5 名 (配下 120 docs でページング境界)、CM2: 4 名、CM3: 3 名 */
const CUSTOMERS = [
  { id: 'seed-cust-01', name: '相沢一郎', furigana: 'あいざわいちろう', cm: 0 },
  { id: 'seed-cust-02', name: '井上春子', furigana: 'いのうえはるこ', cm: 0 },
  { id: 'seed-cust-03', name: '内田健三', furigana: 'うちだけんぞう', cm: 0 },
  { id: 'seed-cust-04', name: '江口冬美', furigana: 'えぐちふゆみ', cm: 0 },
  { id: 'seed-cust-05', name: '大野正雄', furigana: 'おおのまさお', cm: 0 },
  { id: 'seed-cust-06', name: '加藤秋人', furigana: 'かとうあきと', cm: 1 },
  { id: 'seed-cust-07', name: '木村千代', furigana: 'きむらちよ', cm: 1 },
  { id: 'seed-cust-08', name: '黒田実', furigana: 'くろだみのる', cm: 1 },
  { id: 'seed-cust-09', name: '小林梅子', furigana: 'こばやしうめこ', cm: 1 },
  { id: 'seed-cust-10', name: '斎藤光', furigana: 'さいとうひかる', cm: 2 },
  { id: 'seed-cust-11', name: '島田花', furigana: 'しまだはな', cm: 2 },
  { id: 'seed-cust-12', name: '鈴木蔵之助', furigana: 'すずきくらのすけ', cm: 2 },
];

/**
 * totalPages のバリエーション。各値に対応する実ページ数の generic PDF を用意し、
 * Firestore の totalPages と fileUrl の実体ページ数を常に一致させる
 * (不一致だと詳細モーダル/分割プレビューのページ遷移が実 PDF と矛盾し、偽の不具合を生む)。
 * 0 は「OCR 前の旧形式 doc」相当の意図的な誤値で、実体は 1p を共有する。
 */
const PAGE_VARIATIONS = [1, 2, 3, 5, 8, 12];

const GENERIC_PDFS = PAGE_VARIATIONS.map((pages) => ({
  fixture: `seed_generic_${pages}p.pdf`,
  pages,
}));

/** Storage パスは fixture 名から一意に導出する (二重管理による不整合防止) */
function storagePathOf(fixture: string): string {
  return `original/${fixture}`;
}

function genericPdfFor(totalPages: number): string {
  const entry = GENERIC_PDFS.find((g) => g.pages === (totalPages === 0 ? 1 : totalPages));
  if (!entry) throw new Error(`totalPages=${totalPages} に対応する generic PDF がありません`);
  return storagePathOf(entry.fixture);
}

/** E 用: 複数書類混在 FAX PDF の構成定義 */
const MIXED_FAX_PDFS = [
  {
    id: 'seed-doc-pending-mixed-01',
    fixture: 'seed_mixed_fax_01.pdf',
    fileName: 'seed_混在FAX受信_01.pdf',
    segments: [
      { docType: 'ケアプラン', customer: '相沢一郎', office: 'ひまわり訪問介護ステーション', pages: 2, dateLabel: '作成日: 2026年6月1日' },
      { docType: 'サービス提供票', customer: '井上春子', office: 'ひまわり訪問介護ステーション', pages: 2, dateLabel: '提供月: 2026年6月' },
      { docType: '請求書', customer: '相沢一郎', office: 'あおぞらデイサービスセンター', pages: 2, dateLabel: '発行日: 2026年6月10日' },
    ],
  },
  {
    id: 'seed-doc-pending-mixed-02',
    fixture: 'seed_mixed_fax_02.pdf',
    fileName: 'seed_混在FAX受信_02.pdf',
    segments: [
      { docType: '訪問看護報告書', customer: '加藤秋人', office: 'あおぞらデイサービスセンター', pages: 2, dateLabel: '報告日: 2026年6月15日' },
      { docType: 'サービス提供票', customer: '木村千代', office: 'ひまわり訪問介護ステーション', pages: 3, dateLabel: '提供月: 2026年6月' },
    ],
  },
];

// ============================================
// PDF fixture 生成 (--generate-pdfs、ローカル専用)
// ============================================

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

interface PdfPageSpec {
  title: string;
  lines: string[];
}

function genericPdfPages(pages: number): PdfPageSpec[] {
  return Array.from({ length: pages }, (_, i) => ({
    title: 'seed 汎用書類',
    lines: [
      'このファイルは doc-split-dev の seed データ用汎用 PDF です。',
      '複数の seed 書類レコードから共有参照されます。',
      `ページ ${i + 1}`,
    ],
  }));
}

function mixedFaxPages(segments: (typeof MIXED_FAX_PDFS)[number]['segments']): PdfPageSpec[] {
  const pages: PdfPageSpec[] = [];
  for (const seg of segments) {
    for (let p = 0; p < seg.pages; p++) {
      pages.push({
        title: seg.docType,
        lines: [
          `利用者: ${seg.customer} 様`,
          `事業所: ${seg.office}`,
          seg.dateLabel,
          '',
          p === 0 ? `本書は${seg.docType}です。内容をご確認ください。` : `${seg.docType} (続き)`,
          `${seg.docType} ${p + 1}枚目 / 全${seg.pages}枚`,
        ],
      });
    }
  }
  return pages;
}

/**
 * pdf-lib / fontkit は fixture 生成時のみ必要なため dynamic import にする
 * (投入・dry-run 経路を PDF 生成依存の解決可否から切り離す)。
 */
async function generateFixtures(): Promise<void> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const fontPath = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!fontPath) {
    throw new Error(
      `日本語対応フォントが見つかりません。候補: ${FONT_CANDIDATES.join(', ')}\n` +
        'CJK グリフを含む TTF のパスを FONT_CANDIDATES に追加してください。',
    );
  }
  const fontBytes = fs.readFileSync(fontPath);

  async function buildPdf(pages: PdfPageSpec[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: true });

    pages.forEach((spec, i) => {
      const page = doc.addPage([595.28, 841.89]); // A4
      const { height } = page.getSize();
      page.drawText(spec.title, { x: 50, y: height - 80, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
      spec.lines.forEach((line, li) => {
        page.drawText(line, { x: 50, y: height - 130 - li * 26, size: 13, font, color: rgb(0.2, 0.2, 0.2) });
      });
      page.drawText(`${i + 1} / ${pages.length}`, { x: 270, y: 40, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    });

    return doc.save();
  }

  console.log(`📄 PDF fixture 生成 → ${FIXTURE_SEED_DIR}`);
  fs.mkdirSync(FIXTURE_SEED_DIR, { recursive: true });

  for (const g of GENERIC_PDFS) {
    const bytes = await buildPdf(genericPdfPages(g.pages));
    fs.writeFileSync(path.join(FIXTURE_SEED_DIR, g.fixture), bytes);
    console.log(`  ✅ ${g.fixture} (${g.pages}p, ${(bytes.length / 1024).toFixed(0)}KB)`);
  }
  for (const m of MIXED_FAX_PDFS) {
    const pages = mixedFaxPages(m.segments);
    const bytes = await buildPdf(pages);
    fs.writeFileSync(path.join(FIXTURE_SEED_DIR, m.fixture), bytes);
    console.log(`  ✅ ${m.fixture} (${pages.length}p, ${(bytes.length / 1024).toFixed(0)}KB)`);
  }
  console.log('✅ 生成完了。git add scripts/fixtures/seed/ でコミットしてください。');
}

function readFixture(fixture: string): Buffer {
  const p = path.join(FIXTURE_SEED_DIR, fixture);
  if (!fs.existsSync(p)) {
    throw new Error(
      `PDF fixture が見つかりません: ${p}\n` +
        'ローカルで `npx ts-node scripts/seed-dev-data.ts --generate-pdfs` を実行してコミットしてください。',
    );
  }
  return fs.readFileSync(p);
}

// ============================================
// 設定解決
// ============================================

/**
 * Storage バケット名の解決。CLAUDE.md「バケット名をプロジェクトIDから推測してはいけない」
 * に従い、env 未指定時は scripts/clients/dev.env の STORAGE_BUCKET を読む (推測合成はしない)。
 */
function resolveStorageBucket(): string {
  if (process.env.STORAGE_BUCKET) return process.env.STORAGE_BUCKET;
  const envFile = path.join(__dirname, 'clients', 'dev.env');
  const content = fs.readFileSync(envFile, 'utf8');
  const m = content.match(/^STORAGE_BUCKET=["']?([^"'\r\n]+)["']?/m);
  if (!m) {
    throw new Error(`STORAGE_BUCKET を ${envFile} から取得できません。STORAGE_BUCKET 環境変数を指定してください。`);
  }
  return m[1];
}

// ============================================
// Firestore ドキュメント構築
// ============================================

type SeedDoc = { id: string; data: Record<string, unknown> };

/**
 * 日付を deterministic に散らす (2026-01-10 起点、index × 24 時間刻み)。
 * 最大 index ~150 でも 2026-06 上旬に収まり、未来日付を生成しない。
 */
function spreadDate(index: number): Date {
  return new Date(Date.UTC(2026, 0, 10) + index * 24 * 60 * 60 * 1000);
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildProcessedDoc(
  params: {
    id: string;
    customer: (typeof CUSTOMERS)[number];
    docType: (typeof DOC_TYPES)[number];
    office: (typeof OFFICES)[number];
    totalPages: number;
    index: number;
    status?: 'processed' | 'error';
  },
  storageBucket: string,
): SeedDoc {
  const { Timestamp } = admin.firestore;
  const { id, customer, docType, office, totalPages, index } = params;
  const status = params.status ?? 'processed';
  const cm = CARE_MANAGERS[customer.cm];
  const fileDate = spreadDate(index);
  const createdAt = spreadDate(index + 2);
  const fileName = `seed_FAX受信_${String(index + 1).padStart(4, '0')}.pdf`;
  const displayFileName = generateDisplayFileName({
    documentType: docType.name,
    customerName: customer.name,
    officeName: office.name,
    fileDate: toDateString(fileDate),
  });

  return {
    id,
    data: {
      id,
      processedAt: Timestamp.fromDate(createdAt),
      fileId: id,
      fileName,
      ...(displayFileName ? { displayFileName } : {}),
      mimeType: 'application/pdf',
      ocrResult: `${docType.name}\n利用者: ${customer.name} 様\n事業所: ${office.name}\n(seed データ)`,
      documentType: docType.name,
      customerName: customer.name,
      officeName: office.name,
      fileUrl: `gs://${storageBucket}/${genericPdfFor(totalPages)}`,
      fileDate: Timestamp.fromDate(fileDate),
      isDuplicateCustomer: false,
      totalPages,
      targetPageNumber: 1,
      status,
      sourceType: 'upload',
      careManager: cm.name,
      customerId: customer.id,
      customerConfirmed: true,
      officeId: office.id,
      officeConfirmed: true,
      verified: index % 3 === 0,
      createdAt: Timestamp.fromDate(createdAt),
      ...(status === 'error' ? { errorMessage: 'OCR処理に失敗しました (seed 検証用)' } : {}),
    },
  };
}

/** totalPages:0 (旧形式 doc 相当) を CM2 配下に入れる件数 */
const ZERO_PAGE_COUNT = 5;

function buildBulkDocs(storageBucket: string): SeedDoc[] {
  const docs: SeedDoc[] = [];
  let index = 0;
  let zeroPagesSeeded = 0;

  // CM1 (5 顧客): 4 種別 × 6 件 = 顧客 24 件 × 5 = 120 件 → グループ展開 pageSize 100 を跨ぐ
  // CM2 (4 顧客): 4 種別 × 1 件 = 16 件
  // CM3 (3 顧客): 3 種別 × 1 件 = 9 件
  for (const customer of CUSTOMERS) {
    const types = customer.cm === 2 ? DOC_TYPES.slice(0, 3) : DOC_TYPES;
    const repeat = customer.cm === 0 ? 6 : 1;
    for (const docType of types) {
      for (let r = 0; r < repeat; r++) {
        const office = OFFICES[index % OFFICES.length];
        // CM2 の先頭 ZERO_PAGE_COUNT 件は totalPages: 0 (D のフォールバック検証用)
        const isZeroPage = customer.cm === 1 && zeroPagesSeeded < ZERO_PAGE_COUNT;
        if (isZeroPage) zeroPagesSeeded++;
        const totalPages = isZeroPage ? 0 : PAGE_VARIATIONS[index % PAGE_VARIATIONS.length];
        docs.push(
          buildProcessedDoc(
            {
              id: `seed-doc-${String(index + 1).padStart(4, '0')}`,
              customer,
              docType,
              office,
              totalPages,
              index,
            },
            storageBucket,
          ),
        );
        index++;
      }
    }
  }

  // error 書類 3 件 (メタ付き = グループビューに出現し、行の「再試行」を検証できる)
  const errorTargets = [CUSTOMERS[0], CUSTOMERS[5], CUSTOMERS[9]];
  errorTargets.forEach((customer, i) => {
    docs.push(
      buildProcessedDoc(
        {
          id: `seed-doc-error-${String(i + 1).padStart(2, '0')}`,
          customer,
          docType: DOC_TYPES[i % DOC_TYPES.length],
          office: OFFICES[i % OFFICES.length],
          totalPages: 2,
          index: index + i,
          status: 'error',
        },
        storageBucket,
      ),
    );
  });

  return docs;
}

/** E 用 pending 書類 (uploadPdf.ts の payload 形状を踏襲。実 OCR パイプラインが処理する) */
function buildPendingDoc(mixed: (typeof MIXED_FAX_PDFS)[number], storageBucket: string): SeedDoc {
  const { Timestamp } = admin.firestore;
  return {
    id: mixed.id,
    data: {
      id: mixed.id,
      processedAt: Timestamp.now(),
      fileId: mixed.id,
      fileName: mixed.fileName,
      mimeType: 'application/pdf',
      ocrResult: '',
      documentType: '',
      customerName: '',
      officeName: '',
      fileUrl: `gs://${storageBucket}/${storagePathOf(mixed.fixture)}`,
      fileDate: null,
      isDuplicateCustomer: false,
      totalPages: 0,
      targetPageNumber: 1,
      status: 'pending',
      sourceType: 'upload',
    },
  };
}

// ============================================
// 投入
// ============================================

const BATCH_SIZE = 400;

async function commitInBatches(
  db: FirebaseFirestore.Firestore,
  writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>,
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(w.ref, w.data);
    }
    await batch.commit();
    console.log(`  ... ${Math.min(i + BATCH_SIZE, writes.length)}/${writes.length} 件コミット`);
  }
}

async function seed(): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== ALLOWED_PROJECT_ID) {
    console.error(
      `❌ このスクリプトは ${ALLOWED_PROJECT_ID} 専用です (FIREBASE_PROJECT_ID=${projectId ?? '(未設定)'})`,
    );
    console.error('   本番クライアント環境へのサンプルデータ投入は禁止です (CLAUDE.md)。');
    process.exit(1);
  }

  const storageBucket = resolveStorageBucket();

  admin.initializeApp({ projectId, storageBucket });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log(`🌱 dev seed データ投入 (Issue #528)`);
  console.log(`プロジェクト: ${projectId} / bucket: ${storageBucket}`);
  console.log(`モード: ${dryRun ? 'DRY RUN (書込なし)' : '実行'}${forcePending ? ' + force-pending' : ''}`);
  console.log('---');

  const bulkDocs = buildBulkDocs(storageBucket);
  const pendingDocs = MIXED_FAX_PDFS.map((m) => buildPendingDoc(m, storageBucket));
  const zeroPageCount = bulkDocs.filter((d) => d.data.totalPages === 0).length;
  const errorCount = bulkDocs.filter((d) => d.data.status === 'error').length;
  const cm1Count = bulkDocs.filter((d) => d.data.careManager === CARE_MANAGERS[0].name).length;

  console.log('投入プラン:');
  console.log(`  マスター: ケアマネ ${CARE_MANAGERS.length} / 顧客 ${CUSTOMERS.length} / 事業所 ${OFFICES.length} / 書類種別 ${DOC_TYPES.length}`);
  console.log(`  Storage PDF: 汎用 ${GENERIC_PDFS.length} + 混在FAX ${MIXED_FAX_PDFS.length} (fixtures/seed/ から)`);
  console.log(`  書類: processed/error ${bulkDocs.length} 件 (うち totalPages:0 ${zeroPageCount} / error ${errorCount} / ${CARE_MANAGERS[0].name} 配下 ${cm1Count})`);
  console.log(`  書類: pending ${pendingDocs.length} 件 (既存はスキップ。--force-pending で再投入 = 再 OCR 課金)`);

  if (dryRun) {
    // fixture の存在だけは dry-run でも検証する (GHA 実行前の事前チェックとして機能させる)
    for (const g of GENERIC_PDFS) readFixture(g.fixture);
    for (const m of MIXED_FAX_PDFS) readFixture(m.fixture);
    console.log('\n✅ DRY RUN 完了 (fixture 存在確認 OK)。実行するには --dry-run を外してください。');
    return;
  }

  // 1. Storage アップロード (コミット済み fixture)
  console.log('\n📄 Storage アップロード...');
  for (const f of [...GENERIC_PDFS, ...MIXED_FAX_PDFS]) {
    const bytes = readFixture(f.fixture);
    await bucket.file(storagePathOf(f.fixture)).save(bytes, { contentType: 'application/pdf' });
    console.log(`  ✅ ${storagePathOf(f.fixture)} (${(bytes.length / 1024).toFixed(0)}KB)`);
  }

  // 2. マスターデータ
  console.log('\n👥 マスターデータ投入...');
  const masterWrites = [
    ...CARE_MANAGERS.map((cm) => ({
      ref: db.collection('masters').doc('caremanagers').collection('items').doc(cm.id),
      data: { name: cm.name, aliases: [] as string[] },
    })),
    ...CUSTOMERS.map((c) => ({
      ref: db.collection('masters').doc('customers').collection('items').doc(c.id),
      data: {
        name: c.name,
        furigana: c.furigana,
        careManagerName: CARE_MANAGERS[c.cm].name,
        isDuplicate: false,
        aliases: [] as string[],
        notes: 'seed データ',
      },
    })),
    ...OFFICES.map((o) => ({
      ref: db.collection('masters').doc('offices').collection('items').doc(o.id),
      data: { name: o.name, shortName: o.shortName, isDuplicate: false, aliases: [] as string[] },
    })),
    ...DOC_TYPES.map((t) => ({
      ref: db.collection('masters').doc('documents').collection('items').doc(t.id),
      data: { name: t.name, category: t.category, dateMarker: t.dateMarker, keywords: t.keywords, aliases: [] as string[] },
    })),
  ];
  await commitInBatches(db, masterWrites);

  // 3. processed / error 書類
  console.log('\n📄 processed/error 書類投入...');
  await commitInBatches(
    db,
    bulkDocs.map((d) => ({ ref: db.collection('documents').doc(d.id), data: d.data })),
  );

  // 4. pending 書類 (OCR パイプライン発火)。既存 doc は OCR 完了・検証済み状態の保護のためスキップ
  console.log('\n⏳ pending 書類投入...');
  const pendingWrites: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  for (const d of pendingDocs) {
    const ref = db.collection('documents').doc(d.id);
    if (!forcePending && (await ref.get()).exists) {
      console.log(`  ⏭ ${d.id} は既に存在するためスキップ (再投入は --force-pending)`);
      continue;
    }
    pendingWrites.push({ ref, data: d.data });
  }
  if (pendingWrites.length > 0) {
    await commitInBatches(db, pendingWrites);
    console.log(`  → ${pendingWrites.length} 件を pending 投入 (OCR パイプラインが処理を開始します)`);
  }

  console.log('\n✅ seed 投入完了');
  console.log('\n検証ポイント:');
  console.log(`  - F (4階層): 担当CM別タブ → ${CARE_MANAGERS[0].name} (${cm1Count} 件、ページング境界跨ぎ)`);
  console.log(`  - D (ページ数): totalPages 0/${PAGE_VARIATIONS.join('/')} が分布 (実 PDF ページ数と一致)。0 は CM2 (${CARE_MANAGERS[1].name}) 配下 ${zeroPageCount} 件`);
  console.log(`  - B (再試行): error 書類 ${errorCount} 件 (各 CM 配下に 1 件ずつ)`);
  console.log(`  - E (分割): ${MIXED_FAX_PDFS.map((m) => m.id).join(', ')} の OCR 完了後、分割モーダルで検証`);
}

(generatePdfs ? generateFixtures() : seed())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ エラー:', err);
    process.exit(1);
  });
