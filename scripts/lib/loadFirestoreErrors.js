/**
 * BE の Firestore エラー判定 (functions/src/utils/firestoreErrors.ts) を scripts から共有する helper (Issue #984)
 *
 * 背景: force-reindex.js が高頻度トークンのサイズ超過(1MiB)を「スキップ」として扱うか、それ以外の失敗として
 * throw するかを、トリガー(searchIndexer.addDocumentToIndex)と同じ判定で決める必要がある。
 * 判定ロジックを 2 か所に複製すると、本番/エミュレータ/WriteBatch/BulkWriter で異なるエラー文言の
 * 追従漏れが起きるため、loadTokenizer.js と同じく compiled lib を require して SSoT を 1 か所に保つ。
 *
 * 古い functions/lib/(判定関数の追加前にビルドされたもの)が残っていると、関数が undefined のまま
 * 呼び出されて「復旧が全件失敗する」ため、typeof で検査して原因が分かるエラーで即時停止する
 * (ensureTokenizerBuilt() は tokenizer.js の存在しか見ないため、この検査が必要)。
 */

const path = require('path');

const FIRESTORE_ERRORS_PATH = path.resolve(
  __dirname,
  '../../functions/lib/functions/src/utils/firestoreErrors.js',
);

/**
 * 判定関数を持つモジュールであることを検査して、そのまま返す。
 * (テストから古いビルドを模したモジュールを渡して検証できるよう export している)
 */
function assertFirestoreErrorsModule(mod) {
  if (!mod || typeof mod.isFirestoreDocumentSizeExceededError !== 'function') {
    throw new Error(
      `[loadFirestoreErrors] functions/lib/ が古く、isFirestoreDocumentSizeExceededError がありません ` +
        `(path: ${FIRESTORE_ERRORS_PATH})。'cd functions && npm run build' を実行してから再実行してください。`,
    );
  }
  return mod;
}

/**
 * BE の firestoreErrors の compiled module を返す。事前に functions/lib/ が build 済みであること。
 * lib/ 不在時は MODULE_NOT_FOUND を actionable message で包む(loadTokenizer と同じ作法)。
 */
function loadFirestoreErrors() {
  let mod;
  try {
    mod = require(FIRESTORE_ERRORS_PATH);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `[loadFirestoreErrors] functions/lib/ が未生成です (path: ${FIRESTORE_ERRORS_PATH})。` +
          `'cd functions && npm run build' を実行してから再実行してください。原因: ${err.message}`,
      );
    }
    throw err;
  }
  return assertFirestoreErrorsModule(mod);
}

module.exports = {
  loadFirestoreErrors,
  assertFirestoreErrorsModule,
  FIRESTORE_ERRORS_PATH,
};
