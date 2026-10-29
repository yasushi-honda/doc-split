/**
 * isCustomerUnconfirmedDriveExportError テスト
 *
 * 画面表記を「顧客」から「利用者」へ統一した際、Firestoreに保存済みの
 * `driveExportError`は旧prefix(顧客が未確定のため)のまま残る。新旧どちらも
 * 「利用者未確定によるブロック」として分類できることを固定する。
 * Firestore/Admin SDK非依存の純粋関数のためemulator不要。
 */

import { expect } from 'chai';
import {
  DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_MESSAGE_PREFIX,
  DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_LEGACY_MESSAGE_PREFIX,
  isCustomerUnconfirmedDriveExportError,
} from '../../shared/types';

describe('isCustomerUnconfirmedDriveExportError', () => {
  it('新prefix(利用者が未確定のため)で始まるメッセージはtrue', () => {
    expect(
      isCustomerUnconfirmedDriveExportError(
        `${DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_MESSAGE_PREFIX}Google Driveへエクスポートできません: 山田太郎`
      )
    ).to.equal(true);
  });

  it('旧prefix(顧客が未確定のため)で始まる保存済みメッセージもtrue', () => {
    expect(
      isCustomerUnconfirmedDriveExportError(
        '顧客が未確定のためGoogle Driveへエクスポートできません(書類詳細で顧客を選択・保存して確定すると自動で再試行されます): 山田太郎'
      )
    ).to.equal(true);
  });

  it('prefix定数の値が想定どおり(新旧で異なる)', () => {
    expect(DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_MESSAGE_PREFIX).to.equal('利用者が未確定のため');
    expect(DRIVE_EXPORT_CUSTOMER_UNCONFIRMED_LEGACY_MESSAGE_PREFIX).to.equal('顧客が未確定のため');
  });

  it('prefixが途中にあるだけ(先頭一致でない)ならfalse', () => {
    expect(isCustomerUnconfirmedDriveExportError('エラー: 利用者が未確定のため')).to.equal(false);
  });

  it('無関係なメッセージ・空文字はfalse', () => {
    expect(isCustomerUnconfirmedDriveExportError('Google Drive API error: quota exceeded')).to.equal(false);
    expect(isCustomerUnconfirmedDriveExportError('')).to.equal(false);
  });

  it('非string(undefined/null/数値)はfalse(fail-closed)', () => {
    expect(isCustomerUnconfirmedDriveExportError(undefined)).to.equal(false);
    expect(isCustomerUnconfirmedDriveExportError(null)).to.equal(false);
    expect(isCustomerUnconfirmedDriveExportError(123)).to.equal(false);
  });
});
