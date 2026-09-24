import { describe, it, expect } from 'vitest'
import { masterCandidateFilter } from '../masterCandidateFilter'

describe('masterCandidateFilter (Issue #1030)', () => {
  it('検索文字列が空の場合は常に1を返す(全件表示・並び順維持)', () => {
    expect(masterCandidateFilter('訪問看護報告書', '')).toBe(1)
    expect(masterCandidateFilter('', '')).toBe(1)
  })

  it('完全一致(大文字小文字問わず)は1を返す', () => {
    expect(masterCandidateFilter('報告書', '報告書')).toBe(1)
    expect(masterCandidateFilter('ABC', 'abc')).toBe(1)
  })

  it('候補文字列に検索文字列が含まれない場合は0を返す', () => {
    expect(masterCandidateFilter('居宅サービス計画書', '報告書')).toBe(0)
  })

  it('前方一致は部分一致より常に高いスコアになる(ティア分離)', () => {
    const prefixScore = masterCandidateFilter('報告書A', '報告書')
    const substringScore = masterCandidateFilter('月次報告書', '報告書')
    expect(prefixScore).toBeGreaterThan(substringScore)
  })

  it('同ティア(部分一致)内では、候補文字列が短いほど高いスコアになる(シンプルな候補を優先、本Issueの中核)', () => {
    const shortScore = masterCandidateFilter('月次報告書', '報告書')
    const longScore = masterCandidateFilter('サービス担当者会議報告書', '報告書')
    expect(shortScore).toBeGreaterThan(longScore)
  })

  it('同ティア(前方一致)内でも、候補文字列が短いほど高いスコアになる', () => {
    const shortScore = masterCandidateFilter('報告書A', '報告書')
    const longScore = masterCandidateFilter('報告書(サービス提供・月次)', '報告書')
    expect(shortScore).toBeGreaterThan(longScore)
  })

  it('極端に長い候補(60文字超)でも前方一致ティアは部分一致ティアを常に上回る(ティア境界の回帰防止)', () => {
    const longPrefixName = '報告書' + 'あ'.repeat(80)
    const shortSubstringName = 'あ報告書'
    const prefixScore = masterCandidateFilter(longPrefixName, '報告書')
    const substringScore = masterCandidateFilter(shortSubstringName, '報告書')
    expect(prefixScore).toBeGreaterThan(substringScore)
  })
})
