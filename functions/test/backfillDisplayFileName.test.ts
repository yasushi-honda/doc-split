/**
 * displayFileName バックフィル テスト
 *
 * buildDisplayFileNameFromDoc (backfill 固有のドキュメントデータ組立) をテスト。
 * timestampToDateString の単体 test は timestampHelpers.test.ts に移動済み。
 * detectDisplayFileNameChange の差分判定と OS 禁止文字 backfill 経路は #358 で追加。
 */

import { expect } from 'chai';
import {
  buildDisplayFileNameFromDoc,
  detectDisplayFileNameChange,
} from '../src/utils/backfillDisplayFileName';

describe('displayFileName バックフィル', () => {
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

    // #358 I2 (rating 6): shared 版サニタイズが backfill 経路でも適用されることを lock-in。
    // backfill で OS 禁止文字を含む customerName/officeName を生成した時、shared 側の
    // `_` 置換が効くことを確認 (#183 半角 + #335 全角 + #334 shared 統合の回帰防止)。
    it('OS禁止文字を含む customerName がサニタイズされる (#358)', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '山田/太郎', // 半角スラッシュ
        officeName: '',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal('介護保険証_山田_太郎.pdf');
    });

    it('OS禁止文字を含む officeName がサニタイズされる (#358)', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'A事業所\\B支店', // 半角バックスラッシュ
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal(
        '介護保険証_A事業所_B支店_田中太郎.pdf'
      );
    });

    it('全角コロンを含む officeName もサニタイズされる (#335 regression)', () => {
      const doc = {
        documentType: '診断書',
        customerName: '鈴木',
        officeName: 'テスト:事業所', // 全角コロン
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal('診断書_テスト_事業所_鈴木.pdf');
    });
  });

  // #358 I1 (rating 7): inline 判定 (Boolean(old) && old !== new) をカウンタ漏れ・
  // 状態分岐誤りから保護するための 3 状態 lock-in。scripts 側で CHANGE/SET/noop の分岐と
  // totalChanged カウンタ増分の基準として使う。
  describe('detectDisplayFileNameChange', () => {
    it('旧値が未設定 → "set" (新規 SET、--force なしでも実施)', () => {
      expect(detectDisplayFileNameChange(undefined, '介護保険証.pdf')).to.equal('set');
      expect(detectDisplayFileNameChange(null, '介護保険証.pdf')).to.equal('set');
      expect(detectDisplayFileNameChange('', '介護保険証.pdf')).to.equal('set');
    });

    it('旧値が新値と一致 → "noop" (書き込み不要)', () => {
      expect(
        detectDisplayFileNameChange('介護保険証_田中太郎.pdf', '介護保険証_田中太郎.pdf')
      ).to.equal('noop');
    });

    it('旧値が新値と不一致 → "change" (--force で書き換え、CHANGE ログ対象)', () => {
      // shared 版サニタイズで "山田/太郎" → "山田_太郎" に書き換わるケース
      expect(
        detectDisplayFileNameChange('介護保険証_山田/太郎.pdf', '介護保険証_山田_太郎.pdf')
      ).to.equal('change');
      // epoch/NaN drop で日付が消えるケース
      expect(
        detectDisplayFileNameChange('介護保険証_19700101_田中.pdf', '介護保険証_田中.pdf')
      ).to.equal('change');
    });

    it('未設定 → 空文字 new の組み合わせも "set" (backfill 上は到達不能だが防御)', () => {
      // 実際には buildDisplayFileNameFromDoc が null を返すケースは scripts 側で先に
      // スキップされるが、関数としての全域性を保証するため
      expect(detectDisplayFileNameChange(undefined, '')).to.equal('set');
    });
  });
});
