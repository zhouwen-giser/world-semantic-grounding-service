import fs from 'node:fs';
import path from 'node:path';

// Inventory literal env reads, configuration helper arguments and dynamically named budgets.
const template = fs.readFileSync('.env.example', 'utf8');
const documented = new Set([...template.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
const required = new Set();
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) scan(file);
    if (!entry.isFile() || !file.endsWith('.ts') || /\.(test|integration\.test)\.ts$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [,name] of source.matchAll(/(?:process\.env|environment|env)\["([A-Z][A-Z0-9_]+)"\]/g)) required.add(name);
    for (const [,args] of source.matchAll(/(?:required|requiredEither|environmentList|integerEnvironment|environmentInteger|environmentText|boundedInteger|configuredInteger)\(([^)]*)\)/g)) {
      for (const [,name] of args.matchAll(/"((?:WSGS_|GOWM_|MODEL_)[A-Z0-9_]+|DATABASE_URL|PORT)"/g)) required.add(name);
    }
  }
}
scan('services'); scan('packages');
const stages = fs.readFileSync('packages/grounding-pipeline/src/types.ts','utf8').split('] as const')[0];
for (const [,stage] of stages.matchAll(/"([A-Z_]+)"/g)) required.add(`WSGS_PIPELINE_${stage}_ATTEMPT_TIMEOUT_MS`);
const advanced = fs.readFileSync('packages/historical-trace-consumer/src/advanced-config.ts','utf8');
for (const [,suffix] of advanced.matchAll(/int\("([A-Z_]+)"/g)) required.add(`WSGS_ADVANCED_HISTORY_${suffix}`);
for (const [,name] of fs.readFileSync('compose.yaml','utf8').matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) required.add(name);
const missing = [...required].filter(k => !documented.has(k)).sort();
if (missing.length) { console.error('Missing .env.example entries:', missing.join(', ')); process.exitCode = 1; }
else console.log(`Environment coverage passed: ${required.size} runtime/Compose options documented (including dynamic budgets).`);
