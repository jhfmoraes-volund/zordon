import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const output = execSync('bunx supabase gen types typescript --project-id ugvqlmapqlobigkjboae', {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe']
});

const targetPath = join(__dirname, '..', 'src', 'lib', 'supabase', 'database.types.ts');
writeFileSync(targetPath, output, 'utf-8');
console.log(`✓ Types regenerated successfully`);
