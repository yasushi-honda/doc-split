/**
 * shared/officeMasterValidation.ts を CommonJS から使うための bridge (Issue #506)
 *
 * scripts/ 配下の CommonJS スクリプト (import-masters.js 等) が shared TS の
 * validateOfficeMasterImport / computeCommonShortMasters を drift なく利用するための
 * ts-node 経由 require ラッパー。
 *
 * scripts/tsconfig.json は include に ../shared/**\/*.ts を含み、scripts/package.json は
 * devDeps に ts-node を持つため、本 bridge ロード時に ts-node/register を実行することで
 * 親プロセスが node のままでも TS source を解決できる。
 */
require('ts-node/register');
module.exports = require('../../shared/officeMasterValidation');
