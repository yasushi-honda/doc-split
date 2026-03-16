/**
 * displayFileName バックフィル テスト
 *
 * 既存ドキュメントに displayFileName を一括設定するマイグレーション用
 * バックフィル固有のロジック（Timestamp→文字列変換、ドキュメントデータからの生成）をテスト
 */

import { expect } from 'chai';
import {
  timestampToDateString,
  buildDisplayFileNameFromDoc,
} from '../src/utils/backfillDisplayFileName';

describe('displayFileName バックフィル', () => {
  describe('timestampToDateString', () => {
    it('Timestampオブジェクト（seconds/nanoseconds）を YYYY/MM/DD 文字列に変換', () => {
      // 2026-03-16 00:00:00 UTC → ローカルTZで解釈
      const ts = { seconds: 1773619200, nanoseconds: 0 };
      const result = timestampToDateString(ts);
      // UTCで2026-03-16。ローカルTZにより日付が変わりうるため、フォーマットのみ検証
      expect(result).to.match(/^\d{4}\/\d{2}\/\d{2}$/);
    });

    it('null の場合は undefined を返す', () => {
      expect(timestampToDateString(null)).to.be.undefined;
    });

    it('undefined の場合は undefined を返す', () => {
      expect(timestampToDateString(undefined)).to.be.undefined;
    });

    it('seconds が 0 の場合は undefined を返す（無効な日付）', () => {
      const ts = { seconds: 0, nanoseconds: 0 };
      expect(timestampToDateString(ts)).to.be.undefined;
    });

    it('toDate メソッドを持つ Timestamp インスタンスも変換可能', () => {
      // 2026-01-15 00:00:00 UTC（TZずれなし確認用に15日を使用）
      const ts = {
        seconds: 1768435200,
        nanoseconds: 0,
        toDate: () => new Date(1768435200 * 1000),
      };
      expect(timestampToDateString(ts)).to.equal('2026/01/15');
    });
  });

  describe('buildDisplayFileNameFromDoc', () => {
    it('全メタ情報が揃ったドキュメントから displayFileName を生成', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: { seconds: 1773619200, nanoseconds: 0 },
      };
      const result = buildDisplayFileNameFromDoc(doc);
      // 日付部分はTZにより変動するため、パターンで検証
      expect(result).to.match(/^介護保険証_デイサービスさくら_\d{8}_田中太郎\.pdf$/);
    });

    it('fileDate が null のドキュメントは日付部分を省略', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal(
        '介護保険証_デイサービスさくら_田中太郎.pdf'
      );
    });

    it('全てデフォルト値のドキュメントは null を返す', () => {
      const doc = {
        documentType: '未判定',
        customerName: '不明顧客',
        officeName: '',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.be.null;
    });

    it('メタ情報が空文字のドキュメントは該当部分を省略', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '',
        officeName: '',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal('介護保険証.pdf');
    });

    it('displayFileName が既に設定されているドキュメントでも生成可能（上書き判断は呼び出し側）', () => {
      const doc = {
        documentType: '診断書',
        customerName: '佐藤花子',
        officeName: '',
        fileDate: { seconds: 1773619200, nanoseconds: 0 },
      };
      const result = buildDisplayFileNameFromDoc(doc);
      expect(result).to.match(/^診断書_\d{8}_佐藤花子\.pdf$/);
    });
  });
});
