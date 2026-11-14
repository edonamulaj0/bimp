import { useEffect, useRef, useState } from 'preact/hooks';
import { api, loadMe } from './api';
import { go, route, user } from './state';
import { Logo } from './brand';

type Mode = 'login' | 'signup';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign in / create account: email and password as two separate fields (plus a confirmation when signing up). */
export function Login() {
  const [mode, setMode] = useState<Mode>(location.hash === '#signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<{ field: 'email' | 'pw' | 'pw2' | null; text: string }>({ field: null, text: '' });
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  // the site's Cloudinary image of the pilot model, when one has been generated (see apps/api/src/site-images.ts)
  const emailRef = useRef<HTMLInputElement>(null), pwRef = useRef<HTMLInputElement>(null), pw2Ref = useRef<HTMLInputElement>(null);
  useEffect(() => { emailRef.current?.focus(); }, []);
  useEffect(() => { document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} · bimp`; }, [mode]);
  useEffect(() => { if (route.value === '#signup' && mode !== 'signup') switchTo('signup'); }, [route.value]);
  const switchTo = (m: Mode) => { setMode(m); setPw(''); setPw2(''); setErr({ field: null, text: '' }); };
  const fail = (field: 'email' | 'pw' | 'pw2' | null, text: string) => {
    setErr({ field, text });
    ({ email: emailRef, pw: pwRef, pw2: pw2Ref } as const)[field ?? 'pw'].current?.focus();
  };

  async function submit(e: Event) {
    e.preventDefault();
    const em = email.trim();
    if (!EMAIL.test(em)) return fail('email', 'Enter a valid email address.');
    if (!pw) return fail('pw', 'Enter your password.');
    if (mode === 'signup' && pw.length < 10) return fail('pw', `That is ${pw.length} characters. Use at least 10.`);
    if (mode === 'signup' && pw !== pw2) return fail('pw2', "The passwords don't match.");
    setErr({ field: null, text: '' });
    setBusy(true);
    try {
      const d = await api(`/auth/${mode}`, { json: { email: em, password: pw } });
      go('#/');
      user.value = d.user;
      loadMe().catch(() => {});
    } catch (e) {
      fail(mode === 'login' ? 'pw' : null, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const desc = (f: 'email' | 'pw' | 'pw2', hint?: string) => [err.field === f && 'login-err', hint].filter(Boolean).join(' ') || undefined;

  return (
    <div class="login">
      <main class="login-left" id="main">
        <a class="home small link" href="/">← Back to the site</a>
        <div class="login-box">
          <div class="logo big"><Logo height={72} /></div>
          <h1 class="login-h">{mode === 'login' ? 'Sign in to bimp' : 'Create your bimp account'}</h1>
          <p class="lead">{mode === 'login' ? 'Ask your drawings. See the answer on the sheet.' : 'Your first project is the pilot house, ready to explore.'}</p>
          <form class="login-form" onSubmit={submit} autocomplete="on" noValidate>
            <label class="lf">
              <span>Email</span>
              <input ref={emailRef} type="email" name="username" autocomplete="username" inputMode="email" autocapitalize="none" spellcheck={false}
                placeholder="you@studio.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} disabled={busy}
                aria-invalid={err.field === 'email'} aria-describedby={desc('email')} />
            </label>
            <label class="lf">
              <span>Password{mode === 'login' ? '' : ' (10 or more characters)'}</span>
              <span class="lf-row">
                <input ref={pwRef} type={(show ? 'text' : 'password') as 'text'} name="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={pw} onInput={(e) => setPw(e.currentTarget.value)} disabled={busy}
                  aria-invalid={err.field === 'pw'} aria-describedby={desc('pw')} />
                <button type="button" class="lf-show" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {mode === 'signup' && (
              <label class="lf">
                <span>Repeat the password</span>
                <input ref={pw2Ref} type={(show ? 'text' : 'password') as 'text'} name="password-confirm" autocomplete="new-password"
                  value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} disabled={busy}
                  aria-invalid={err.field === 'pw2'} aria-describedby={desc('pw2')} />
              </label>
            )}
            <p class="err" role="alert" id="login-err">{err.text}</p>
            <button class="btn login-go" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <p class="muted small login-switch">
            {mode === 'login'
              ? <>New here? <button type="button" class="link" onClick={() => switchTo('signup')}>Create an account</button></>
              : <>Have an account? <button type="button" class="link" onClick={() => switchTo('login')}>Sign in</button></>}
          </p>
        </div>
        <p class="small login-foot"><span>Every answer, on the drawing.</span><a class="link" href="/docs/#asking">How answers are checked</a></p>
      </main>
      <aside class="login-right" aria-hidden="true">
        <p class="bp-caption"><span>Concrete house, garden side</span><span>Photograph: Declan Sun</span></p>
      </aside>
    </div>
  );
}
