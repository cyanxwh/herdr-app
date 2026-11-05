import { exec } from 'herdr';

// Credentials live on the Mac displaying Herdr, including when the selected space is remote.
// Never copy them to a space, a task prompt, mod state, or the issue cache.
const SERVICE = 'dev.epsychic.herdr.linear';
const ACCOUNT = 'linear';
export async function readKey() {
  const result = await exec('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
  if (result.code === 44) return null;
  if (result.code !== 0) throw new Error('Could not read the macOS Keychain. Unlock it and try again.');
  return result.stdout.trim() || null;
}
export async function saveKey(key) {
  const result = await exec('/usr/bin/security', ['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-w', key]);
  if (result.code !== 0) throw new Error('Could not save the API key in macOS Keychain.');
}
export async function deleteKey() {
  const result = await exec('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]);
  if (result.code !== 0 && result.code !== 44) throw new Error('Could not disconnect Linear from macOS Keychain.');
}
