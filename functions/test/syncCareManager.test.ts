/**
 * 顧客マスターcareManagerName変更時の同期ロジック テスト
 *
 * TDD: #173 顧客マスターのcareManagerName変更が既存ドキュメントに反映されない
 *
 * ロジック:
 * - マスターのcareManagerNameが変更されたら、該当顧客のドキュメントを更新
 * - 変更検知: before/afterのcareManagerNameを比較
 * - 更新対象: customerName一致のドキュメント（customerIdがあればそちらを優先）
 */

import { expect } from 'chai';
import { detectCareManagerChange, buildCareManagerUpdate } from '../src/triggers/syncCareManagerLogic';

describe('顧客マスターcareManagerName同期 (#173)', () => {
  describe('detectCareManagerChange - 変更検知', () => {
    it('careManagerNameが変更された場合trueを返す', () => {
      const before = { name: '田村 勝義', careManagerName: '板垣 亜紀子' };
      const after = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      expect(detectCareManagerChange(before, after)).to.be.true;
    });

    it('careManagerNameが追加された場合trueを返す', () => {
      const before = { name: '田村 勝義' };
      const after = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      expect(detectCareManagerChange(before, after)).to.be.true;
    });

    it('careManagerNameが削除された場合trueを返す', () => {
      const before = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      const after = { name: '田村 勝義' };
      expect(detectCareManagerChange(before, after)).to.be.true;
    });

    it('careManagerNameが変わっていない場合falseを返す', () => {
      const before = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      const after = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      expect(detectCareManagerChange(before, after)).to.be.false;
    });

    it('両方ともcareManagerNameがない場合falseを返す', () => {
      const before = { name: '田村 勝義' };
      const after = { name: '田村 勝義' };
      expect(detectCareManagerChange(before, after)).to.be.false;
    });

    it('新規作成（beforeがnull）でcareManagerNameありはtrueを返す', () => {
      const after = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      expect(detectCareManagerChange(null, after)).to.be.true;
    });

    it('新規作成（beforeがnull）でcareManagerNameなしはfalseを返す', () => {
      const after = { name: '田村 勝義' };
      expect(detectCareManagerChange(null, after)).to.be.false;
    });

    it('削除（afterがnull）はfalseを返す（ドキュメント更新不要）', () => {
      const before = { name: '田村 勝義', careManagerName: '長谷川 由紀' };
      expect(detectCareManagerChange(before, null)).to.be.false;
    });
  });

  describe('buildCareManagerUpdate - 更新データ構築', () => {
    it('careManagerとcareManagerKeyを正しく構築する', () => {
      const update = buildCareManagerUpdate('長谷川 由紀');
      expect(update.careManager).to.equal('長谷川 由紀');
      expect(update.careManagerKey).to.equal('長谷川 由紀');
    });

    it('careManagerNameがundefinedの場合はnullと空文字', () => {
      const update = buildCareManagerUpdate(undefined);
      expect(update.careManager).to.be.null;
      expect(update.careManagerKey).to.equal('');
    });

    it('careManagerNameが空文字の場合はnullと空文字', () => {
      const update = buildCareManagerUpdate('');
      expect(update.careManager).to.be.null;
      expect(update.careManagerKey).to.equal('');
    });
  });
});
