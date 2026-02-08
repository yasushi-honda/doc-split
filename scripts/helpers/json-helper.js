#!/usr/bin/env node
/**
 * JSON変換ヘルパー（jq依存除去用）
 *
 * Usage:
 *   node json-helper.js array-from-csv "a,b,c"
 *   → ["a","b","c"]
 */

const command = process.argv[2];

switch (command) {
  case 'array-from-csv': {
    const csv = process.argv[3];
    if (csv === undefined) {
      console.error('Usage: json-helper.js array-from-csv "a,b,c"');
      process.exit(1);
    }
    if (!csv) {
      console.log('[]');
      break;
    }
    const items = csv.split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    // Remove duplicates
    const unique = items.filter(function (v, i, a) { return a.indexOf(v) === i; });
    console.log(JSON.stringify(unique));
    break;
  }

  default:
    console.error('Unknown command: ' + command);
    console.error('Available: array-from-csv');
    process.exit(1);
}
