const { execFileSync } = require('child_process');

function execCommand(cmd, args) {
  try {
    const output = execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
    return output.trim();
  } catch (err) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${err.stderr || err.message}`);
  }
}

function parseJson(output) {
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch (err) {
    console.warn(`JSON parse failed: ${err.message}\nRaw output: ${output.substring(0, 200)}`);
    return [];
  }
}

async function collectFunctions(projectId) {
  const raw = execCommand('gcloud', ['functions', 'list', `--project=${projectId}`, '--format=json']);
  const functions = parseJson(raw);

  const results = functions.map((fn) => {
    const name = fn.name ? fn.name.split('/').pop() : 'unknown';
    const state = fn.state || fn.status || 'UNKNOWN';
    return { name, state };
  });

  const total = results.length;
  const active = results.filter((f) => f.state === 'ACTIVE').length;
  const inactive = results.filter((f) => f.state !== 'ACTIVE');

  return { total, active, inactive, functions: results };
}

async function collectSchedulerJobs(projectId, location = 'asia-northeast1') {
  const raw = execCommand('gcloud', ['scheduler', 'jobs', 'list', `--project=${projectId}`, `--location=${location}`, '--format=json']);
  const jobs = parseJson(raw);

  return jobs.map((job) => {
    const name = job.name ? job.name.split('/').pop() : 'unknown';
    return {
      name,
      schedule: job.schedule || '-',
      lastAttemptTime: job.lastAttemptTime || null,
      state: job.state || 'UNKNOWN',
    };
  });
}

async function collectStorageSize(projectId) {
  try {
    const raw = execCommand('gsutil', ['du', '-s', `gs://${projectId}.appspot.com/`]);
    const match = raw.match(/^(\d+)/);
    if (match) {
      const bytes = parseInt(match[1], 10);
      return formatBytes(bytes);
    }
    return 'N/A';
  } catch {
    return 'N/A';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${value} ${units[i]}`;
}

async function collectAll(projectId) {
  const [functions, schedulerJobs, storageSize] = await Promise.all([
    collectFunctions(projectId).catch((err) => ({ error: err.message })),
    collectSchedulerJobs(projectId).catch((err) => ({ error: err.message })),
    collectStorageSize(projectId).catch(() => 'N/A'),
  ]);

  return { functions, schedulerJobs, storageSize };
}

module.exports = { collectAll, collectFunctions, collectSchedulerJobs, collectStorageSize };
