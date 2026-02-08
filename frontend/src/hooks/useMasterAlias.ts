/**
 * マスターエイリアス操作フック
 *
 * - マスターに許容表記（alias）を追加
 * - OCRで検出された表記をマスターに学習させる
 */

import { useState, useCallback } from 'react';
import { callFunction } from '@/lib/callFunction';

type MasterType = 'office' | 'customer' | 'document';

interface AddAliasResult {
  success: boolean;
  aliases: string[];
  message?: string;
}

export function useMasterAlias() {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * マスターにエイリアスを追加
   *
   * @param masterType マスタータイプ
   * @param masterId マスターID
   * @param alias 追加するエイリアス
   * @returns 成功時true
   */
  const addAlias = useCallback(
    async (
      masterType: MasterType,
      masterId: string,
      alias: string
    ): Promise<boolean> => {
      setIsAdding(true);
      setError(null);

      try {
        const result = await callFunction<
          { masterType: MasterType; masterId: string; alias: string },
          AddAliasResult
        >('addMasterAlias', { masterType, masterId, alias }, { timeout: 60_000 });
        return result.success;
      } catch (err) {
        console.error('Failed to add alias:', err);
        setError(err instanceof Error ? err : new Error('Failed to add alias'));
        return false;
      } finally {
        setIsAdding(false);
      }
    },
    []
  );

  return {
    addAlias,
    isAdding,
    error,
  };
}
