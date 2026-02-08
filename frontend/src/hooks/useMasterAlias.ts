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
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * マスターにエイリアスを追加
   */
  const addAlias = useCallback(
    async (
      masterType: MasterType,
      masterId: string,
      alias: string
    ): Promise<boolean> => {
      setIsProcessing(true);
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
        setIsProcessing(false);
      }
    },
    []
  );

  /**
   * マスターからエイリアスを削除
   */
  const removeAlias = useCallback(
    async (
      masterType: MasterType,
      masterId: string,
      alias: string
    ): Promise<boolean> => {
      setIsProcessing(true);
      setError(null);

      try {
        const result = await callFunction<
          { masterType: MasterType; masterId: string; alias: string },
          AddAliasResult
        >('removeMasterAlias', { masterType, masterId, alias }, { timeout: 60_000 });
        return result.success;
      } catch (err) {
        console.error('Failed to remove alias:', err);
        setError(err instanceof Error ? err : new Error('Failed to remove alias'));
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  /**
   * エイリアスの差分を計算してAPI経由で同期
   */
  const syncAliases = useCallback(
    async (
      masterType: MasterType,
      masterId: string,
      oldAliases: string[],
      newAliases: string[]
    ): Promise<boolean> => {
      const toAdd = newAliases.filter(a => !oldAliases.includes(a));
      const toRemove = oldAliases.filter(a => !newAliases.includes(a));

      if (toAdd.length === 0 && toRemove.length === 0) return true;

      setIsProcessing(true);
      setError(null);

      try {
        for (const alias of toAdd) {
          await addAlias(masterType, masterId, alias);
        }
        for (const alias of toRemove) {
          await removeAlias(masterType, masterId, alias);
        }
        return true;
      } catch (err) {
        console.error('Failed to sync aliases:', err);
        setError(err instanceof Error ? err : new Error('Failed to sync aliases'));
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    [addAlias, removeAlias]
  );

  return {
    addAlias,
    removeAlias,
    syncAliases,
    isAdding: isProcessing,
    isProcessing,
    error,
  };
}

export type { MasterType };
