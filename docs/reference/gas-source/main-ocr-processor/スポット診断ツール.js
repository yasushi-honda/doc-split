/**
 * OCRシステム スポット診断ツール
 * 
 * 本ファイルは運用中のOCRシステムで障害や設定問題が発生した際の
 * 詳細診断と迅速な問題解決を支援するユーティリティ関数群です。
 * 
 * 使用目的：
 * - 認証関連の複雑な問題の特定・自動修正
 * - システム設定の包括的な状態確認
 * - 障害発生時の根本原因分析
 * 
 * 使用タイミング：
 * - システム初期導入時の設定確認
 * - 認証エラーが発生した際の診断
 * - 定期メンテナンス時の健全性確認
 * - 障害発生時の緊急診断
 * 
 * @version 1.0.0
 * @author OCR System Team
 */

/**
 * システム状態を包括的に確認する診断関数
 * 
 * 既存のcheckSystemReady()では確認できない詳細な設定値と
 * 初期化状態を可視化します。障害時の第一選択診断ツールとして設計されています。
 * 
 * 確認項目：
 * - グローバル変数の初期化状態
 * - サービスアカウント認証情報の詳細
 * - プライベートキーの形式検証
 * - エンドポイント設定の確認
 * - 設定オブジェクトの完全性
 * - Secret Manager設定パラメータ
 * 
 * @function checkSystemStatus
 * @returns {void} コンソールに詳細な診断結果を出力
 * 
 * @example
 * // 障害発生時の基本診断
 * checkSystemStatus();
 * 
 * // 出力例：
 * // === システム状態確認 ===
 * // 実行時刻: 2025/1/1 12:00:00
 * // --- 基本システム状態 ---
 * // SYSTEM_INITIALIZED: true
 * // SA_CREDENTIALS: 設定済み
 * //   - project_id: my-project-123
 * //   - client_email: service@my-project.iam.gserviceaccount.com
 * //   - private_key: 設定済み
 * //   - private_key行数: 26行 ✅正常
 * 
 * @since 1.0.0
 */
function checkSystemStatus() {
  console.log("=== システム状態確認 ===");
  console.log(`実行時刻: ${new Date().toLocaleString('ja-JP')}`);
  
  // 1. 基本システム状態
  console.log("\n--- 基本システム状態 ---");
  console.log(`SYSTEM_INITIALIZED: ${SYSTEM_INITIALIZED}`);
  console.log(`SA_CREDENTIALS: ${SA_CREDENTIALS ? '設定済み' : '未設定'}`);
  
  if (SA_CREDENTIALS) {
    console.log(`  - project_id: ${SA_CREDENTIALS.project_id || '未設定'}`);
    console.log(`  - client_email: ${SA_CREDENTIALS.client_email || '未設定'}`);
    console.log(`  - private_key: ${SA_CREDENTIALS.private_key ? '設定済み' : '未設定'}`);
    
    // プライベートキーの形式チェック
    if (SA_CREDENTIALS.private_key) {
      const keyLines = SA_CREDENTIALS.private_key.split('\n');
      console.log(`  - private_key行数: ${keyLines.length}行 ${keyLines.length < 5 ? '⚠️要確認' : '✅正常'}`);
    }
  }
  
  // 2. エンドポイント設定
  console.log("\n--- エンドポイント設定 ---");
  console.log(`CLOUD_FUNCTION_URL: ${CLOUD_FUNCTION_INVOCATION_URL || '未設定'}`);
  
  // 3. Config設定確認
  console.log("\n--- Config設定 ---");
  console.log(`config: ${typeof config !== 'undefined' ? '定義済み' : '未定義'}`);
  
  if (typeof config !== 'undefined') {
    console.log(`  - targetFolderId: ${config.targetFolderId || '未設定'}`);
    console.log(`  - destinationFolderId: ${config.destinationFolderId || '未設定'}`);
    console.log(`  - errorFolderId: ${config.errorFolderId || '未設定'}`);
    console.log(`  - geminiModel: ${config.geminiModel || '未設定'}`);
    console.log(`  - errorNotificationEmails: ${config.errorNotificationEmails || '未設定'}`);
  }
  
  // 4. 初期化エラー情報
  if (INITIALIZATION_ERROR) {
    console.log("\n--- 初期化エラー ---");
    console.log(`エラー: ${INITIALIZATION_ERROR.message}`);
    console.log(`スタック: ${INITIALIZATION_ERROR.stack || 'なし'}`);
  }
  
  // 5. Secret Manager設定確認
  console.log("\n--- Secret Manager設定 ---");
  console.log(`projectId: ${SECRET_MANAGER_CONFIG.projectId}`);
  console.log(`secretId: ${SECRET_MANAGER_CONFIG.secretId}`);
  console.log(`fallbackEnabled: ${SECRET_MANAGER_CONFIG.fallbackEnabled}`);
  
  console.log("\n==================");
}

/**
 * プライベートキーの形式を診断し、必要に応じて自動修正を実行する関数
 * 
 * Google Cloud Platform サービスアカウントのプライベートキーは複数行形式である必要がありますが、
 * JSON文字列として保存・転送される際に改行文字がエスケープされ（\n → \\n）、
 * 1行のテキストとして扱われることがあります。この状態では認証が失敗するため、
 * 自動的に検出・修正する機能を提供します。
 * 
 * 診断項目：
 * - 実際の改行文字（\n）の存在確認
 * - エスケープされた改行文字（\\n）の検出
 * - プライベートキーの行数チェック（正常：25行以上）
 * 
 * 修正処理：
 * - エスケープされた\\nを実際の改行文字\nに変換
 * - 修正後の形式検証
 * - グローバル変数SA_CREDENTIALSへの修正適用
 * 
 * @function diagnoseAndFixPrivateKey
 * @returns {boolean} 修正が実行された場合はtrue、修正不要または修正不可の場合はfalse
 * 
 * @example
 * // 認証エラー発生時の診断・修正
 * const wasFixed = diagnoseAndFixPrivateKey();
 * if (wasFixed) {
 *   console.log("プライベートキーを修正しました。再度認証をお試しください。");
 * }
 * 
 * @throws {Error} SA_CREDENTIALSが未設定の場合
 * 
 * @since 1.0.0
 */
function diagnoseAndFixPrivateKey() {
  console.log("=== プライベートキー診断・修正 ===");
  
  if (!SA_CREDENTIALS || !SA_CREDENTIALS.private_key) {
    console.log("❌ SA_CREDENTIALSまたはprivate_keyが存在しません");
    return false;
  }
  
  const originalKey = SA_CREDENTIALS.private_key;
  console.log(`現在のキー形式: ${originalKey.length}文字, ${originalKey.split('\n').length}行`);
  
  // 診断: 改行文字の状態確認
  const hasRealNewlines = originalKey.includes('\n');
  const hasEscapedNewlines = originalKey.includes('\\n');
  
  console.log(`実際の改行文字(\\n): ${hasRealNewlines ? 'あり' : 'なし'}`);
  console.log(`エスケープされた改行(\\\\n): ${hasEscapedNewlines ? 'あり' : 'なし'}`);
  
  if (!hasRealNewlines && hasEscapedNewlines) {
    console.log("🔨 改行文字の修正が必要です。修正を実行します...");
    
    // エスケープされた\\nを実際の改行文字に変換
    const correctedKey = originalKey.replace(/\\n/g, '\n');
    const correctedLines = correctedKey.split('\n');
    
    console.log(`修正後: ${correctedKey.length}文字, ${correctedLines.length}行`);
    
    // 修正を適用
    SA_CREDENTIALS.private_key = correctedKey;
    
    // 修正結果の確認
    if (correctedLines.length > 5) {
      console.log("✅ プライベートキーの修正完了");
      console.log("先頭行:", correctedLines[0]);
      console.log("最終行:", correctedLines[correctedLines.length - 1]);
      return true;
    } else {
      console.log("⚠️ 修正後も行数が少ないため、元のキー形式を確認してください");
      return false;
    }
  } else if (hasRealNewlines) {
    console.log("✅ プライベートキーの形式は正常です");
    return false;
  } else {
    console.log("❌ プライベートキーに改行文字が含まれていません。手動確認が必要です");
    return false;
  }
}

/**
 * 認証情報の取得元（Secret Manager / Script Properties）を診断する関数
 * 
 * OCRシステムは認証情報を2つのソースから取得できるよう設計されています：
 * 1. Google Secret Manager（推奨）
 * 2. Google Apps Script のスクリプトプロパティ（フォールバック）
 * 
 * 障害時にどちらのソースに問題があるかを特定し、適切な対処方針を決定するための
 * 診断情報を提供します。
 * 
 * 診断項目：
 * - Secret Managerからの認証情報取得テスト
 * - スクリプトプロパティからの認証情報取得テスト
 * - 各ソースでのプライベートキー形式チェック
 * - アクセス権限の確認
 * 
 * @function checkCredentialsSources
 * @returns {Object} 診断結果オブジェクト
 * @returns {boolean} returns.secretManagerAvailable - Secret Managerからの取得可否
 * @returns {boolean} returns.scriptPropertiesAvailable - スクリプトプロパティからの取得可否
 * @returns {string} returns.recommendation - 推奨される対処方針
 * 
 * @example
 * // 認証問題の原因調査
 * const diagnosis = checkCredentialsSources();
 * if (!diagnosis.secretManagerAvailable && diagnosis.scriptPropertiesAvailable) {
 *   console.log("Secret Managerに問題があります。スクリプトプロパティでフォールバック中。");
 * }
 * 
 * @since 1.0.0
 */
function checkCredentialsSources() {
  console.log("=== 認証情報ソース確認 ===");
  
  const result = {
    secretManagerAvailable: false,
    scriptPropertiesAvailable: false,
    recommendation: ""
  };
  
  // 1. Secret Manager確認
  try {
    console.log("Secret Managerから直接取得テスト...");
    const smCredentials = getServiceAccountCredentialsFromSecretManager_();
    if (smCredentials && smCredentials.private_key) {
      const smLines = smCredentials.private_key.split('\n');
      console.log(`Secret Manager: 取得成功 (${smLines.length}行)`);
      result.secretManagerAvailable = true;
      
      if (smLines.length < 5) {
        console.log("⚠️ Secret Manager内のprivate_keyも1行になっています");
        console.log("先頭100文字:", smCredentials.private_key.substring(0, 100));
      }
    } else {
      console.log("❌ Secret Manager: 認証情報の取得に失敗");
    }
  } catch (error) {
    console.log(`❌ Secret Manager確認エラー: ${error.message}`);
  }
  
  // 2. スクリプトプロパティ確認
  try {
    console.log("スクリプトプロパティ確認...");
    const scriptProperties = PropertiesService.getScriptProperties();
    const propCredentials = scriptProperties.getProperty('SA_CREDENTIALS_JSON');
    
    if (propCredentials) {
      const parsed = JSON.parse(propCredentials);
      if (parsed.private_key) {
        const propLines = parsed.private_key.split('\n');
        console.log(`スクリプトプロパティ: 取得成功 (${propLines.length}行)`);
        result.scriptPropertiesAvailable = true;
        
        if (propLines.length < 5) {
          console.log("⚠️ スクリプトプロパティ内のprivate_keyも1行になっています");
        }
      } else {
        console.log("❌ スクリプトプロパティ: private_keyが見つかりません");
      }
    } else {
      console.log("❌ スクリプトプロパティ 'SA_CREDENTIALS_JSON' が見つかりません");
    }
  } catch (error) {
    console.log(`❌ スクリプトプロパティ確認エラー: ${error.message}`);
  }
  
  // 推奨事項の決定
  if (result.secretManagerAvailable && result.scriptPropertiesAvailable) {
    result.recommendation = "両方のソースが利用可能です。Secret Managerが優先使用されます。";
  } else if (result.secretManagerAvailable) {
    result.recommendation = "Secret Managerのみ利用可能。正常動作が期待されます。";
  } else if (result.scriptPropertiesAvailable) {
    result.recommendation = "スクリプトプロパティのみ利用可能。Secret Managerの設定確認を推奨。";
  } else {
    result.recommendation = "両方のソースで問題発生。認証情報の再設定が必要です。";
  }
  
  console.log(`\n💡 推奨事項: ${result.recommendation}`);
  return result;
}

/**
 * Google Driveフォルダへのアクセス権限を診断する関数
 * 
 * OCRシステムは複数のGoogle Driveフォルダに依存しており、
 * それぞれに適切なアクセス権限が必要です。障害時にフォルダアクセスの
 * 問題を迅速に特定するための診断機能を提供します。
 * 
 * 確認対象フォルダ：
 * - targetFolderId: OCR処理対象ファイルの格納フォルダ
 * - destinationFolderId: 処理完了ファイルの移動先フォルダ
 * - errorFolderId: エラーファイルの移動先フォルダ（任意）
 * 
 * 診断内容：
 * - フォルダの存在確認
 * - 読み取り権限の確認
 * - フォルダ名の取得
 * - 親フォルダ情報の確認
 * 
 * @function testFolderAccess
 * @returns {Object} 診断結果オブジェクト
 * @returns {Array<Object>} returns.results - 各フォルダの診断結果
 * @returns {boolean} returns.allAccessible - 全フォルダがアクセス可能かどうか
 * 
 * @example
 * // フォルダアクセス問題の診断
 * const folderDiagnosis = testFolderAccess();
 * if (!folderDiagnosis.allAccessible) {
 *   console.log("一部のフォルダにアクセスできません。権限設定を確認してください。");
 * }
 * 
 * @since 1.0.0
 */
function testFolderAccess() {
  console.log("=== フォルダアクセステスト ===");
  
  const foldersToTest = [
    { name: "対象フォルダ", id: config.targetFolderId, required: true },
    { name: "移動先フォルダ", id: config.destinationFolderId, required: true },
    { name: "エラーフォルダ", id: config.errorFolderId, required: false }
  ];
  
  const results = [];
  let allAccessible = true;
  
  for (const folder of foldersToTest) {
    const folderResult = {
      name: folder.name,
      id: folder.id,
      accessible: false,
      error: null,
      metadata: null
    };
    
    if (!folder.id) {
      const message = `ID未設定`;
      console.log(`${folder.required ? '❌' : '⚠️'} ${folder.name}: ${message}`);
      folderResult.error = message;
      if (folder.required) allAccessible = false;
    } else {
      try {
        const metadata = Drive.Files.get(folder.id, { 
          supportsAllDrives: true, 
          fields: 'id,name,parents' 
        });
        console.log(`✅ ${folder.name}: アクセス可能 (${metadata.name})`);
        folderResult.accessible = true;
        folderResult.metadata = metadata;
      } catch (error) {
        const message = `アクセス失敗 - ${error.message}`;
        console.log(`❌ ${folder.name}: ${message}`);
        folderResult.error = message;
        allAccessible = false;
      }
    }
    
    results.push(folderResult);
  }
  
  return {
    results: results,
    allAccessible: allAccessible
  };
}

/**
 * システム初期化を手動で再実行する関数
 * 
 * システムの初期化処理に失敗した場合や、認証情報を更新した後に
 * 再初期化を行うための機能です。既存の状態をクリアしてから
 * 初期化を実行し、結果を詳細に報告します。
 * 
 * 実行内容：
 * 1. 現在の初期化状態をリセット
 * 2. 認証情報キャッシュをクリア
 * 3. initializeSystemCredentials()を再実行
 * 4. 初期化結果の詳細確認
 * 
 * 使用場面：
 * - 認証情報を修正した後
 * - システム起動時の初期化に失敗した場合
 * - Secret Manager設定を変更した後
 * 
 * @function retryInitialization
 * @returns {boolean} 初期化が成功した場合はtrue、失敗した場合はfalse
 * 
 * @example
 * // 認証問題修正後の再初期化
 * diagnoseAndFixPrivateKey();
 * const success = retryInitialization();
 * if (success) {
 *   console.log("システムは正常に初期化されました。OCR処理を再開できます。");
 * }
 * 
 * @since 1.0.0
 */
function retryInitialization() {
  console.log("=== 手動初期化再試行 ===");
  console.log("現在の状態をリセットします...");
  
  // 状態リセット
  SYSTEM_INITIALIZED = false;
  INITIALIZATION_ERROR = null;
  SA_CREDENTIALS = null;
  
  console.log("初期化を実行中...");
  const result = initializeSystemCredentials();
  
  console.log(`結果: ${result ? '✅成功' : '❌失敗'}`);
  
  if (result) {
    console.log("システムは正常に初期化されました。");
  } else {
    console.log("初期化に失敗しました。詳細を確認してください。");
  }
  
  // 状態確認を実行
  checkSystemStatus();
  
  return result;
}

/**
 * 包括的なシステムヘルスチェックを実行する統合診断関数
 * 
 * 障害発生時や定期メンテナンス時に、システム全体の健全性を
 * ワンストップで確認するための統合診断機能です。
 * 個別の診断関数を組み合わせて、包括的な状態確認を実行します。
 * 
 * 実行される診断：
 * 1. システム状態の詳細確認
 * 2. フォルダアクセス権限の確認
 * 3. 認証情報ソースの診断
 * 4. プライベートキー形式の確認
 * 
 * @function runFullSystemHealthCheck
 * @returns {Object} 統合診断結果オブジェクト
 * @returns {boolean} returns.systemHealthy - システム全体の健全性
 * @returns {Array<string>} returns.issues - 発見された問題のリスト
 * @returns {Array<string>} returns.recommendations - 推奨される対処方針
 * 
 * @example
 * // 定期メンテナンス時の健全性確認
 * const healthCheck = runFullSystemHealthCheck();
 * if (!healthCheck.systemHealthy) {
 *   console.log("システムに問題が発見されました:");
 *   healthCheck.issues.forEach(issue => console.log(`- ${issue}`));
 * }
 * 
 * // 障害発生時の緊急診断
 * console.log("システム障害が発生しました。診断を開始します...");
 * runFullSystemHealthCheck();
 * 
 * @since 1.0.0
 */
function runFullSystemHealthCheck() {
  console.log("🔍 包括的システムヘルスチェック開始");
  console.log("=".repeat(50));
  
  const issues = [];
  const recommendations = [];
  
  // 1. システム状態確認
  console.log("\n1️⃣ システム基本状態の確認");
  checkSystemStatus();
  
  // システム初期化状態のチェック
  if (!SYSTEM_INITIALIZED) {
    issues.push("システムが初期化されていません");
    recommendations.push("retryInitialization()を実行してください");
  }
  
  if (!SA_CREDENTIALS) {
    issues.push("サービスアカウント認証情報が設定されていません");
    recommendations.push("認証情報の設定を確認してください");
  }
  
  // 2. フォルダアクセステスト
  console.log("\n2️⃣ フォルダアクセス権限の確認");
  const folderDiagnosis = testFolderAccess();
  if (!folderDiagnosis.allAccessible) {
    issues.push("一部のフォルダにアクセスできません");
    recommendations.push("Google Driveのフォルダ権限設定を確認してください");
  }
  
  // 3. 認証情報ソース診断
  console.log("\n3️⃣ 認証情報ソースの確認");
  const credentialsDiagnosis = checkCredentialsSources();
  if (!credentialsDiagnosis.secretManagerAvailable && !credentialsDiagnosis.scriptPropertiesAvailable) {
    issues.push("認証情報を取得できません");
    recommendations.push("Secret ManagerまたはScript Propertiesの設定を確認してください");
  }
  
  // 4. プライベートキー形式確認
  console.log("\n4️⃣ プライベートキー形式の確認");
  if (SA_CREDENTIALS && SA_CREDENTIALS.private_key) {
    const keyLines = SA_CREDENTIALS.private_key.split('\n');
    if (keyLines.length < 5) {
      issues.push("プライベートキーの形式に問題があります");
      recommendations.push("diagnoseAndFixPrivateKey()を実行してください");
    }
  }
  
  // 結果サマリー
  console.log("\n" + "=".repeat(50));
  console.log("🎯 ヘルスチェック完了");
  
  const systemHealthy = issues.length === 0;
  
  if (systemHealthy) {
    console.log("✅ システムは正常に動作しています");
  } else {
    console.log(`❌ ${issues.length}件の問題が発見されました:`);
    issues.forEach((issue, index) => {
      console.log(`   ${index + 1}. ${issue}`);
    });
    
    console.log("\n💡 推奨される対処方針:");
    recommendations.forEach((recommendation, index) => {
      console.log(`   ${index + 1}. ${recommendation}`);
    });
  }
  
  return {
    systemHealthy: systemHealthy,
    issues: issues,
    recommendations: recommendations,
    folderAccess: folderDiagnosis,
    credentialsSources: credentialsDiagnosis
  };
}