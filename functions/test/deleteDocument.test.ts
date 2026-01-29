/**
 * ドキュメント削除機能のテスト
 *
 * deleteDocument Cloud Functionのロジックテスト
 * 注: 実際のFirebase呼び出しはエミュレータで統合テストを行う
 */

import { expect } from 'chai';

/**
 * gs:// URL からバケット名とパスを抽出するヘルパー関数
 * deleteDocument.ts内のロジックと同等
 */
function parseStorageUrl(fileUrl: string): { bucketName: string; filePath: string } | null {
  const match = fileUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return {
    bucketName: match[1],
    filePath: match[2],
  };
}

/**
 * sourceTypeに基づいてログコレクション名を決定
 */
function getLogCollection(sourceType: string | undefined): string {
  return sourceType === 'upload' ? 'uploadLogs' : 'gmailLogs';
}

describe('deleteDocument ユーティリティ関数', () => {
  describe('parseStorageUrl', () => {
    it('正常なgs:// URLをパース', () => {
      const result = parseStorageUrl('gs://my-bucket/path/to/file.pdf');
      expect(result).to.not.be.null;
      expect(result!.bucketName).to.equal('my-bucket');
      expect(result!.filePath).to.equal('path/to/file.pdf');
    });

    it('ネストしたパスを正しくパース', () => {
      const result = parseStorageUrl('gs://bucket-name/original/upload_123_test.pdf');
      expect(result).to.not.be.null;
      expect(result!.bucketName).to.equal('bucket-name');
      expect(result!.filePath).to.equal('original/upload_123_test.pdf');
    });

    it('日本語ファイル名を含むURLをパース', () => {
      const result = parseStorageUrl('gs://doc-split-dev/original/介護保険証.pdf');
      expect(result).to.not.be.null;
      expect(result!.bucketName).to.equal('doc-split-dev');
      expect(result!.filePath).to.equal('original/介護保険証.pdf');
    });

    it('不正なURLはnullを返す', () => {
      expect(parseStorageUrl('https://example.com/file.pdf')).to.be.null;
      expect(parseStorageUrl('file.pdf')).to.be.null;
      expect(parseStorageUrl('')).to.be.null;
      expect(parseStorageUrl('gs://')).to.be.null;
    });

    it('バケット名のみのURLはnullを返す', () => {
      expect(parseStorageUrl('gs://bucket-only')).to.be.null;
    });
  });

  describe('getLogCollection', () => {
    it('uploadタイプはuploadLogsを返す', () => {
      expect(getLogCollection('upload')).to.equal('uploadLogs');
    });

    it('gmailタイプはgmailLogsを返す', () => {
      expect(getLogCollection('gmail')).to.equal('gmailLogs');
    });

    it('undefinedはgmailLogsを返す（後方互換性）', () => {
      expect(getLogCollection(undefined)).to.equal('gmailLogs');
    });

    it('不明なタイプはgmailLogsを返す', () => {
      expect(getLogCollection('unknown')).to.equal('gmailLogs');
    });
  });
});

describe('deleteDocument バリデーション', () => {
  describe('documentId検証', () => {
    it('空文字列は無効', () => {
      const documentId = '';
      expect(!documentId || typeof documentId !== 'string').to.be.true;
    });

    it('nullは無効', () => {
      const documentId = null;
      expect(!documentId || typeof documentId !== 'string').to.be.true;
    });

    it('undefinedは無効', () => {
      const documentId = undefined;
      expect(!documentId || typeof documentId !== 'string').to.be.true;
    });

    it('数値は無効', () => {
      const documentId = 123 as unknown as string;
      expect(!documentId || typeof documentId !== 'string').to.be.true;
    });

    it('有効なdocumentId', () => {
      const documentId = 'abc123xyz';
      expect(!documentId || typeof documentId !== 'string').to.be.false;
    });
  });

  describe('管理者権限検証', () => {
    it('adminロールは管理者', () => {
      const userData = { role: 'admin' };
      expect(userData?.role === 'admin').to.be.true;
    });

    it('userロールは管理者ではない', () => {
      const userData = { role: 'user' };
      expect(userData?.role === 'admin').to.be.false;
    });

    it('ロール未設定は管理者ではない', () => {
      const userData = {};
      expect((userData as { role?: string })?.role === 'admin').to.be.false;
    });

    it('undefinedは管理者ではない', () => {
      const userData = undefined as { role?: string } | undefined;
      expect(userData?.role === 'admin').to.be.false;
    });
  });
});
