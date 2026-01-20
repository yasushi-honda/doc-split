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
import { Loader2, AlertCircle, FileText, User, Calendar, Check } from 'lucide-react';
import { useSameNameResolution } from '@/hooks/useSameNameResolution';
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

  // 選択状態
  const [selection, setSelection] = useState<Selection>({ type: null });

  // 候補リスト
  const candidates = getCandidates(document);

  // モーダル開閉時にOCR取得・リセット
  useEffect(() => {
    if (isOpen) {
      loadOcrText(document);
      setSelection({ type: null });
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
        await resolveCustomer({
          documentId: document.id,
          selectedCustomerId: selection.candidate.customerId,
          selectedCustomerName: selection.candidate.customerName,
          selectedCustomerIsDuplicate: selection.candidate.isDuplicate,
        });
      } else if (selection.type === 'unknown') {
        await resolveAsUnknown({ documentId: document.id });
      }

      onResolved?.();
      onClose();
    } catch (err) {
      // エラーはresolveErrorで表示
      console.error('Resolution failed:', err);
    }
  }, [selection, document.id, resolveCustomer, resolveAsUnknown, onResolved, onClose]);

  // 書類日付フォーマット
  const formattedDate = document.fileDate
    ? document.fileDate.toDate().toLocaleDateString('ja-JP')
    : document.processedAt.toDate().toLocaleDateString('ja-JP');

  // OCR抜粋表示（最大300文字）
  const ocrExcerpt = ocrText ? ocrText.slice(0, 300) : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            disabled={!selection.type || isResolving}
          >
            {isResolving ? (
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
    </Dialog>
  );
}
