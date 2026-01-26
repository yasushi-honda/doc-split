/**
 * 同姓同名解決モーダル（Phase 7）
 *
 * 機能:
 * - 書類情報の表示
 * - OCR抽出テキストの表示
 * - 顧客候補リストからの選択
 * - 「該当なし」選択
 * - 確定処理
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertCircle, FileText, User, Calendar, Check, UserPlus, BookMarked } from 'lucide-react';
import { useSameNameResolution } from '@/hooks/useSameNameResolution';
import { useMasterAlias } from '@/hooks/useMasterAlias';
import { RegisterNewMasterModal, type RegisteredMasterInfo } from '@/components/RegisterNewMasterModal';
import type { Document, CustomerCandidateInfo } from '@shared/types';

// ============================================
// 型定義
// ============================================

interface SameNameResolveModalProps {
  document: Document;
  isOpen: boolean;
  onClose: () => void;
  onResolved?: () => void;
}

type SelectionType = 'candidate' | 'unknown' | null;

interface Selection {
  type: SelectionType;
  candidate?: CustomerCandidateInfo;
}

// 登録提案ダイアログの状態
type RegistrationPromptState = 'none' | 'prompt' | 'registering';

// ============================================
// マッチタイプ表示
// ============================================

const matchTypeLabels: Record<string, string> = {
  exact: '完全一致',
  partial: '部分一致',
  fuzzy: '類似度マッチ',
};

function MatchTypeBadge({ matchType }: { matchType: string }) {
  return (
    <Badge variant="secondary" className="text-xs">
      {matchTypeLabels[matchType] || matchType}
    </Badge>
  );
}

// ============================================
// 候補カード
// ============================================

interface CandidateCardProps {
  candidate: CustomerCandidateInfo;
  isSelected: boolean;
  onSelect: () => void;
}

function CandidateCard({ candidate, isSelected, onSelect }: CandidateCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <RadioGroupItem
            value={candidate.customerId}
            checked={isSelected}
            className="mt-1"
          />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{candidate.customerName}</span>
              {candidate.customerNameKana && (
                <span className="text-sm text-muted-foreground">
                  ({candidate.customerNameKana})
                </span>
              )}
              {candidate.isDuplicate && (
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                  同姓同名
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>スコア: {candidate.score}</span>
              <MatchTypeBadge matchType={candidate.matchType} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function SameNameResolveModal({
  document,
  isOpen,
  onClose,
  onResolved,
}: SameNameResolveModalProps) {
  const {
    resolveCustomer,
    resolveAsUnknown,
    isResolving,
    resolveError,
    ocrText,
    isLoadingOcr,
    ocrError,
    loadOcrText,
    resetOcrText,
    getCandidates,
  } = useSameNameResolution();

  const { addAlias, isAdding } = useMasterAlias();

  // 選択状態
  const [selection, setSelection] = useState<Selection>({ type: null });

  // 「この表記を記憶する」チェック状態
  const [rememberNotation, setRememberNotation] = useState(false);

  // 登録提案ダイアログの状態
  const [registrationPrompt, setRegistrationPrompt] = useState<RegistrationPromptState>('none');

  // 候補リスト
  const candidates = getCandidates(document);

  // OCRから抽出された顧客名（初期値として提案）
  const suggestedCustomerName = document.customerName || '';

  // モーダル開閉時にOCR取得・リセット
  useEffect(() => {
    if (isOpen) {
      loadOcrText(document);
      setSelection({ type: null });
      setRegistrationPrompt('none');
      setRememberNotation(false);
    } else {
      resetOcrText();
    }
  }, [isOpen, document, loadOcrText, resetOcrText]);

  // 候補選択
  const handleSelectCandidate = useCallback((candidate: CustomerCandidateInfo) => {
    setSelection({ type: 'candidate', candidate });
  }, []);

  // 該当なし選択
  const handleSelectUnknown = useCallback(() => {
    setSelection({ type: 'unknown' });
  }, []);

  // 確定処理
  const handleConfirm = useCallback(async () => {
    if (!selection.type) return;

    try {
      if (selection.type === 'candidate' && selection.candidate) {
        // 「この表記を記憶する」がチェックされている場合、エイリアスを追加
        if (rememberNotation && suggestedCustomerName && suggestedCustomerName !== selection.candidate.customerName) {
          await addAlias('customer', selection.candidate.customerId, suggestedCustomerName);
        }

        await resolveCustomer({
          documentId: document.id,
          selectedCustomerId: selection.candidate.customerId,
          selectedCustomerName: selection.candidate.customerName,
          selectedCustomerIsDuplicate: selection.candidate.isDuplicate,
          selectedCareManagerName: selection.candidate.careManagerName,
        });
        onResolved?.();
        onClose();
      } else if (selection.type === 'unknown') {
        // 「該当なし」選択時は登録提案ダイアログを表示
        setRegistrationPrompt('prompt');
      }
    } catch (err) {
      // エラーはresolveErrorで表示
      console.error('Resolution failed:', err);
    }
  }, [selection, document.id, resolveCustomer, onResolved, onClose, rememberNotation, suggestedCustomerName, addAlias]);

  // 登録せずに確定（不明顧客として登録）
  const handleSkipRegistration = useCallback(async () => {
    try {
      await resolveAsUnknown({ documentId: document.id });
      onResolved?.();
      onClose();
    } catch (err) {
      console.error('Resolution failed:', err);
    }
  }, [document.id, resolveAsUnknown, onResolved, onClose]);

  // 新規登録後のコールバック
  const handleMasterRegistered = useCallback(
    async (result: RegisteredMasterInfo) => {
      // 登録後、その顧客で確定する（新規顧客なのでcareManagerはなし）
      try {
        await resolveCustomer({
          documentId: document.id,
          selectedCustomerId: result.id || result.name, // IDがない場合は名前で代用
          selectedCustomerName: result.name,
          selectedCustomerIsDuplicate: false,
          selectedCareManagerName: null, // 新規登録時はケアマネ未設定
        });
        onResolved?.();
        onClose();
      } catch (err) {
        console.error('Resolution after registration failed:', err);
      }
    },
    [document.id, resolveCustomer, onResolved, onClose]
  );

  // 書類日付フォーマット
  const formattedDate = document.fileDate
    ? document.fileDate.toDate().toLocaleDateString('ja-JP')
    : document.processedAt.toDate().toLocaleDateString('ja-JP');

  // OCR抜粋表示（最大300文字）
  const ocrExcerpt = ocrText ? ocrText.slice(0, 300) : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>顧客の確定</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 書類情報 */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">書類情報</h3>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">ファイル名:</span>
                  <span className="text-sm">{document.fileName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">書類種別:</span>
                  <span className="text-sm">{document.documentType || '不明'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">書類日付:</span>
                  <span className="text-sm">{formattedDate}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* OCR抽出テキスト */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">OCR抽出テキスト（抜粋）</h3>
            <Card>
              <CardContent className="p-4">
                {isLoadingOcr ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : ocrError ? (
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">OCR取得エラー</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {ocrExcerpt || '(OCR結果なし)'}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 顧客候補選択 */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              顧客候補を選択してください
            </h3>
            <RadioGroup
              value={
                selection.type === 'candidate'
                  ? selection.candidate?.customerId
                  : selection.type === 'unknown'
                  ? 'unknown'
                  : ''
              }
            >
              <div className="space-y-3">
                {/* 候補リスト */}
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.customerId}
                    candidate={candidate}
                    isSelected={
                      selection.type === 'candidate' &&
                      selection.candidate?.customerId === candidate.customerId
                    }
                    onSelect={() => handleSelectCandidate(candidate)}
                  />
                ))}

                {/* 該当なし選択 */}
                <Card
                  className={`cursor-pointer transition-colors ${
                    selection.type === 'unknown'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={handleSelectUnknown}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem
                        value="unknown"
                        checked={selection.type === 'unknown'}
                      />
                      <div className="flex-1">
                        <span className="font-medium text-muted-foreground">
                          該当なし（顧客として登録しない）
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </RadioGroup>
          </div>

          {/* 表記記憶オプション */}
          {selection.type === 'candidate' && suggestedCustomerName && selection.candidate &&
           suggestedCustomerName !== selection.candidate.customerName &&
           suggestedCustomerName !== '不明顧客' && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="remember-notation"
                    checked={rememberNotation}
                    onCheckedChange={(checked) => setRememberNotation(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="remember-notation"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      <BookMarked className="h-4 w-4 text-blue-600" />
                      この表記を記憶する
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      「{suggestedCustomerName}」を「{selection.candidate.customerName}」の
                      許容表記として登録します。次回から自動的にマッチします。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* エラー表示 */}
          {resolveError && (
            <Card className="border-destructive">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">
                    エラー: {(resolveError as Error).message}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isResolving}>
            キャンセル
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selection.type || isResolving || isAdding}
          >
            {isResolving || isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                確定する
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 登録提案ダイアログ */}
      {registrationPrompt === 'prompt' && (
        <Dialog open={true} onOpenChange={() => setRegistrationPrompt('none')}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>新規顧客の登録</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                該当する顧客がマスターに登録されていない可能性があります。
                新しい顧客として登録しますか？
              </p>
              {suggestedCustomerName && suggestedCustomerName !== '不明顧客' && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        OCR抽出値: <strong>{suggestedCustomerName}</strong>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={handleSkipRegistration}
                disabled={isResolving}
                className="w-full sm:w-auto"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    処理中...
                  </>
                ) : (
                  '登録せずに確定'
                )}
              </Button>
              <Button
                onClick={() => setRegistrationPrompt('registering')}
                disabled={isResolving}
                className="w-full sm:w-auto"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                新規登録する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 新規マスター登録モーダル */}
      <RegisterNewMasterModal
        type="customer"
        isOpen={registrationPrompt === 'registering'}
        onClose={() => setRegistrationPrompt('prompt')}
        suggestedName={suggestedCustomerName !== '不明顧客' ? suggestedCustomerName : ''}
        onRegistered={handleMasterRegistered}
      />
    </Dialog>
  );
}
