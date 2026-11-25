import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { passwordHash } from './server.mjs';

// Generate a high-entropy password locally; never accept one in shell arguments.
process.umask(0o077);
const directory = '/var/lib/analytics';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString('base64url');
const target = join(directory, 'password.sha256');
const temporary = `${target}.new`;
writeFileSync(temporary, `${passwordHash(password)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
renameSync(temporary, target);
process.stdout.write(
  `Analytics username: admin\nAnalytics password: ${password}\nSave this password, then restart the web service. Running setup again rotates it.\n`,
);
