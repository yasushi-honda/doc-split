/**
 * summaryPromptBuilder の外部依存ゼロ契約テスト (Issue #251 Scope 2 補強)
 *
 * 目的: `summaryPromptBuilder.ts` が firebase-admin / Vertex AI / rateLimiter /
 * summaryGenerator 等への依存を import 経路で再獲得した場合に decisive に落とす。
 *
 * 背景: Issue #251 Scope 2 で pure module として分離したが、将来の refactor で
 * 軽い気持ちで import を足すと admin 未初期化エラーが unit test に波及する。
 * 境界値 test (summaryPromptBuilder.test.ts) は「この test が走る限り pure」を
 * 間接的に示すのみで、再依存が入った瞬間に test suite 全体が壊れる脆さがある。
 * 本契約 test は import 文を静的に検査して「pure 性」を構造的に lock-in する。
 *
 * 方式: grep-based (既存 aggregateCapLogErrorContract.test.ts 形式に準拠)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
// 既存 contract test (checkGmailAttachmentsEndpointContract.test.ts 等) と同じく
// relative path の helper import を 1 つ添えることで ts-node が本ファイルを CJS と
// して解決し、`__dirname` が利用可能になる。fs/path だけの import では ESM 扱いと
// なり `__dirname is not defined` で before hook が失敗する。
import './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/ocr/summaryPromptBuilder.ts';

describe('summaryPromptBuilder 外部依存ゼロ契約 (#251)', () => {
  let source: string;

  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    source = readFileSync(path, 'utf-8');
  });

  it('firebase-admin を import していない (app/no-app 回避)', () => {
    expect(source).to.not.match(/from\s+['"]firebase-admin['"]/);
  });

  it('Vertex AI SDK を import していない (GCP 認証不要)', () => {
    expect(source).to.not.match(/from\s+['"]@google-cloud\/vertexai['"]/);
  });

  it('utils/rateLimiter を import していない (admin.firestore() 連鎖回避)', () => {
    expect(source).to.not.match(/from\s+['"][^'"]*\/rateLimiter['"]/);
  });

  it('summaryGenerator を import していない (双方向依存禁止)', () => {
    expect(source).to.not.match(/from\s+['"][^'"]*\/summaryGenerator['"]/);
  });

  it('utils/errorLogger を import していない (firebase-admin 連鎖回避)', () => {
    expect(source).to.not.match(/from\s+['"][^'"]*\/errorLogger['"]/);
  });

  it('import 文を 1 つも含まない (純粋な定数 + 関数のみ)', () => {
    // 将来 shared/types.ts の型 import が必要になった場合は本テストを明示的に
    // 更新して「意図的に増やした」証跡を残す。
    const importLines = source.match(/^import\s+.+?from\s+['"][^'"]+['"];?\s*$/gm) ?? [];
    expect(importLines).to.deep.equal([]);
  });
});
