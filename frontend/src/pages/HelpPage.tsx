import { useState, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Printer, BookOpen, Shield, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

// ============================================================
// ユーザーガイド
// ============================================================
function UserGuide() {
  return (
    <div className="guide-content">
      <section id="user-section-1" className="guide-section">
        <h2><span className="section-number">1</span>概要</h2>
        <p>
          DocSplitは、Gmailに届く書類（PDF）を自動的に取得し、AI OCRでメタ情報を抽出・管理するアプリケーションです。
        </p>

        <div className="info-box">
          <h4>自動処理のタイミング</h4>
          <ul>
            <li><strong>Gmail取得</strong>: 5分ごとに新着メールをチェック</li>
            <li><strong>OCR処理</strong>: 1分ごとに処理待ち書類を処理</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            書類をアップロード後、通常1〜2分以内にOCR処理が完了します。
          </p>
        </div>
      </section>

      <section id="user-section-2" className="guide-section">
        <h2><span className="section-number">2</span>ログイン</h2>
        <ol className="steps-list">
          <li>アプリにアクセス</li>
          <li>「Googleでログイン」ボタンをクリック</li>
          <li>許可されたGoogleアカウントでログイン</li>
        </ol>
        <p className="note">※ログインできるのは管理者が許可したアカウントのみです。</p>
      </section>

      <section id="user-section-2b" className="guide-section">
        <h2><span className="section-number">&#x1f4f1;</span>ホーム画面への追加</h2>
        <p>DocSplitはスマートフォンやタブレットのホーム画面に追加して、アプリのように利用できます。</p>

        <h3>iPhone / iPad（Safari）</h3>
        <ol className="steps-list">
          <li>DocSplitをSafariで開く</li>
          <li>画面下部の共有ボタン（□↑）をタップ</li>
          <li>「ホーム画面に追加」をタップ</li>
          <li>「追加」をタップ</li>
        </ol>

        <h3>Android（Chrome）</h3>
        <ol className="steps-list">
          <li>DocSplitをChromeで開く</li>
          <li>画面上部の「インストール」バナー、または右上メニュー（⋮）→「ホーム画面に追加」をタップ</li>
          <li>「インストール」をタップ</li>
        </ol>

        <h3>PC（Chrome / Edge）</h3>
        <ol className="steps-list">
          <li>DocSplitをブラウザで開く</li>
          <li>アドレスバー右側のインストールアイコン（⊕）をクリック</li>
          <li>「インストール」をクリック</li>
        </ol>

        <div className="info-box">
          <h4>スタンドアロン表示</h4>
          <p>ホーム画面から起動すると、アドレスバーなしの全画面表示になり、通常のアプリと同じ感覚で利用できます。</p>
        </div>
      </section>

      <section id="user-section-3" className="guide-section">
        <h2><span className="section-number">3</span>書類一覧画面</h2>

        <h3>3.1 統計情報</h3>
        <p>画面上部に以下の統計が表示されます：</p>
        <table className="guide-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>総書類数</td><td>登録されている書類の総数</td></tr>
            <tr><td>処理待ち</td><td>OCR処理待ちの書類数</td></tr>
            <tr><td>処理中</td><td>現在OCR処理中の書類数</td></tr>
            <tr><td>完了</td><td>処理が完了した書類数</td></tr>
            <tr><td>エラー</td><td>処理でエラーが発生した書類数</td></tr>
          </tbody>
        </table>

        <h3>3.2 タブ切替</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>タブ</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>書類一覧</td><td>全書類を一覧表示</td></tr>
            <tr><td>顧客別</td><td>顧客ごとにグループ化（あかさたなフィルター付き）</td></tr>
            <tr><td>事業所別</td><td>事業所ごとにグループ化</td></tr>
            <tr><td>書類種別</td><td>書類タイプごとにグループ化</td></tr>
            <tr><td>担当CM別</td><td>担当ケアマネごとにグループ化</td></tr>
          </tbody>
        </table>

        <h3>3.3 検索・フィルター</h3>
        <ul>
          <li><strong>検索バー</strong>: 顧客名、書類名、事業所名で全文検索</li>
          <li><strong>ステータスフィルター</strong>: 全て / 処理待ち / 処理中 / 完了 / エラー</li>
        </ul>

        <h4>期間指定フィルター</h4>
        <p>日付範囲で書類を絞り込めます。全タブ（書類一覧・顧客別・事業所別・書類種別・担当CM別）で利用可能です。</p>
        <table className="guide-table">
          <thead>
            <tr>
              <th>プリセット</th>
              <th>範囲</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>今月</td><td>当月1日〜今日</td></tr>
            <tr><td>今年</td><td>1月1日〜今日</td></tr>
            <tr><td>過去3ヶ月</td><td>3ヶ月前の1日〜今日</td></tr>
            <tr><td>カスタム</td><td>開始日・終了日を自由に指定</td></tr>
          </tbody>
        </table>
        <ul>
          <li><strong>日付種別の切替</strong>: 「書類日付」（書類に記載の日付）と「登録日」（システム登録日）を切り替えられます</li>
          <li><strong>解除</strong>: 同じプリセットをもう一度クリック、または「クリア」ボタンで解除</li>
        </ul>

        <h4>あかさたなフィルター（顧客別タブ）</h4>
        <p>顧客別タブでは、ふりがなの頭文字で絞り込めます。</p>
        <ul>
          <li>「あ」〜「わ」のボタンで五十音の行ごとに絞り込み（濁音・半濁音も含む）</li>
          <li>「全」ボタンでフィルターを解除</li>
          <li>同じボタンをもう一度押すと解除されます</li>
        </ul>
      </section>

      <section id="user-section-4" className="guide-section">
        <h2><span className="section-number">4</span>書類詳細画面</h2>

        <h3>4.1 PDFビューアー</h3>
        <ul>
          <li>左側にPDFが表示されます</li>
          <li>ページ送り: 「前へ」「次へ」ボタン</li>
          <li>拡大・縮小: ツールバーのボタン</li>
          <li>全画面表示: 拡大ボタン</li>
        </ul>

        <h3>4.2 PDF回転の永続保存</h3>
        <p>スキャン時に向きが間違っているPDFを修正できます：</p>
        <ol className="steps-list">
          <li>「回転」ボタンをクリック（90度ずつ回転）</li>
          <li>回転後、「保存」ボタンが表示される</li>
          <li>「全ページに適用して保存」または「このページのみ保存」を選択</li>
          <li>保存後、次回以降も回転が適用された状態で表示</li>
        </ol>
        <p className="note">※回転はPDFファイル自体に保存されるため、ダウンロードしても回転が維持されます。</p>

        <h3>4.3 メタ情報</h3>
        <p>右側のサイドバーに以下が表示されます：</p>
        <ul>
          <li>顧客名</li>
          <li>書類タイプ</li>
          <li>事業所</li>
          <li>書類日</li>
          <li>ステータス</li>
          <li>作成日時</li>
        </ul>
      </section>

      <section id="user-section-5" className="guide-section">
        <h2><span className="section-number">5</span>PDFアップロード</h2>

        <h3>5.1 ローカルファイルのアップロード</h3>
        <ol className="steps-list">
          <li>書類一覧画面の「アップロード」ボタンをクリック</li>
          <li>ファイルを選択（またはドラッグ＆ドロップ）</li>
          <li>アップロード後、自動的にOCR処理が開始されます</li>
        </ol>

        <h3>5.2 重複ファイルの取り扱い</h3>
        <p>同じファイル名の書類がすでに存在する場合、確認ダイアログが表示されます：</p>
        <ul>
          <li><strong>上書き</strong>: 既存の書類を置き換えてアップロード</li>
          <li><strong>別名で保存</strong>: 自動生成された別名で保存</li>
        </ul>
      </section>

      <section id="user-section-6" className="guide-section">
        <h2><span className="section-number">6</span>選択待ち対応</h2>
        <p>OCR処理で顧客名や事業所名が複数の候補に一致した場合、「選択待ち」となります。</p>

        <h3>対応手順</h3>
        <ol className="steps-list">
          <li>対象の書類をクリック</li>
          <li>候補一覧から正しい顧客/事業所を選択</li>
          <li>「この表記を記憶する」にチェックを入れると、次回から同じ表記が自動マッチ</li>
          <li>「確定」をクリック</li>
        </ol>

        <div className="info-box">
          <h4>該当なしの場合</h4>
          <p>「該当なし」を選択すると、新規マスター登録を提案されます。登録後、自動的に書類に紐付けられます。</p>
        </div>
      </section>

      <section id="user-section-7" className="guide-section">
        <h2><span className="section-number">7</span>よくある質問</h2>

        <div className="faq-item">
          <h4>Q: 書類が表示されない</h4>
          <p>A: 以下を確認してください：</p>
          <ul>
            <li>Gmail設定が正しいか（管理者に確認）</li>
            <li>対象のGmailラベルが設定されているか</li>
            <li>検索フィルターがかかっていないか</li>
          </ul>
        </div>

        <div className="faq-item">
          <h4>Q: OCRが正しく認識されない</h4>
          <p>A: 以下の場合は認識精度が低下します：</p>
          <ul>
            <li>画像が不鮮明</li>
            <li>傾きや歪みがある</li>
            <li>手書き文字</li>
          </ul>
        </div>

        <div className="faq-item">
          <h4>Q: 間違った顧客名が割り当てられた</h4>
          <p>A: 書類詳細から手動で修正できます（管理者権限が必要な場合があります）。</p>
        </div>
      </section>
    </div>
  )
}

// ============================================================
// 管理者ガイド
// ============================================================
function AdminGuide() {
  return (
    <div className="guide-content">
      <section id="admin-section-1" className="guide-section">
        <h2><span className="section-number">1</span>管理者機能</h2>
        <p>管理者は以下の追加機能にアクセスできます：</p>
        <ul>
          <li>設定画面</li>
          <li>マスターデータ管理</li>
          <li>ユーザー管理</li>
        </ul>
      </section>

      <section id="admin-section-2" className="guide-section">
        <h2><span className="section-number">2</span>設定画面</h2>

        <h3>2.1 Gmail設定</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>監視ラベル</td><td>監視対象のGmailラベル（複数指定可）</td></tr>
            <tr><td>ラベル条件</td><td>AND（全ラベル一致）/ OR（いずれかのラベル）</td></tr>
            <tr><td>監視アカウント</td><td>監視対象のGmailアドレス</td></tr>
          </tbody>
        </table>

        <h3>2.2 ユーザー管理</h3>
        <p>ログインを許可するユーザーをホワイトリストで管理します。</p>

        <h4>ユーザー追加</h4>
        <ol className="steps-list">
          <li>「ユーザー追加」をクリック</li>
          <li>Googleアカウントのメールアドレスを入力</li>
          <li>ロール（admin / user）を選択</li>
          <li>「追加」をクリック</li>
        </ol>

        <h4>ユーザー削除</h4>
        <ol className="steps-list">
          <li>一覧から対象ユーザーの「削除」をクリック</li>
          <li>確認ダイアログで「削除」をクリック</li>
        </ol>
      </section>

      <section id="admin-section-3" className="guide-section">
        <h2><span className="section-number">3</span>マスターデータ管理</h2>

        <h3>3.1 顧客マスター</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>フィールド</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>名前</td><td>顧客名</td></tr>
            <tr><td>ふりがな</td><td>検索用のふりがな</td></tr>
            <tr><td>担当ケアマネ</td><td>担当のケアマネジャー</td></tr>
            <tr><td>許容表記</td><td>OCRマッチングで認識する別表記</td></tr>
          </tbody>
        </table>

        <div className="info-box">
          <h4>許容表記（エイリアス）について</h4>
          <ul>
            <li>「山田 太郎」と「山田 太郎」（全角スペース）など、表記ゆれを登録</li>
            <li>確定時に「この表記を記憶する」にチェックすると自動追加</li>
            <li>一度登録すると、次回から同じ表記が自動マッチ</li>
          </ul>
        </div>

        <h3>3.2 書類マスター</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>フィールド</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>書類名</td><td>書類の種類名</td></tr>
            <tr><td>日付マーカー</td><td>日付を探す際の目印（例: "発行日"）</td></tr>
            <tr><td>カテゴリ</td><td>分類用のカテゴリ</td></tr>
            <tr><td>許容表記</td><td>OCRマッチングで認識する別表記</td></tr>
          </tbody>
        </table>

        <h3>3.3 事業所マスター</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>フィールド</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>名前</td><td>事業所名</td></tr>
            <tr><td>許容表記</td><td>OCRマッチングで認識する別表記</td></tr>
          </tbody>
        </table>

        <h3>3.4 ケアマネマスター</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>フィールド</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>名前</td><td>ケアマネジャー名</td></tr>
          </tbody>
        </table>
      </section>

      <section id="admin-section-4" className="guide-section">
        <h2><span className="section-number">4</span>自動処理スケジュール</h2>
        <table className="guide-table">
          <thead>
            <tr>
              <th>関数</th>
              <th>間隔</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>checkGmailAttachments</td><td>5分</td><td>Gmailから新着添付ファイルを取得</td></tr>
            <tr><td>processOCR</td><td>1分</td><td>処理待ち書類のOCR実行</td></tr>
          </tbody>
        </table>
        <p className="note">※書類アップロード後1〜2分でOCR処理が完了します。</p>
      </section>

      <section id="admin-section-5" className="guide-section">
        <h2><span className="section-number">5</span>トラブルシューティング</h2>

        <h3>5.1 Gmail API エラー</h3>
        <div className="error-box">
          <code>error_type: gmail_fetch_failed</code>
        </div>
        <p><strong>原因:</strong></p>
        <ul>
          <li>OAuth トークンの期限切れ</li>
          <li>Gmail API のクォータ超過</li>
          <li>ネットワークエラー</li>
        </ul>
        <p><strong>対処:</strong> システム管理者に連絡してください。</p>

        <h3>5.2 OCR エラー</h3>
        <div className="error-box">
          <code>error_type: ocr_failed</code>
        </div>
        <p><strong>原因:</strong></p>
        <ul>
          <li>Gemini API のレート制限</li>
          <li>画像品質の問題</li>
          <li>PDFの破損</li>
        </ul>
        <p><strong>対処:</strong> 書類一覧画面の「再処理」ボタンから一括再AI OCR処理を実行してください（下記セクション6参照）。</p>

        <h3>5.3 マッチング失敗</h3>
        <div className="error-box">
          <code>error_type: matching_failed</code>
        </div>
        <p><strong>原因:</strong></p>
        <ul>
          <li>マスターデータに該当がない</li>
          <li>OCR結果の精度が低い</li>
          <li>類似度が閾値（70%）未満</li>
        </ul>
        <p><strong>対処:</strong> マスターデータを確認・追加するか、書類詳細から手動で修正してください。</p>
      </section>

      <section id="admin-section-6" className="guide-section">
        <h2><span className="section-number">6</span>一括操作（削除・確認済み・再処理）</h2>
        <p>書類一覧画面の上部に、管理者専用の一括操作ボタンが常時表示されています。</p>

        <h3>6.1 操作手順</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>ステップ</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>実行したい操作のボタン（再処理 / 確認済み / 削除）をクリック</td></tr>
            <tr><td>2</td><td>選択モードが開始され、各書類にチェックボックスが表示される</td></tr>
            <tr><td>3</td><td>対象の書類にチェックを入れる（複数選択可）</td></tr>
            <tr><td>4</td><td>同じボタンをもう一度クリックして実行（ボタンの色が変わります）</td></tr>
          </tbody>
        </table>
        <p>選択モードを解除するには、デスクトップでは×ボタン、モバイルでは同じボタンを再度クリックします。</p>

        <h3>6.2 各操作の説明</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th>操作</th>
              <th>内容</th>
              <th>用途</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>再処理</strong></td><td>AI OCRを再実行</td><td>OCRエラーの書類、精度が低い書類の再読み取り</td></tr>
            <tr><td><strong>確認済み</strong></td><td>書類を確認済みとしてマーク</td><td>内容を目視確認した書類の記録</td></tr>
            <tr><td><strong>削除</strong></td><td>書類を完全に削除</td><td>不要な書類、重複書類の整理</td></tr>
          </tbody>
        </table>

        <h3>6.3 ボタンの状態</h3>
        <ul>
          <li><strong>枠線のみ（通常）</strong>：クリックで選択モードを開始</li>
          <li><strong>薄い背景色</strong>：選択モード中（書類を選んでください）</li>
          <li><strong>塗りつぶし</strong>：1件以上選択済み（クリックで実行）</li>
        </ul>
      </section>

      <section id="admin-section-7" className="guide-section">
        <h2><span className="section-number">7</span>定期メンテナンス</h2>
        <table className="guide-table">
          <thead>
            <tr>
              <th>頻度</th>
              <th>作業内容</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>週次</td><td>エラー履歴の確認・対応（エラー履歴画面から）</td></tr>
            <tr><td>随時</td><td>マスターデータの追加・更新</td></tr>
            <tr><td>随時</td><td>ユーザーの追加・削除</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ============================================================
// メインコンポーネント
// ============================================================
export function HelpPage() {
  const { isAdmin } = useAuthStore()
  const [activeTab, setActiveTab] = useState('user')
  const contentRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="help-page">
      {/* ヘッダー */}
      <div className="help-header">
        <div className="flex items-center gap-3">
          <div className="help-icon">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-brand-900">ヘルプ・マニュアル</h1>
            <p className="text-sm text-muted-foreground">DocSplit 操作ガイド</p>
          </div>
        </div>
        <Button variant="outline" onClick={handlePrint} className="print:hidden gap-2">
          <Printer className="h-4 w-4" />
          印刷
        </Button>
      </div>

      {/* タブ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList className="print:hidden">
          <TabsTrigger value="user" className="gap-2">
            <BookOpen className="h-4 w-4" />
            ユーザーガイド
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="gap-2">
              <Shield className="h-4 w-4" />
              管理者ガイド
            </TabsTrigger>
          )}
        </TabsList>

        <div ref={contentRef} className="guide-container">
          <TabsContent value="user" className="mt-0">
            <div className="guide-title-page print:block hidden">
              <h1>DocSplit</h1>
              <h2>ユーザーガイド</h2>
            </div>
            <UserGuide />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin" className="mt-0">
              <div className="guide-title-page print:block hidden">
                <h1>DocSplit</h1>
                <h2>管理者ガイド</h2>
              </div>
              <AdminGuide />
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* 目次（サイドバー） */}
      <TableOfContents activeTab={activeTab} />

      {/* スタイル */}
      <style>{`
        .help-page {
          position: relative;
        }

        .help-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 1rem;
          border-bottom: 2px solid #e2e8f0;
        }

        .help-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
          border-radius: 12px;
          color: white;
        }

        .guide-container {
          background: linear-gradient(to bottom, #fefcfb 0%, #fff 100%);
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 2rem;
          margin-top: 1rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .guide-content {
          max-width: 800px;
          margin: 0 auto;
          font-size: 0.95rem;
          line-height: 1.8;
          color: #334155;
        }

        .guide-section {
          margin-bottom: 2.5rem;
          padding-bottom: 2rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .guide-section:last-child {
          border-bottom: none;
        }

        .guide-section h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1a365d;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .section-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: #1a365d;
          color: white;
          border-radius: 50%;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .guide-section h3 {
          font-size: 1.125rem;
          font-weight: 600;
          color: #2d3748;
          margin: 1.5rem 0 0.75rem;
          padding-left: 0.75rem;
          border-left: 3px solid #3182ce;
        }

        .guide-section h4 {
          font-size: 1rem;
          font-weight: 600;
          color: #4a5568;
          margin: 1rem 0 0.5rem;
        }

        .guide-table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 0.875rem;
        }

        .guide-table th {
          background: #1a365d;
          color: white;
          padding: 0.75rem 1rem;
          text-align: left;
          font-weight: 600;
        }

        .guide-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .guide-table tr:nth-child(even) {
          background: #f8fafc;
        }

        .steps-list {
          counter-reset: step;
          list-style: none;
          padding: 0;
          margin: 1rem 0;
        }

        .steps-list li {
          counter-increment: step;
          position: relative;
          padding: 0.5rem 0 0.5rem 3rem;
          border-left: 2px solid #e2e8f0;
          margin-left: 1rem;
        }

        .steps-list li::before {
          content: counter(step);
          position: absolute;
          left: -1rem;
          top: 0.5rem;
          width: 24px;
          height: 24px;
          background: #3182ce;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .info-box {
          background: linear-gradient(135deg, #ebf8ff 0%, #e6fffa 100%);
          border: 1px solid #90cdf4;
          border-radius: 8px;
          padding: 1rem 1.25rem;
          margin: 1rem 0;
        }

        .info-box h4 {
          color: #2b6cb0;
          margin: 0 0 0.5rem;
        }

        .error-box {
          background: #fff5f5;
          border: 1px solid #feb2b2;
          border-radius: 4px;
          padding: 0.5rem 1rem;
          margin: 0.5rem 0;
        }

        .error-box code {
          color: #c53030;
          font-family: 'Fira Code', monospace;
          font-size: 0.875rem;
        }

        .faq-item {
          background: #f8fafc;
          border-radius: 8px;
          padding: 1rem 1.25rem;
          margin: 1rem 0;
        }

        .faq-item h4 {
          color: #2d3748;
          margin: 0 0 0.5rem;
        }

        .note {
          color: #718096;
          font-size: 0.875rem;
          font-style: italic;
        }

        /* 目次サイドバー */
        .toc-sidebar {
          position: fixed;
          right: 2rem;
          top: 120px;
          width: 200px;
          max-height: calc(100vh - 160px);
          overflow-y: auto;
          padding: 1rem;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .toc-sidebar h4 {
          font-size: 0.75rem;
          font-weight: 600;
          color: #718096;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
        }

        .toc-sidebar ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .toc-sidebar li {
          padding: 0.25rem 0;
        }

        .toc-sidebar a {
          font-size: 0.8rem;
          color: #4a5568;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .toc-sidebar a:hover {
          color: #1a365d;
        }

        @media (max-width: 1280px) {
          .toc-sidebar {
            display: none;
          }
        }

        /* 印刷スタイル */
        @media print {
          .help-page {
            background: white;
          }

          .help-header {
            border-bottom: none;
          }

          .guide-container {
            border: none;
            box-shadow: none;
            padding: 0;
          }

          .guide-title-page {
            page-break-after: always;
            text-align: center;
            padding: 40vh 0;
          }

          .guide-title-page h1 {
            font-size: 3rem;
            color: #1a365d;
            margin-bottom: 1rem;
          }

          .guide-title-page h2 {
            font-size: 1.5rem;
            color: #4a5568;
          }

          .guide-section {
            page-break-inside: avoid;
          }

          .guide-table {
            page-break-inside: avoid;
          }

          .toc-sidebar {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

// 目次コンポーネント
function TableOfContents({ activeTab }: { activeTab: string }) {
  const userToc = [
    { id: 'user-section-1', title: '概要' },
    { id: 'user-section-2', title: 'ログイン' },
    { id: 'user-section-2b', title: 'ホーム画面への追加' },
    { id: 'user-section-3', title: '書類一覧画面' },
    { id: 'user-section-4', title: '書類詳細画面' },
    { id: 'user-section-5', title: 'PDFアップロード' },
    { id: 'user-section-6', title: '選択待ち対応' },
    { id: 'user-section-7', title: 'よくある質問' },
  ]

  const adminToc = [
    { id: 'admin-section-1', title: '管理者機能' },
    { id: 'admin-section-2', title: '設定画面' },
    { id: 'admin-section-3', title: 'マスターデータ管理' },
    { id: 'admin-section-4', title: '自動処理スケジュール' },
    { id: 'admin-section-5', title: 'トラブルシューティング' },
    { id: 'admin-section-6', title: '一括操作' },
    { id: 'admin-section-7', title: '定期メンテナンス' },
  ]

  const toc = activeTab === 'user' ? userToc : adminToc

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <nav className="toc-sidebar print:hidden">
      <h4>目次</h4>
      <ul>
        {toc.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => handleClick(e, item.id)}
            >
              <ChevronRight className="h-3 w-3" />
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
