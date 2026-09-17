/**
 * `executeDriveExport.ts`の`classifyDriveExportErrorKind()`(Issue #871計画書§7・Issue #881)の
 * 純粋関数テスト。ロジック自体はFirestore/Drive I/Oに依存しないが、`executeDriveExport.ts`は
 * `exportDocument.ts`→`../utils/driveAuth.ts`という経路でmodule-level `admin.firestore()`呼び出し
 * (`exchangeGmailAuthCodeMessage.test.ts`冒頭コメント参照の既知の制約と同型)を持つため、
 * `admin.initializeApp()`未実行の状態ではimport自体が`app/no-app`で失敗する。
 *
 * `Integration`命名にして`test:integration:drive`(Firestore emulator)経由で実行する
 * (`--ignore 'test/*Integration.test.ts'`で`npm test`本体からは除外される)。
 *
 * **重要な教訓**: 当初は本ファイル内で独自に`admin.initializeApp({projectId:'...'})`を
 * (emulator host設定なしで)呼ぶ方式を試したが、これは`npm test`(全体、emulatorなし)の
 * 同一mochaプロセス内で走る他の無関係なテスト(`textCap.test.ts`)がdefault appを共有してしまい、
 * 存在しない偽プロジェクトへの実際のFirestore書込みを引き起こしPERMISSION_DENIEDで
 * 無関係のテストを壊す実害が発生した(実機確認済み)。`test/helpers/initFirestoreEmulator.ts`
 * (emulator host設定を含む、既存の全integrationテストが使う唯一の初期化経路)を必ず使うこと。
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import { classifyDriveExportErrorKind } from '../src/drive/executeDriveExport';
import {
  AmbiguousFolderError,
  FolderCreationInProgressError,
  FolderVerificationPendingError,
  DrivePermissionError,
  DivergentFolderClaimError,
  FolderClaimCommitError,
  FolderClaimRestoreCommitError,
} from '../src/drive/driveFolderClaim';
import { CustomerUnconfirmedError, DriveSettingsIncompleteError, AmbiguousFileError } from '../src/drive/exportDocument';
import {
  FuriganaMissingError,
  CareManagerMissingError,
  DocumentCategoryMissingError,
  CustomerNameMissingError,
  FileDateMissingError,
} from '../src/drive/folderPath';

describe('classifyDriveExportErrorKind (Issue #871計画書§7・Issue #881)', () => {
  describe('transient判定', () => {
    it('FolderCreationInProgressError は transient', () => {
      expect(
        classifyDriveExportErrorKind(new FolderCreationInProgressError('利用者A', 'parent-1'))
      ).to.equal('transient');
    });

    it('FolderVerificationPendingError は transient', () => {
      expect(
        classifyDriveExportErrorKind(new FolderVerificationPendingError('利用者A', 'parent-1'))
      ).to.equal('transient');
    });

    it('FolderClaimCommitError は transient', () => {
      expect(
        classifyDriveExportErrorKind(
          new FolderClaimCommitError('利用者A', 'parent-1', 'folder-1', new Error('firestore write failed'))
        )
      ).to.equal('transient');
    });

    it('FolderClaimRestoreCommitError は transient', () => {
      expect(
        classifyDriveExportErrorKind(
          new FolderClaimRestoreCommitError('利用者A', 'parent-1', 'folder-1', new Error('firestore write failed'))
        )
      ).to.equal('transient');
    });
  });

  describe('permanent判定(アプリ内エラークラス)', () => {
    it('CustomerUnconfirmedError は permanent', () => {
      expect(classifyDriveExportErrorKind(new CustomerUnconfirmedError('田中太郎'))).to.equal('permanent');
    });

    it('DriveSettingsIncompleteError は permanent', () => {
      expect(classifyDriveExportErrorKind(new DriveSettingsIncompleteError('rootFolderId'))).to.equal(
        'permanent'
      );
    });

    it('AmbiguousFolderError(AmbiguousFolderErrorBase) は permanent', () => {
      expect(classifyDriveExportErrorKind(new AmbiguousFolderError('利用者A', 'parent-1', 2))).to.equal(
        'permanent'
      );
    });

    it('AmbiguousFileError は permanent', () => {
      expect(classifyDriveExportErrorKind(new AmbiguousFileError('doc-1', 'parent-1', 2))).to.equal(
        'permanent'
      );
    });

    it('DivergentFolderClaimError は permanent', () => {
      expect(
        classifyDriveExportErrorKind(new DivergentFolderClaimError('利用者A', 'parent-1', 'folder-1', 'folder-2'))
      ).to.equal('permanent');
    });

    it('DrivePermissionError は permanent', () => {
      expect(
        classifyDriveExportErrorKind(new DrivePermissionError('利用者A', 'parent-1', 'folder-1'))
      ).to.equal('permanent');
    });

    it('FuriganaMissingError は permanent', () => {
      expect(classifyDriveExportErrorKind(new FuriganaMissingError('田中太郎'))).to.equal('permanent');
    });

    it('CareManagerMissingError は permanent', () => {
      expect(classifyDriveExportErrorKind(new CareManagerMissingError())).to.equal('permanent');
    });

    it('DocumentCategoryMissingError は permanent', () => {
      expect(classifyDriveExportErrorKind(new DocumentCategoryMissingError())).to.equal('permanent');
    });

    it('CustomerNameMissingError は permanent', () => {
      expect(classifyDriveExportErrorKind(new CustomerNameMissingError())).to.equal('permanent');
    });

    it('FileDateMissingError は permanent', () => {
      expect(classifyDriveExportErrorKind(new FileDateMissingError())).to.equal('permanent');
    });
  });

  describe('HTTPステータスが実在する生のDrive APIエラー(classifyDriveApiError委譲)', () => {
    it('status:500 は transient', () => {
      expect(classifyDriveExportErrorKind({ status: 500 })).to.equal('transient');
    });

    it('status:429 は transient(rateLimited)', () => {
      expect(classifyDriveExportErrorKind({ status: 429 })).to.equal('transient');
    });

    it('status:404 は permanent(notFound)', () => {
      expect(classifyDriveExportErrorKind({ status: 404 })).to.equal('permanent');
    });

    it('status:401 は permanent(unauthenticated)', () => {
      expect(classifyDriveExportErrorKind({ status: 401 })).to.equal('permanent');
    });

    it('status:403(reason未指定) は permanent(permissionDenied)', () => {
      expect(classifyDriveExportErrorKind({ status: 403 })).to.equal('permanent');
    });

    it('response.status:400(未知の4xx) は permanent(unknown)', () => {
      expect(classifyDriveExportErrorKind({ response: { status: 400 } })).to.equal('permanent');
    });

    it('数値codeのみでstatusを持たないエラー(例: @google-cloud/storage ApiErrorのcode:503)は transient(fable-review指摘Medium-1)', () => {
      expect(classifyDriveExportErrorKind({ code: 503 })).to.equal('transient');
    });

    it('数値codeのみでstatusを持たないエラー(code:404)は permanent(fable-review指摘Medium-1)', () => {
      expect(classifyDriveExportErrorKind({ code: 404 })).to.equal('permanent');
    });
  });

  describe('gRPCステータスコード(0〜16の数値空間、fable-review 1巡目Medium-2 + 2巡目High-1)', () => {
    // Firestore SDK(@google-cloud/firestore transaction.jsのisRetryableTransactionError)が
    // 内部リトライ対象とするコード = transient
    it('code:1(CANCELLED)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 1 })).to.equal('transient');
    });
    it('code:2(UNKNOWN)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 2 })).to.equal('transient');
    });
    it('code:4(DEADLINE_EXCEEDED)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 4 })).to.equal('transient');
    });
    it('code:8(RESOURCE_EXHAUSTED)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 8 })).to.equal('transient');
    });
    it('code:10(ABORTED、Issue #526でFirestore transaction書込競合はtransientと確立済み)は transient(2巡目レビューHigh-1、1巡目のMedium-1修正が持ち込んだ回帰の再発防止テスト)', () => {
      expect(classifyDriveExportErrorKind({ code: 10 })).to.equal('transient');
    });
    it('code:13(INTERNAL)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 13 })).to.equal('transient');
    });
    it('code:14(UNAVAILABLE)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 14 })).to.equal('transient');
    });
    it('code:16(UNAUTHENTICATED)は transient', () => {
      expect(classifyDriveExportErrorKind({ code: 16 })).to.equal('transient');
    });
    // Firestore SDKのリトライ対象外 = permanent(gRPC体系だがHTTPステータスとは別判定)
    it('code:9(FAILED_PRECONDITION)は permanent', () => {
      expect(classifyDriveExportErrorKind({ code: 9 })).to.equal('permanent');
    });
    it('code:3(INVALID_ARGUMENT)は permanent', () => {
      expect(classifyDriveExportErrorKind({ code: 3 })).to.equal('permanent');
    });
  });

  describe('HTTPステータスを持たない生エラー(H1修正: isTransientError()委譲、fail-closedでpermanentへ倒れることの確認)', () => {
    it('ECONNRESET(既知のネットワーク層エラーコード)は transient', () => {
      const err = new Error('connection reset') as Error & { code?: string };
      err.code = 'ECONNRESET';
      expect(classifyDriveExportErrorKind(err)).to.equal('transient');
    });

    it('statusもcodeも持たない素のError(例: document not found)は permanent', () => {
      expect(classifyDriveExportErrorKind(new Error('document not found: doc-1'))).to.equal('permanent');
    });

    it('idが取得できない旨の素のErrorは permanent(H1修正前は誤ってtransientになっていた回帰ケース)', () => {
      expect(
        classifyDriveExportErrorKind(new Error('既存フォルダのidが取得できません: "利用者A"'))
      ).to.equal('permanent');
    });
  });
});
