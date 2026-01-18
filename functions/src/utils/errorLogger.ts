/**
 * エラーログ記録ユーティリティ
 *
 * error-handling-policy.md に基づくエラー分類・記録・通知
 */

import * as admin from 'firebase-admin';
import { isTransientError } from './retry';

const db = admin.firestore();

/** エラーカテゴリ */
export type ErrorCategory = 'transient' | 'recoverable' | 'fatal' | 'data';

/** 重要度 */
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

/** エラー発生源 */
export type ErrorSource = 'gmail' | 'ocr' | 'pdf' | 'storage' | 'auth';

/** エラーログスキーマ */
export interface ErrorLog {
  id: string;
  createdAt: admin.firestore.FieldValue;
  resolvedAt?: admin.firestore.FieldValue;

  // エラー分類
  category: ErrorCategory;
  severity: ErrorSeverity;

  // 発生コンテキスト
  source: ErrorSource;
  functionName: string;
  documentId?: string;
  fileId?: string;

  // エラー詳細
  errorCode: string;
  errorMessage: string;
  stackTrace?: string;
  retryCount: number;

  // 解決情報
  status: 'pending' | 'resolved' | 'ignored';
  resolution?: string;
  resolvedBy?: string;
}

/** 致命的エラーのコード */
const FATAL_ERROR_CODES = [
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
];

/** データエラーのキーワード */
const DATA_ERROR_KEYWORDS = [
  'invalid pdf',
  'corrupted',
  'unsupported format',
  'file too large',
  'malformed',
];

/**
 * エラーをカテゴリに分類
 */
export function categorizeError(error: Error): ErrorCategory {
  // 一時的エラー
  if (isTransientError(error)) {
    return 'transient';
  }

  const errorWithCode = error as Error & { code?: string };
  const message = error.message.toLowerCase();

  // 致命的エラー
  if (errorWithCode.code && FATAL_ERROR_CODES.includes(errorWithCode.code)) {
    return 'fatal';
  }

  // データエラー
  if (DATA_ERROR_KEYWORDS.some((keyword) => message.includes(keyword))) {
    return 'data';
  }

  // それ以外は回復可能エラー
  return 'recoverable';
}

/**
 * カテゴリから重要度を取得
 */
export function getSeverity(category: ErrorCategory): ErrorSeverity {
  switch (category) {
    case 'fatal':
      return 'critical';
    case 'transient':
      return 'warning';
    case 'data':
      return 'error';
    case 'recoverable':
      return 'warning';
    default:
      return 'error';
  }
}

/**
 * 通知が必要かどうか判定
 */
export function shouldNotify(category: ErrorCategory, severity: ErrorSeverity): boolean {
  // 致命的エラーは即時通知
  if (category === 'fatal' || severity === 'critical') {
    return true;
  }
  // それ以外は通知しない（日次サマリーで対応）
  return false;
}

/** エラーログ記録パラメータ */
export interface LogErrorParams {
  error: Error;
  source: ErrorSource;
  functionName: string;
  documentId?: string;
  fileId?: string;
  retryCount?: number;
}

/**
 * エラーをFirestoreに記録
 *
 * @returns 作成されたエラーログID
 */
export async function logError(params: LogErrorParams): Promise<string> {
  const category = categorizeError(params.error);
  const severity = getSeverity(category);

  const errorWithCode = params.error as Error & { code?: string };

  const errorDoc: ErrorLog = {
    id: db.collection('errors').doc().id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    category,
    severity,
    source: params.source,
    functionName: params.functionName,
    documentId: params.documentId,
    fileId: params.fileId,
    errorCode: errorWithCode.code || params.error.name || 'UNKNOWN',
    errorMessage: params.error.message,
    retryCount: params.retryCount || 0,
    status: 'pending',
  };

  // 開発環境のみスタックトレース保存
  if (process.env.NODE_ENV !== 'production') {
    errorDoc.stackTrace = params.error.stack;
  }

  await db.doc(`errors/${errorDoc.id}`).set(errorDoc);

  // コンソールにも出力
  console.error(`[${severity.toUpperCase()}] ${params.source}/${params.functionName}:`, {
    errorCode: errorDoc.errorCode,
    errorMessage: errorDoc.errorMessage,
    category,
    documentId: params.documentId,
    retryCount: params.retryCount,
  });

  // 通知判定
  if (shouldNotify(category, severity)) {
    await sendNotification(errorDoc);
  }

  return errorDoc.id;
}

/**
 * 通知を送信
 */
async function sendNotification(errorLog: ErrorLog): Promise<void> {
  try {
    // Firestoreに通知記録
    await db.collection('notifications').add({
      type: 'error',
      errorId: errorLog.id,
      source: errorLog.source,
      severity: errorLog.severity,
      message: `[${errorLog.source}] ${errorLog.errorCode}: ${errorLog.errorMessage}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.log(`Notification created for error: ${errorLog.id}`);
  } catch (error) {
    // 通知失敗はログのみ（無限ループ防止）
    console.error('Failed to create notification:', error);
  }
}

/**
 * ドキュメントのステータスをエラーに更新
 */
export async function markDocumentAsError(
  documentId: string,
  errorId: string,
  errorMessage: string
): Promise<void> {
  await db.doc(`documents/${documentId}`).update({
    status: 'error',
    lastErrorId: errorId,
    lastErrorMessage: errorMessage,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * エラーを解決済みにマーク
 */
export async function resolveError(
  errorId: string,
  resolution: string,
  resolvedBy?: string
): Promise<void> {
  await db.doc(`errors/${errorId}`).update({
    status: 'resolved',
    resolution,
    resolvedBy,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
