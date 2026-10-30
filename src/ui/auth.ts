// The sign-in / create-account window, and the account bar on the main menu.

import { account, login, logout, register, signedIn } from '../net/account';
import { PASSWORD_HINT } from '../net/protocol';

const $ = (id: string) => document.getElementById(id)!;

export class AuthScreen {
  private mode: 'login' | 'register' = 'login';
  /** What to do once signed in (e.g. go online). */
  private then: (() => void) | null = null;

  init(): void {
    $('tab-login').onclick = () => this.setMode('login');
    $('tab-register').onclick = () => this.setMode('register');
    $('btn-auth-close').onclick = () => this.hide();
    $('auth-form').addEventListener('submit', e => { e.preventDefault(); void this.submit(); });
    $('btn-account').onclick = () => {
      if (signedIn()) void logout();
      else this.show();
    };
  }

  /** Opens the window; `why` explains what needs an account, `then` runs after signing in. */
  show(why = '', then: (() => void) | null = null): void {
    this.then = then;
    $('auth-why').textContent = why;
    $('auth-error').textContent = '';
    ($('auth-pass') as HTMLInputElement).value = '';
    this.setMode(this.mode);
    $('auth').classList.remove('hidden');
    ($('auth-user') as HTMLInputElement).focus();
  }

  hide(): void { $('auth').classList.add('hidden'); }

  private setMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    $('tab-login').classList.toggle('on', mode === 'login');
    $('tab-register').classList.toggle('on', mode === 'register');
    $('auth-title').textContent = mode === 'login' ? 'Sign in' : 'Create an account';
    $('auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
    ($('auth-pass') as HTMLInputElement).autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('auth-foot').textContent = mode === 'login'
      ? 'Your account keeps your heirlooms, best runs and saved runs on this server, on any device. Online play needs one.'
      : `Usernames are 3 to 16 letters, digits, - or _. ${PASSWORD_HINT} There's no password recovery, so keep it somewhere safe.`;
  }

  private async submit(): Promise<void> {
    const user = ($('auth-user') as HTMLInputElement).value.trim(), pass = ($('auth-pass') as HTMLInputElement).value;
    const btn = $('auth-submit') as HTMLButtonElement;
    btn.disabled = true;
    $('auth-error').textContent = '';
    try {
      await (this.mode === 'login' ? login(user, pass) : register(user, pass));
      this.hide();
      const then = this.then;
      this.then = null;
      then?.();
    } catch (err) {
      $('auth-error').textContent = err instanceof Error && err.message !== 'Failed to fetch' ? err.message
        : "Couldn't reach the game server. Accounts need it running (npm run dev or npm start).";
    } finally {
      btn.disabled = false;
    }
  }

  /** The bar at the top of the main menu. */
  renderBar(): void {
    const a = account();
    $('account-who').innerHTML = a ? `Signed in as <b>${a.username.replace(/[&<>"']/g, '')}</b>` : 'Playing as a guest';
    $('btn-account').textContent = a ? 'Sign out' : 'Sign in or create an account';
  }
}
