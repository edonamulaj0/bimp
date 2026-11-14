// One-off reset: writes SQL that deletes every project and gives each user a fresh "Pilot house" (apps/shared/house-plan.ts).
// Destructive: plans, files, comments, messages, jobs and visuals go with their projects (ON DELETE CASCADE). Files
// already stored in R2 are not removed. Back the tables up first.
//
//   npx wrangler d1 execute bimp --remote --json --command "SELECT id FROM users" > users.json
//   npx esbuild scripts/reset-projects.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/bimp/reset.mjs
//   node node_modules/.cache/bimp/reset.mjs users.json reset.sql
//   npx wrangler d1 execute bimp --remote --file reset.sql
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { housePlan } from '../apps/shared/house-plan';

const [, , usersFile, outFile] = process.argv;
if (!usersFile || !outFile) throw new Error('usage: reset.mjs <users.json> <out.sql>');
const text = readFileSync(usersFile, 'utf8');
// accepts a plain array of rows, or wrangler's --json output ([{ results: [...] }]) with any banner before it
const parsed = JSON.parse(text.slice(text.search(/\[\s*\{/)));
const users: { id: string }[] = Array.isArray(parsed) && parsed[0]?.results ? parsed[0].results : parsed;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const plan = q(JSON.stringify(housePlan())), t = Date.now();
const sql = ['DELETE FROM projects;'];
for (const u of users) {
  const pid = randomUUID();
  sql.push(`INSERT INTO projects (id, user_id, name, team_id, created_at, updated_at) VALUES (${q(pid)}, ${q(u.id)}, 'Pilot house', NULL, ${t}, ${t});`);
  sql.push(`INSERT INTO plans (id, project_id, file_id, data, created_at) VALUES (${q(randomUUID())}, ${q(pid)}, NULL, ${plan}, ${t});`);
}
writeFileSync(outFile, sql.join('\n') + '\n');
console.log(`${users.length} users: ${sql.length} statements written to ${outFile}`);
