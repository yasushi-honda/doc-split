/**
 * summaryFabricationScan 単体テスト (ADR-0027 PR2a)
 *
 * `shared/summaryFabricationScan.ts` はFirestore/Admin SDK非依存の純粋関数のため、
 * `functions/test/customerIdentity.test.ts` と同じ規約でユニットテストする(emulator不要)。
 * frontend/functions双方から参照される契約をここで固定する。
 */

import { expect } from 'chai';
import {
  scanSummaryForFabrication,
  normalizeForFabricationScan,
  DEFAULT_FABRICATION_SCAN_CONFIG,
  FABRICATION_SCAN_CONFIG_VERSION,
} from '../../shared/summaryFabricationScan';

describe('normalizeForFabricationScan', () => {
  it('NFKCで全角/半角の揺れを正規化する', () => {
    expect(normalizeForFabricationScan('ABC（１２３）')).to.equal('ABC(123)');
  });

  it('<s>/</s>/<think>/</think>を除去する', () => {
    expect(normalizeForFabricationScan('こんにちは</s>')).to.equal('こんにちは');
    expect(normalizeForFabricationScan('<think>考え中</think>本文')).to.equal('考え中本文');
  });

  it('前後の空白・タブを除去する', () => {
    expect(normalizeForFabricationScan('  こんにちは\t\t')).to.equal('こんにちは');
  });

  it('改行(\\n・\\r\\n)を除去する(codex review指摘の回帰テスト)', () => {
    // PaddleOCRのレイアウト都合でページ・行境界に実在の組織名が分断されるケース
    // (「青葉\nクリニック」等)で、正規化後も改行が残っているとverbatim判定・再結合判定の
    // 文字列比較が一致せず、実在する組織名を誤ってfabricatedと判定する偽陽性を招いていた。
    expect(normalizeForFabricationScan('青葉\nクリニック')).to.equal('青葉クリニック');
    expect(normalizeForFabricationScan('青葉\r\nクリニック')).to.equal('青葉クリニック');
  });

  it('空文字列は空文字列のまま', () => {
    expect(normalizeForFabricationScan('')).to.equal('');
  });
});

describe('scanSummaryForFabrication: verbatim判定(③)', () => {
  it('原典にそのまま存在する組織名は検出しない', () => {
    const source = '担当はみどりヶ丘訪問看護ステーションです。';
    const summary = '訪問看護はみどりヶ丘訪問看護ステーションが担当。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.findings).to.deep.equal([]);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('助詞を挟んで原典に存在する組織名も検出しない(「向けにみどりヶ丘訪問看護ステーション」型)', () => {
    const source = '黒田様向けにみどりヶ丘訪問看護ステーションが訪問。';
    const summary = '利用者向けにみどりヶ丘訪問看護ステーションが訪問看護を実施。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「主治医は青葉クリニック」型(助詞+原典実在語)は検出しない', () => {
    const source = '主治医は青葉クリニックの桜庭医師。';
    const summary = '主治医は青葉クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('実在組織名に捏造プレフィックスを付けた場合はfabricatedとして検出する(codex review指摘の回帰テスト)', () => {
    // 当初のverbatim判定(左文脈の右詰め部分列のいずれかがsourceにverbatim一致すれば検出
    // しない、という設計)だと、実在する「青葉クリニック」の前に捏造プレフィックス「新」を
    // 付けた「新青葉クリニック」が、部分列「青葉クリニック」だけでverbatim一致してしまい
    // バイパスされていた。助詞トリムを先に行いcore全体での完全一致のみを見る設計に修正し、
    // 「新」(助詞ではない)がcoreに残ったまま一致しないことを確認する。
    const source = '主治医は青葉クリニックの桜庭医師。';
    const summary = '主治医は新青葉クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].name).to.equal('新青葉クリニック');
    expect(r.findings[0].kind).to.equal('fabricated');
  });

  it('OCR改行で分断された実在組織名でも正しくverbatim一致する(codex review指摘の回帰テスト)', () => {
    // PaddleOCRのレイアウト都合でsourceText中に「青葉\nクリニック」のような改行を挟む
    // 分断が発生しても、normalizeForFabricationScanが改行を除去するため、要約側が
    // 改行なしで「青葉クリニック」と出力した場合も正しく実在扱いされ誤検出しない。
    const source = '主治医は青葉\nクリニックの桜庭医師。';
    const summary = '主治医は青葉クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「々」(踊り字)を含む実在人名でも正しくverbatim一致する(codex review 2回目指摘の回帰テスト)', () => {
    // 「々」がNAME_CHARに含まれていないと「佐々木クリニック」のような実在名で
    // 左文脈抽出が「々」の手前で止まり誤ってfabricated扱いになっていた。
    const source = '担当医は佐々木クリニックの佐々木医師。';
    const summary = '担当医は佐々木クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「々」を含む実在人名に捏造プレフィックスを付けた場合はfabricatedとして検出する(codex review 2回目指摘の回帰テスト)', () => {
    const source = '担当医は佐々木クリニックの佐々木医師。';
    const summary = '担当医は新佐々木クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].name).to.equal('新佐々木クリニック');
  });

  it('【既知の限界】固有名詞の先頭1文字が助詞と偶然一致する場合、捏造プレフィックスの検出をすり抜けることがある(PR2a実装時の対照コーパステストで発見、decision-maker確認済み・対応不要、comment-analyzer指摘: 未テストだった限界1件を追加)', () => {
    // 「もみじ整形外科」の「も」が助詞と誤認され、trimParticlesが「みじ」までトリムして
    // しまう。「みじ整形外科」は原典中の実在名「もみじ整形外科」の部分文字列として
    // verbatim一致するため、捏造プレフィックス「新」付きの偽名「新もみじ整形外科」に
    // 対してもすり抜けが発生する(ファイル冒頭コメント既知の限界1参照)。
    const source = 'もみじ整形外科の担当医が診察。';
    const r = scanSummaryForFabrication('新もみじ整形外科の担当医が診察。', source);
    expect(r.fabricatedCount).to.equal(0); // 既知の限界: 本来はfabricatedであるべきだが検出できない
  });

  it('【既知の限界】組織名内部に助詞と同じ文字列を含む場合、捏造プレフィックスの検出をすり抜けることがある(codex review 2回目指摘、decision-maker確認済み・対応不要)', () => {
    // 「さくらの里クリニック」の「の」が助詞と誤認され、捏造プレフィックス「新」付きの
    // 偽名「新さくらの里クリニック」に対してもトリムが誤発動し、トリム後のcore「里」が
    // sourceの部分文字列に一致してすり抜ける。正規表現+文脈判定の設計限界であり、
    // PR0実データ28runでは未発生。形態素解析への置き換えなしには根本解決できないため、
    // 2026-09-22 decision-maker確認のうえ対応不要と判断した(ファイル冒頭コメント参照)。
    // 「現状こう振る舞う」ことをテストで固定し、将来の意図しない挙動変化を検知する。
    const source = 'さくらの里クリニックが担当。';
    const summary = '担当は新さくらの里クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0); // 既知の限界: 本来はfabricatedであるべきだが検出できない
  });

  it('【既知の限界】maxLeftContextを超える長い実在組織名への捏造プレフィックスは検出できないことがある(codex review 2回目指摘、decision-maker確認済み・対応不要)', () => {
    // 既定maxLeftContext=16文字を超えるsuffix直前の名前部分(他のORG_SUFFIX語彙を含まない
    // 純粋な部分)に捏造プレフィックスを付けると、抽出ウィンドウの外にプレフィックスが
    // はみ出し、ウィンドウ内のcoreがsourceの実在名の部分文字列と完全一致してしまいすり
    // 抜ける。2026-09-22 decision-maker確認のうえ対応不要と判断。
    const longName = 'アイウエオカキクケコサシスセソタチクリニック'; // suffix直前17文字+「クリニック」
    const source = `${longName}が担当。`;
    const summary = `担当は偽${longName}です。`; // 捏造プレフィックス「偽」(1文字)
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0); // 既知の限界: 本来はfabricatedであるべきだが検出できない
  });
});

describe('scanSummaryForFabrication: 助詞トリム(②)', () => {
  it('地の文を巻き込んだ「サービス内容は通所リハビリ」型は検出しない(genericCores)', () => {
    const source = '通所リハビリを週2回利用。';
    const summary = 'サービス内容は通所リハビリです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「具体的な利用者名や事業所」型(正直な回答の一部)は検出しない', () => {
    const source = 'メモ。特に変わったことはなし。';
    const summary = '具体的な利用者名や事業所名の記載はない。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('coreがそれ自体ORG_SUFFIX語彙の場合(固有名詞を伴わない一般的なサービス種別連結表現)は検出しない(codex review 3回目指摘の回帰テスト)', () => {
    // 「訪問看護ステーションが担当」(suffix=ステーション、core=訪問看護)のような、
    // 固有名詞を伴わない一般的な表現は捏造ではなく、単に事業所名が読み取れない場合の
    // 正当な要約表現。coreが別のORG_SUFFIX語彙自体と一致する場合はfabricated扱いにしない。
    const source = '利用者の状況について記載。';
    const r1 = scanSummaryForFabrication('訪問看護ステーションが担当。', source);
    expect(r1.fabricatedCount).to.equal(0);
    const r2 = scanSummaryForFabrication('居宅介護支援事業所へ相談。', source);
    expect(r2.fabricatedCount).to.equal(0);
  });

  it('suffix語彙同士が包含関係(「グループホーム」⊃「ホーム」)の外側がgenericCore判定で除外される場合、内側の誤検出も連鎖して除外する(codex review 4回目指摘の回帰テスト)', () => {
    // 「利用先はグループホームです」のように事業所名を伴わない一般的な表現では、外側の
    // 「グループホーム」はgenericCore(空文字)判定で候補から除外されるが、修正前は内側の
    // 「ホーム」だけが生き残り「グループ」を捏造coreとして誤検出していた。
    const source = '利用者の状況について記載。';
    const r = scanSummaryForFabrication('利用先はグループホームです。', source);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.findings).to.deep.equal([]);
  });

  it('プレフィックス形の法人格語彙(「株式会社」「有限会社」)による捏造企業名を検出する(codex review 4回目指摘の回帰テスト)', () => {
    // 実務でより一般的な「株式会社みずほ」のようなプレフィックス表記は、修正前は
    // 左文脈(suffixより前)が空文字列になりgenericCore判定で検出をすり抜けていた。
    const source = '利用者の状況について記載。';
    const r1 = scanSummaryForFabrication('株式会社みずほが担当。', source);
    expect(r1.fabricatedCount).to.equal(1);
    expect(r1.findings[0].name).to.equal('株式会社みずほ');
    const r2 = scanSummaryForFabrication('有限会社みずほへ相談。', source);
    expect(r2.fabricatedCount).to.equal(1);
    expect(r2.findings[0].name).to.equal('有限会社みずほ');
  });

  it('プレフィックス形でも原典に実在する法人名はverbatim一致で検出しない(codex review 4回目指摘の回帰テスト)', () => {
    const source = '株式会社みずほ訪問看護の担当者が訪問。';
    const r = scanSummaryForFabrication('株式会社みずほの担当者が来訪。', source);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.findings).to.deep.equal([]); // pr-test-analyzer指摘: fabricatedCount単体よりkind混在の見逃しがないことまで確認する
  });

  it('【既知の限界】プレフィックス形で企業名の先頭が助詞と同じ文字の場合、捏造企業名の検出をすり抜けることがある(codex review 5回目指摘、decision-maker確認済み・対応不要)', () => {
    // 「株式会社のぞみ」の「の」が助詞と誤認され、trimParticlesFromPrefixが空文字まで
    // トリムしてgenericCore判定で除外してしまう。既存の【既知の限界】(組織名内部に助詞と
    // 同じ文字列を含む場合、左方向のtrimParticlesが誤発動するケース)と構造的に同一の
    // 正規表現+文脈判定の設計限界(境界が助詞の1文字と偶然一致するケース)が、4回目修正で
    // 追加したプレフィックス方向(右方向)のtrimParticlesFromPrefixにも対称的に存在する。
    // PR0実データ28runでは未発生。形態素解析への置き換えなしには根本解決できないため、
    // 2026-09-22 decision-maker確認のうえ対応不要と判断した(ファイル冒頭コメント参照)。
    const source = '利用者の状況について記載。';
    const r = scanSummaryForFabrication('株式会社のぞみが担当。', source);
    expect(r.fabricatedCount).to.equal(0); // 既知の限界: 本来はfabricatedであるべきだが検出できない
  });

  it('通常方向(core-suffix)とプレフィックス方向(suffix-core)の候補が同一要約内に混在しても、それぞれ独立して検出される(pr-test-analyzer指摘の回帰テスト)', () => {
    // pr-test-analyzer(4回目/5回目codex reviewで発見されたバグがいずれも「左方向ロジック
    // だけを見ていたら気づけなかった」ことを踏まえ、2つの独立ループの相互作用が最も
    // リグレッションの起きやすい箇所と指摘)。
    const source = '利用者の状況について記載。';
    const r = scanSummaryForFabrication(
      '青葉クリニックの関連会社である株式会社みずほが担当。',
      source
    );
    // 「株式会社」はPREFIX_CAPABLE_SUFFIXESであると同時に通常のORG_SUFFIXESでもあるため、
    // 「である株式会社」(で→助詞トリム→core="ある")もcore-suffix方向の候補として独立に
    // 生成される。「ある」はgenericCoresに含まれない動詞語幹の残骸であり、本来の固有名詞
    // ではないが、正規表現+助詞境界という設計上、意味を持たない短い残骸まで拾ってしまう
    // ことがある。これは本PR(プレフィックス方向追加)以前から存在するcore-suffix方向の
    // 過検出(false positive、安全側)であり、混在自体が引き起こす新規のバグではないことを
    // 確認済み(株式会社をorgSuffixesから除外した場合でも「青葉クリニック」のみ検出される
    // ことをデバッグ時に別途確認した)。fabricationゲートは過検出(見逃しより多く検知)側に
    // 倒すのが安全設計のため、これも許容範囲として3件を期待値とする。
    expect(r.fabricatedCount).to.equal(3);
    const names = r.findings.map((f) => f.name).sort();
    expect(names).to.deep.equal(['ある株式会社', '株式会社みずほ', '青葉クリニック'].sort());
    // 「株式会社みずほ」(プレフィックス方向)が「ある株式会社」(core-suffix方向)の座標に
    // 誤って包含・抑制されていないことを個別に確認する(pr-test-analyzer指摘の核心)。
    expect(r.findings.some((f) => f.name === '株式会社みずほ')).to.equal(true);
    expect(r.findings.some((f) => f.name === '青葉クリニック')).to.equal(true);
  });

  it('プレフィックス方向(suffix-core)でもmaxLeftContext(既定16文字)を超える長い実在企業名は検出漏れうる(左方向と対称の境界値、回帰テスト)', () => {
    // 左方向の同種境界値テスト(「maxLeftContext(既定16文字)を超える長い施設名でも
    // verbatim判定が機能する」)と対称のケースを右方向でも固定する。17文字のcoreは
    // maxLeftContext(16)以内に収まりverbatim一致で検出されない(左方向と同じ挙動)。
    const longName = 'あ'.repeat(17);
    const source = `株式会社${longName}の担当者が訪問。`;
    const r = scanSummaryForFabrication(`株式会社${longName}の担当者が来訪。`, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('プレフィックス語彙(株式会社/有限会社)が同一要約内に複数出現しても、それぞれ独立して検出される(pr-test-analyzer指摘の回帰テスト)', () => {
    const source = '利用者の状況について記載。';
    const r = scanSummaryForFabrication('株式会社Aと有限会社Bが共同で担当。', source);
    expect(r.fabricatedCount).to.equal(2);
    const names = r.findings.map((f) => f.name).sort();
    expect(names).to.deep.equal(['有限会社B', '株式会社A']);
  });

  it('プレフィックス方向で右文脈なし(suffixが文末)の場合は検出しない(左方向の「文頭で左文脈なし」と対称の境界値)', () => {
    const source = '利用者の状況について記載。';
    const r = scanSummaryForFabrication('担当は株式会社。', source);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.findings).to.deep.equal([]);
  });

  it('リスト列挙の中黒区切りを巻き込まない(「・」は区切り文字として扱う)', () => {
    const source = '訪問介護・通所介護・短期入所生活介護・訪問看護を提供。';
    const summary = '特筆事項：訪問介護・通所介護・短期入所生活介護・訪問看護の各サービス内容。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('複合語助詞(「した際」「という点」)は短い部分文字列(「した」「という」)より先にトリムされる(code-reviewer/pr-test-analyzer指摘の回帰テスト)', () => {
    // DEFAULT_PARTICLESの記述順に「した際」が「した」より後・「という点」が「という」より
    // 後にある状態でコミットされていたバグの再現テスト。trimParticlesが内部で長さ降順に
    // ソートしてから評価するため、記述順に関わらず正しくトリムされることを固定する。
    const source = '主治医は青葉クリニックの桜庭医師。';
    const r1 = scanSummaryForFabrication('診察したという点で青葉クリニックを受診。', source);
    expect(r1.fabricatedCount).to.equal(0);
    const r2 = scanSummaryForFabrication('受診した際に青葉クリニックへ。', source);
    expect(r2.fabricatedCount).to.equal(0);
  });

  it('箇条書き記号「・」で始まる文の先頭suffixを巻き込まない', () => {
    const source = '訪問看護報告書。黒田しずか様向けにみどりヶ丘訪問看護ステーションが作成。';
    const summary = '・訪問看護報告書は利用者黒田しずか様向けにみどりヶ丘訪問看護ステーションが作成。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });
});

describe('scanSummaryForFabrication: 再結合判定(④、fabricated/recombined分離)', () => {
  it('原典の括弧書き略記を反転した組織名はrecombinedとして分類する(捏造扱いにしない)', () => {
    const source = '出席者：訪問介護(若草)、通所リハビリ(日向)、訪問看護(水無月)。';
    const summary = '関係者は水無月訪問看護、若草訪問介護、日向通所リハビリ。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.recombinedCount).to.equal(3);
    expect(r.findings.map((f) => f.name).sort()).to.deep.equal(
      ['水無月訪問看護', '日向通所リハビリ', '若草訪問介護'].sort()
    );
    expect(r.findings.every((f) => f.kind === 'recombined')).to.equal(true);
  });

  it('原典が全角括弧の略記でも検出する(呼び出し前にNFKC正規化で半角化される)', () => {
    // isRecombinedFromSource自体は半角括弧パターンのみを見る(NFKC正規化後のsourceを
    // 受け取る契約のため、全角括弧が残ることはない)。この入力(全角括弧)がscanSummaryFor
    // Fabrication経由で正しく正規化されたうえでrecombined判定されることを確認する
    // (pr-test-analyzer指摘: 当初isRecombinedFromSource内に全角/半角2分岐を持っていたが、
    // 全角分岐は正規化後には到達不能なデッドコードだった。分岐を削除し正規化に一本化した)。
    const source = '訪問看護（水無月）が担当。';
    const summary = '水無月訪問看護が対応。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.recombinedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('recombined');
  });

  it('完全に実在しない組織名はfabricatedとして分類する(recombinedにしない)', () => {
    const source = '福祉用具貸与確認書。利用者：三好 陽子様。品目：歩行器。';
    const summary = '貸与事業所はみずほ訪問看護ステーションです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.be.greaterThan(0);
    const target = r.findings.find((f) => f.name.includes('みずほ訪問看護ステーション'));
    expect(target?.kind).to.equal('fabricated');
  });

  it('他文書の実在事業所名を持ち込んだ場合もfabricated(sourceに存在しないため)', () => {
    const source = '福祉用具貸与確認書。利用者：三好 陽子様。品目：歩行器。';
    const summary = '担当はさくら居宅介護支援事業所です。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('fabricated');
  });

  it('fabricatedとrecombinedが同一要約内に混在してもそれぞれ正しく数え分けられる(pr-test-analyzer指摘の回帰テスト)', () => {
    const source = '出席者：訪問看護(水無月)。福祉用具貸与確認書。利用者：三好 陽子様。';
    const summary = '担当は水無月訪問看護とみずほ訪問看護ステーションです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.recombinedCount).to.equal(1);
    expect(r.findings.length).to.equal(2);
    const recombined = r.findings.find((f) => f.name === '水無月訪問看護');
    const fabricated = r.findings.find((f) => f.name.includes('みずほ訪問看護ステーション'));
    expect(recombined?.kind).to.equal('recombined');
    expect(fabricated?.kind).to.equal('fabricated');
  });

  it('coreは実在するがsuffixだけ異なる組織名はfabricated(近接判定の悪用を防ぐ)', () => {
    // 「さくら」はD2原典に実在するが「さくらデイサービス」という組織自体は実在しない
    // (実在するのは「さくら通所介護センター」)。近接30文字判定を採用していた旧設計では
    // これをrecombinedとして見逃す恐れがあったため、限定的な括弧書き変換のみを許容する
    // 現行設計で正しくfabricatedになることを固定する(codex High指摘の回帰テスト)。
    const source = 'さくら通所介護センターを利用。';
    const summary = '請求元はさくらデイサービスです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('fabricated');
  });
});

describe('scanSummaryForFabrication: 包含関係の除去', () => {
  it('入れ子候補は最長スパンのみを残す(「みずほ訪問看護」⊂「みずほ訪問看護ステーション」)', () => {
    const source = '福祉用具貸与確認書。';
    const summary = 'みずほ訪問看護ステーションが担当。';
    const r = scanSummaryForFabrication(summary, source);
    // suffix候補として「訪問看護」「ステーション」の両方がマッチしうるが、
    // 最長スパン優先により「みずほ訪問看護ステーション」1件のみが残る。
    expect(r.findings.length).to.equal(1);
    expect(r.findings[0].name).to.equal('みずほ訪問看護ステーション');
  });

  it('suffix語彙同士が包含関係(「グループホーム」⊃「ホーム」)の場合も最長スパンのみ残す(pr-test-analyzer指摘の回帰テスト)', () => {
    const source = '福祉用具貸与確認書。';
    const summary = '担当は緑風園グループホームです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.findings.length).to.equal(1);
    expect(r.findings[0].name).to.equal('緑風園グループホーム');
  });
});

describe('scanSummaryForFabrication: 境界値', () => {
  it('空文字列summaryは検出0件', () => {
    const r = scanSummaryForFabrication('', 'ソーステキスト');
    expect(r.findings).to.deep.equal([]);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.recombinedCount).to.equal(0);
  });

  it('空文字列sourceでも例外を投げない(全候補がfabricated扱いになる)', () => {
    const r = scanSummaryForFabrication('みずほ訪問看護ステーションが担当。', '');
    expect(r.fabricatedCount).to.equal(1);
  });

  it('ORG_SUFFIXを含まないテキストは検出0件', () => {
    const r = scanSummaryForFabrication('今日は良い天気です。', 'ソーステキスト');
    expect(r.findings).to.deep.equal([]);
  });

  it('sourceTextは呼び出し側が切り詰め済みである前提(本関数は切り詰めを行わない)', () => {
    // MAX_SUMMARY_INPUT_LENGTH相当の切り詰めは呼び出し側の責務。本関数へ切り詰め後の
    // sourceTextを渡した場合、切り詰めで失われた範囲の語は「原典に存在しない」扱いになる
    // (モデルが実際には見ていない範囲を実在扱いする偽陰性を防ぐ、PR2詳細設計の契約通り)。
    const fullSource = 'X'.repeat(100) + 'みずほ訪問看護ステーション';
    const truncatedSource = fullSource.slice(0, 100); // 「みずほ訪問看護ステーション」を含まない
    const r = scanSummaryForFabrication('みずほ訪問看護ステーションが担当。', truncatedSource);
    expect(r.fabricatedCount).to.equal(1);
  });

  it('suffixが文頭(左文脈なし)の場合は検出しない(pr-test-analyzer指摘、区切り位置の境界値)', () => {
    // extractLeftContextが空文字列を返し、genericCoreSetの''にマッチするため検出されない。
    // 「判定する対象となる名前が存在しない」という意図的な挙動を固定する。
    const r = scanSummaryForFabrication('クリニックにて対応しました。', '無関係な出典テキスト。');
    expect(r.findings).to.deep.equal([]);
  });

  it('maxLeftContext(既定16文字)を超える長い施設名でもverbatim判定が機能する(pr-test-analyzer指摘、境界値)', () => {
    // 「地域包括支援センターさくらの里南出張所」は19文字(既定maxLeftContext=16を超える)。
    // 左文脈抽出は末尾16文字分しか遡らないが、verbatim判定は右詰め部分列の総当たりのため、
    // 16文字分が原典にverbatimで含まれていれば検出されない。
    const longName = '地域包括支援センターさくらの里南出張所';
    const source = `${longName}が担当。`;
    const summary = `担当は${longName}です。`;
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });
});

describe('scanSummaryForFabrication: configVersion', () => {
  it('optionsを省略した場合、既定configのFABRICATION_SCAN_CONFIG_VERSIONと一致する', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト');
    expect(r.configVersion).to.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });

  it('DEFAULT_FABRICATION_SCAN_CONFIGを明示的に渡しても同じconfigVersionになる', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト', DEFAULT_FABRICATION_SCAN_CONFIG);
    expect(r.configVersion).to.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });

  it('optionsを変更するとconfigVersionが変わる', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト', {
      ...DEFAULT_FABRICATION_SCAN_CONFIG,
      maxLeftContext: 8,
    });
    expect(r.configVersion).to.not.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });
});
