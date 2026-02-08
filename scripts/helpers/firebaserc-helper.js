#!/usr/bin/env node
/**
 * .firebaserc 操作ヘルパー（jq依存除去用）
 *
 * Usage:
 *   node firebaserc-helper.js get-project <alias>
 *   node firebaserc-helper.js add-alias <alias> <project-id>
 *   node firebaserc-helper.js list-aliases
 */

const fs = require('fs');
const path = require('path');

const FIREBASERC_PATH = path.resolve(__dirname, '../../.firebaserc');

function readFirebaserc() {
  if (!fs.existsSync(FIREBASERC_PATH)) {
    console.error('ERROR: .firebaserc not found at ' + FIREBASERC_PATH);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(FIREBASERC_PATH, 'utf8'));
}

function writeFirebaserc(data) {
  fs.writeFileSync(FIREBASERC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const command = process.argv[2];

switch (command) {
  case 'get-project': {
    const alias = process.argv[3];
    if (!alias) {
      console.error('Usage: firebaserc-helper.js get-project <alias>');
      process.exit(1);
    }
    const rc = readFirebaserc();
    const projectId = rc.projects && rc.projects[alias];
    if (!projectId) {
      console.error('ERROR: Alias not found: ' + alias);
      process.exit(1);
    }
    console.log(projectId);
    break;
  }

  case 'add-alias': {
    const alias = process.argv[3];
    const projectId = process.argv[4];
    if (!alias || !projectId) {
      console.error('Usage: firebaserc-helper.js add-alias <alias> <project-id>');
      process.exit(1);
    }
    const rc = readFirebaserc();
    if (!rc.projects) {
      rc.projects = {};
    }
    rc.projects[alias] = projectId;
    writeFirebaserc(rc);
    break;
  }

  case 'list-aliases': {
    const rc = readFirebaserc();
    const projects = rc.projects || {};
    Object.keys(projects).forEach(function (alias) {
      console.log(alias);
    });
    break;
  }

  default:
    console.error('Unknown command: ' + command);
    console.error('Available: get-project, add-alias, list-aliases');
    process.exit(1);
}
