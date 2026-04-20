/**
 * displayFileName 生成テスト
 *
 * #178 Stage 1: OCR完了時・PDF分割時に displayFileName を自動生成
 * #181: FE/BE 重複を shared/ に集約、本 test が共通ロジックの砦となる
 * #183: OS 禁止文字サニタイズ追加
 */

import { expect } from 'chai';
import { generateDisplayFileName } from '../../shared/generateDisplayFileName';

describe('displayFileName 自動生成 (#178 Stage 1)', () => {
  describe('generateDisplayFileName - 基本生成', () => {
    it('全メタ情報が揃っている場合、書類名_事業所_日付_顧客名.pdf を生成', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_20260315_田中太郎.pdf');
    });

    it('日付がない場合は日付部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_田中太郎.pdf');
    });

    it('事業所名がない場合は事業所部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_20260315_田中太郎.pdf');
    });

    it('顧客名が「不明顧客」の場合は顧客部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '不明顧客',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_20260315.pdf');
    });

    it('書類種別が「未判定」の場合は書類部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '未判定',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('デイサービスさくら_20260315_田中太郎.pdf');
    });
  });

  describe('generateDisplayFileName - エッジケース', () => {
    it('全てのメタ情報がデフォルト値の場合はnullを返す', () => {
      const result = generateDisplayFileName({
        documentType: '未判定',
        customerName: '不明顧客',
        officeName: '未判定',
      });
      expect(result).to.be.null;
    });

    it('全てundefinedの場合はnullを返す', () => {
      const result = generateDisplayFileName({});
      expect(result).to.be.null;
    });

    it('日付のみの場合は識別不能なためnullを返す', () => {
      const result = generateDisplayFileName({
        documentType: '未判定',
        customerName: '不明顧客',
        fileDate: '2026/03/15',
      });
      expect(result).to.be.null;
    });

    it('拡張子をカスタマイズ可能', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        extension: '.jpg',
      });
      expect(result).to.equal('介護保険証_田中太郎.jpg');
    });
  });

  describe('generateDisplayFileName - サニタイズ (#183)', () => {
    it('顧客名にスラッシュを含む場合は `_` に置換する', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中/太郎',
      });
      expect(result).to.equal('介護保険証_田中_太郎.pdf');
    });

    it('書類名にバックスラッシュ・コロン・アスタリスクを含む場合は `_` に置換する', () => {
      const result = generateDisplayFileName({
        documentType: 'A\\B:C*D',
        customerName: '田中太郎',
      });
      expect(result).to.equal('A_B_C_D_田中太郎.pdf');
    });

    it('事業所名に `? " < > |` を含む場合は `_` に置換する', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'a?b"c<d>e|f',
      });
      expect(result).to.equal('介護保険証_a_b_c_d_e_f_田中太郎.pdf');
    });

    it('制御文字 (NUL / \\x01 / \\x1f) を `_` に置換する', () => {
      const result = generateDisplayFileName({
        documentType: '介護\x00保険\x01証',
        customerName: '田中\x1f太郎',
      });
      expect(result).to.equal('介護_保険_証_田中_太郎.pdf');
    });

    it('日付文字列は入力ハイフン/スラッシュを除去し 8 桁数字のため禁止文字の混入経路なし (回帰防止)', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: '2026-03-15',
      });
      expect(result).to.equal('介護保険証_20260315_田中太郎.pdf');
    });

    it('拡張子に禁止文字を含む場合もサニタイズされる', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        extension: '.p/df',
      });
      expect(result).to.equal('介護保険証_田中太郎.p_df');
    });
  });

  describe('generateDisplayFileName - 日付 fallback 経路 (#182)', () => {
    // pdfOperations.ts L406 の `fileDateFormatted ?? timestampToDateString(fileDate)` chain を
    // 単体で lock-in。timestampToDateString 自体の単体 test は backfillDisplayFileName.test.ts
    // L15-46 で網羅済のため、本 describe は fallback 優先順位と null passthrough のみ検証する。
    it('fileDateFormatted 未設定 + Timestamp 由来文字列 (YYYY/MM/DD) 設定時、YYYYMMDD として採用', () => {
      const fileDateFormatted: string | null = null;
      const fileDateFromTimestamp = '2026/03/16';
      const fallback = fileDateFormatted ?? fileDateFromTimestamp;
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: fallback,
      });
      expect(result).to.equal('介護保険証_20260316_田中太郎.pdf');
    });

    it('fileDateFormatted が設定されていれば Timestamp 由来値より優先される', () => {
      const fileDateFormatted = '2026-03-15';
      const fileDateFromTimestamp = '2026/03/16';
      const primary = fileDateFormatted ?? fileDateFromTimestamp;
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: primary,
      });
      expect(result).to.equal('介護保険証_20260315_田中太郎.pdf');
    });

    it('fileDateFormatted と Timestamp 由来値の両方が null/undefined のとき、日付パートが省略される', () => {
      const fileDateFormatted: string | null = null;
      const fileDateFromTimestamp: string | undefined = undefined;
      const fallback = fileDateFormatted ?? fileDateFromTimestamp;
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: fallback,
      });
      expect(result).to.equal('介護保険証_田中太郎.pdf');
    });
  });
});
