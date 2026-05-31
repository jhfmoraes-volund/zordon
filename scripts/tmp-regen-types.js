#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const output = execSync('npx supabase gen types typescript --project-id ugvqlmapqlobigkjboae', {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe']
});

const targetPath = path.join(__dirname, '..', 'src', 'lib', 'supabase', 'database.types.ts');
fs.writeFileSync(targetPath, output, 'utf-8');
console.log(`✓ Types written to ${targetPath}`);
