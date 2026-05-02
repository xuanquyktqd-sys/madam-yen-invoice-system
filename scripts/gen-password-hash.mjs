import { hash } from 'bcryptjs';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.error('Usage: node scripts/gen-password-hash.mjs "<plain_password>"');
  process.exit(1);
}

const passwordHash = await hash(input, 10);
process.stdout.write(passwordHash);

