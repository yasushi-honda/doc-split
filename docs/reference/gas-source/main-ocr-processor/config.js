// -------------------------------------------------------------------------
// 定数定義
// これらの定数はスクリプト全体で利用されます。
// -------------------------------------------------------------------------

/**
 * 各種設定値をまとめたオブジェクト
 */
const config = {
  // === APIと基本設定 ===
  geminiModel: "gemini-2.0-flash-001", // 使用するGeminiのモデル名
  targetFolderId: "1Z3iATGpHqPi51ZYXpvcanOdFq9pu8yjI", // OCR処理対象ファイルが格納されるフォルダID
  destinationFolderId: "1b_fUPZiLwysY39Zfjgf1yzNCs0a_h7UX", // 処理後にファイルが移動されるフォルダID
  errorFolderId: "1yiJusL582vfjN-nJBXyRU2fx_sNaPuL2",
  errorNotificationEmails: "hy.unimail.11@gmail.com",

  // === Gmail連携設定 ===
  gmail: {
    logSpreadsheetId: "138rGzfwZ5uz5Er_ZfNLWYYgwcDwfH7-4B_hqlaamFOM", // Gmail関連のログ用スプレッドシートID
    logSheetName: "Gmail受信管理T",                     // Gmail関連のログを記録するシート名
    targetLabel: "AI_OCR", // ★★★ カンマ区切りで複数のラベルを指定 ★★★
    labelSearchOperator: "OR" // ★★★ "AND" または "OR" を指定 (今回は "OR") ★★★
  },

  // === スプレッドシート設定 ===
  sheets: {
    // --- 書類マスター ---
    // 処理対象の書類名と、日付抽出のヒント（マーカー）を定義
    documentMaster: {
      spreadsheetId: "1IGiNSSyPjiC1WOTAwiWlK4IYf1iA9dmQVlefaAdOe0A", // 書類マスターのスプレッドシートID
      sheetName: "書類M",                                  // シート名
      columns: {
        documentName: "A", // 書類名が記載されている列
        dateMarker: "B"    // 日付抽出の目印となる文字列が記載されている列 (例: "発行日")
      },
      startRow: 2          // データが始まる行番号 (ヘッダーを除く)
    },

    // --- 顧客マスター ---
    // 顧客名と、同姓同名の識別のための情報を定義
    customerMaster: {
      spreadsheetId: "1X9o2fzUfMErKfriV1UTjF-KZX3PN9-IBj2JDINHTQYw", // 顧客マスターのスプレッドシートID
      sheetName: "顧客M",                                  // シート名
      columns: {
        customerName: "A", // 顧客氏名が記載されている列
        isDuplicateName: "B" // 同姓同名フラグが記載されている列 (TRUE/FALSE または チェックボックス)
      },
      startRow: 2          // データが始まる行番号 (ヘッダーを除く)
    },

    // --- 事業所マスター ---
    // 事業所名を定義
    officeMaster: {
      spreadsheetId: "1dgRqMvTWe1ZsVxRtjS-Vf6Ud4ucuhxwNMwVYDCR1hHc", // 事業所マスターのスプレッドシートID
      sheetName: "事業所M",                                  // シート名
      columns: {
        officeName: "A"   // 事業所名が記載されている列
      },
      startRow: 2         // データが始まる行番号 (ヘッダーを除く)
    },

    // --- トランザクションテーブル（書類管理T） ---
    // OCR処理結果のログを記録するテーブル
    documentTransaction: {
      spreadsheetId: "12uPNSGR75IAmX5BN3q9jzeHRrxM59kGCin3rUXfFRvI", // 書類管理テーブルのスプレッドシートID
      sheetName: "書類管理T",                                // シート名
      columns: {
        id: "A",                      // 一意のID (UUIDなど)
        processDate: "B",             // スクリプトによる処理日時
        fileId: "C",                  // Google DriveのファイルID
        fileName: "D",                // 処理後のファイル名
        mimeType: "E",                // ファイルのMIMEタイプ (例: "image/jpeg")
        ocrResult: "F",               // Gemini APIから得られたOCRテキスト全文
        documentName: "G",            // 識別された書類名 (書類マスターに基づく)
        customerName: "H",            // 識別された顧客名 (顧客マスターに基づく)
        officeName: "I",              // 識別された事業所名 (事業所マスターに基づく)
        fileUrl: "J",                 // Google Drive上のファイルへのリンクURL
        fileDate: "K",                // OCRテキストから抽出された日付 (YYYY/MM/DD形式)
        isDuplicateCustomerName: "L",  // 識別された顧客名がマスターで同姓同名フラグONか (TRUE/FALSE)
        allCustomerCandidates: "M",   // 全顧客候補を記録する列
        totalPages: "N",              // 総ページ数
        targetPageNumber: "O",        // 対象ページ番号
        pageText: "P"                 // 該当ページの元テキスト（一部）
      },
      headerRow: 1                 // ヘッダー行の行番号
    },

    // --- エラー履歴テーブル（エラー履歴T） ---
    // OCR処理エラーやシステムエラーを記録するテーブル
    errorHistory: {
      spreadsheetId: "1-1FLBRND3oY1O4A9TyrZuSB4vnQqSj0WNgKcRHvVXJc", // エラー履歴テーブルのスプレッドシートID
      sheetName: "エラー履歴T",                              // シート名
      columns: {
        errorId: "A",           // エラーID（一意識別子）
        errorDate: "B",         // エラー発生日時
        errorType: "C",         // エラー種別（OCR完全失敗、OCR部分失敗、システムエラー等）
        fileName: "D",          // ファイル名
        fileId: "E",            // ファイルID
        totalPages: "F",        // 総ページ数
        successPages: "G",      // 成功ページ数
        failedPages: "H",       // 失敗ページ数
        failedPageNumbers: "I", // 失敗ページ番号（カンマ区切り）
        errorDetails: "J",      // エラー詳細情報
        fileUrl: "K",           // ファイルURL
        status: "L"             // ステータス（未対応/対応中/完了）
      },
      headerRow: 1              // ヘッダー行の行番号
    },

    // === 保守監視設定 ===
    maintenance: {
      enabled: true,
      scheduleHour: 6,

      log: {
        spreadsheetId: "1jamwSI9ksqVjWONnW1bbyxxir8kGjwmKGyf2mhtqSKQ",
        sheetName: "保守T"
      },

      thresholds: {
        ocrErrorRate: 15,
        systemErrorCount: 3,
        consecutiveFailures: 2
      },

      monitoringWindow: {
        hours: 24,
        trendDays: 3
      }
    }
  }
};

const STATUS_UNDETERMINED = "未判定"; // 未識別の情報に対する代替文字列
const FILE_NAME_UNKNOWN_DOCUMENT = "不明文書"; // ファイル名に使用する不明な書類の代替文字列
const FILE_NAME_UNKNOWN_CUSTOMER = "不明顧客"; // ファイル名に使用する不明な顧客の代替文字列
const LOG_SHEET_DEFAULT_HEADER_ROW = 1; // ログシートのデフォルトのヘッダー行番号
const CUSTOMER_SIMILARITY_THRESHOLD = 70; // 顧客名・事業所名識別の類似度閾値 (0-100)
const DOCUMENT_NAME_SEARCH_RANGE_CHARS = 200; // 書類名検索時のOCRテキスト先頭からの文字数
const DATE_MARKER_SEARCH_RANGE_CHARS = 50;     // 日付マーカー後の日付検索文字数
const CLOUD_FUNCTION_INVOCATION_URL = 'https://us-central1-auto-doc-ocr-gemini.cloudfunctions.net/ocrGeminiNew'; // Cloud FunctionのエンドポイントURLを定義します。

// -------------------------------------------------------------------------
// Secret Manager 設定
// -------------------------------------------------------------------------
const SECRET_MANAGER_CONFIG = {
  projectId: 'auto-doc-ocr-gemini',
  secretId: 'service-account-credentials',
  versionId: 'latest',
  fallbackEnabled: true // スクリプトプロパティへのフォールバックを有効にする
};

// グローバル変数: サービスアカウントの認証情報オブジェクト
// Secret Managerから読み込み、この変数に格納されます。
var SA_CREDENTIALS = null;
var SYSTEM_INITIALIZED = false; // システム初期化フラグ
var INITIALIZATION_ERROR = null; // 初期化エラー情報

// =========================================================================
// エラー種別定数（エラー履歴T用）
// =========================================================================
const ERROR_TYPES = {
  OCR_COMPLETE_FAILURE: "OCR完全失敗",
  OCR_PARTIAL_FAILURE: "OCR部分失敗",
  EXTRACTION_ERROR: "情報抽出エラー",
  FILE_OPERATION_ERROR: "ファイル処理エラー",
  SYSTEM_ERROR: "システムエラー"
};

/**
 * 改善された認証情報初期化処理
 */
function initializeSecureCredentials_() {
  const SCRIPT_NAME = "initializeSecureCredentials_";

  try {
    // 1. Secret Managerから取得を試行
    Logger.log(`[${SCRIPT_NAME}] Secret Managerから認証情報を取得中...`);

    try {
      const credentials = getServiceAccountCredentialsFromSecretManager_();

      // 基本検証
      if (!credentials || !credentials.private_key || !credentials.client_email || !credentials.project_id) {
        throw new Error("Secret Managerから取得した認証情報の内容が不完全です");
      }

      Logger.log(`[${SCRIPT_NAME}] ✅ Secret Managerからの認証情報取得成功: ${credentials.project_id}`);
      return credentials;

    } catch (secretManagerError) {
      Logger.log(`[${SCRIPT_NAME}] Secret Manager取得失敗: ${secretManagerError.message}`);

      // 2. フォールバック: 既存のスクリプトプロパティ方式
      if (SECRET_MANAGER_CONFIG.fallbackEnabled) {
        Logger.log(`[${SCRIPT_NAME}] フォールバック: スクリプトプロパティから取得中...`);

        const scriptProperties = PropertiesService.getScriptProperties();
        const credentialsJsonString = scriptProperties.getProperty('SA_CREDENTIALS_JSON');

        if (!credentialsJsonString) {
          throw new Error('スクリプトプロパティ "SA_CREDENTIALS_JSON" も見つかりません');
        }

        const credentials = JSON.parse(credentialsJsonString);

        if (!credentials || !credentials.private_key || !credentials.client_email || !credentials.project_id) {
          throw new Error("スクリプトプロパティから取得した認証情報の内容が不完全です");
        }

        Logger.log(`[${SCRIPT_NAME}] ⚠️ フォールバック成功: スクリプトプロパティから取得: ${credentials.project_id}`);
        Logger.log(`[${SCRIPT_NAME}] 💡 推奨: Secret Managerの設定を確認してください`);

        return credentials;

      } else {
        throw new Error(`Secret Manager取得失敗、かつフォールバックが無効化されています: ${secretManagerError.message}`);
      }
    }

  } catch (error) {
    Logger.log(`[${SCRIPT_NAME}] 認証情報初期化の致命的失敗: ${error.message}`);
    return null;
  }
}

// -------------------------------------------------------------------------
// ★★★ グローバルスコープでの初期化処理の実行 ★★★
// -------------------------------------------------------------------------
initializeSystemCredentials(); // この呼び出しが重要
