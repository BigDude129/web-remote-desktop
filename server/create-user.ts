import { createInterface, emitKeypressEvents } from 'node:readline';
import { Store } from './store.js';
import { readConfig } from './config.js';

async function prompt(label: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((done) => rl.question(label, done));
  } finally {
    rl.close();
  }
}

async function password(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal to create an account.');
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((done, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('keypress', handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const handler = (text: string | undefined, key: { name: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Cancelled'));
      } else if (key.name === 'return') {
        cleanup();
        done(value);
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key.ctrl && value.length < 128) value += text;
    };
    process.stdin.on('keypress', handler);
  });
}

const store = new Store(readConfig().databasePath);
try {
  const username = (await prompt('Account (email or ID): ')).trim().toLowerCase();
  const name = (await prompt('Display name: ')).trim();
  if (!/^[a-z0-9@._+-]{3,120}$/.test(username) || !name || name.length > 80)
    throw new Error('Invalid account or display name.');
  const secret = await password('Password (12–128 characters, hidden): ');
  if (secret !== (await password('Repeat password: '))) throw new Error('Passwords do not match.');
  await store.createUser(username, name, secret);
  console.log('Account created. Sign in through the web or Windows agent.');
} catch (error) {
  console.error(
    error instanceof Error && error.message.includes('UNIQUE')
      ? 'Account already exists.'
      : (error as Error).message,
  );
  process.exitCode = 1;
} finally {
  store.close();
}
