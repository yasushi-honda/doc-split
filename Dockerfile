# syntax=docker/dockerfile:1.6

# Issue #445 PR-D4 S1-6: Cloud Run Jobs container for backfill scripts.
#
# 設計判断:
# - Node 20-slim (bullseye 系、glibc 互換 + 小サイズ)
# - ts-node --transpile-only 固定運用 (本 scripts 経路では tsc / 通常 ts-node は使わない方針)
#     型チェックは TDD で 1370 tests 経由検証済、container 内では skip して transpile のみ
#     起動高速化 + 型 drift による CI 偽陽性回避
#     Codex MCP 11th review (PR-D4 S1-5 / PR #472) で確定した方針
# - workspaces (scripts + shared) のみ install、functions/frontend は source 不要 (PR-D4 backfill から依存なし)
#     ただし root package.json の workspaces 整合性のため package.json は copy

FROM node:20-slim

WORKDIR /app

# レイヤーキャッシング: package.json + lockfile を先に copy
COPY package.json package-lock.json ./
COPY scripts/package.json ./scripts/
COPY shared/package.json ./shared/
# functions/frontend は workspace 解決のため package.json のみ copy (source 不要)
COPY functions/package.json ./functions/
COPY frontend/package.json ./frontend/

# scripts + shared workspace のみ install (functions/frontend は dependencies install せず stub 扱い)
RUN npm ci \
    --workspace=@docsplit/scripts \
    --workspace=@docsplit/shared \
    --include-workspace-root \
    --no-audit \
    --no-fund

# source copy (functions/frontend の source は .dockerignore で排除)
COPY scripts ./scripts
COPY shared ./shared
# PR-D4 backfill scripts は `functions/src/pdf/provenance.ts` を import するため、
# 該当 file のみ allowlist で取り込む (.dockerignore で他 file は除外済)
COPY functions/src/pdf/provenance.ts ./functions/src/pdf/provenance.ts
# .firebaserc: container 内では project_id を env 経由で受け取るため runtime では不要だが、
#   helpers/firebaserc-helper.js を将来 container 内で呼ぶ可能性に備えて copy
COPY .firebaserc ./

# 非 root user (security best practice、Cloud Run Jobs runtime SA とは別の OS-level uid)
RUN useradd --create-home --shell /bin/bash --uid 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# ENTRYPOINT: ts-node --transpile-only 固定 (上記設計判断のとおり tsc 経由しない)
# 引数 (--env / --phase / --run-id / --cloud-run-location / --bucket-location 等) は
# Cloud Run Jobs execute --args= で execution-level override される
ENTRYPOINT ["npx", "ts-node", "--transpile-only", "scripts/pr-d4-backfill/index.ts"]
CMD []
