import { useEffect, useRef, useState } from 'preact/hooks';
import { api, loadMe } from './api';
import { go, route, user } from './state';
import { Logo } from './brand';

type Mode = 'login' | 'signup';
type Step = 'email' | 'password' | 'confirm';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login() {
  const [mode, setMode] = useState<Mode>(location.hash === '#signup' ? 'signup' : 'login');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); setShow(false); }, [step, mode]);
  useEffect(() => { document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} · bimp`; }, [mode]);
  useEffect(() => { if (route.value === '#signup' && mode !== 'signup') restart('signup'); }, [route.value]);

  const prompt = { email: 'Your work email', password: mode === 'login' ? 'Password' : 'Choose a password', confirm: 'Repeat the password' }[step];
  const hint = mode === 'signup' && step !== 'email' ? '10 or more characters.' : '';
  const restart = (m: Mode) => { setMode(m); setStep('email'); setValue(''); setFirst(''); setErr(''); };

  async function submit(e: Event) {
    e.preventDefault();
    setErr('');
    if (step === 'email') {
      if (!EMAIL.test(value.trim())) return setErr('Enter a valid email address.');
      setEmail(value.trim()); setValue(''); return setStep('password');
    }
    if (step === 'password' && mode === 'signup') {
      if (value.length < 10) { setValue(''); return setErr(`That was ${value.length} characters. Use at least 10.`); }
      setFirst(value); setValue(''); return setStep('confirm');
    }
    if (step === 'confirm' && value !== first) { setValue(''); setFirst(''); setStep('password'); return setErr("Passwords didn't match. Choose your password again."); }
    setBusy(true);
    try {
      const d = await api(`/auth/${mode}`, { json: { email, password: step === 'confirm' ? first : value } });
      go('#/');
      user.value = d.user;
      loadMe().catch(() => {});
    } catch (e) {
      setErr((e as Error).message);
      setValue('');
      if (mode === 'signup') setStep('password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="login">
      <main class="login-left" id="main">
        <a class="home small link" href="/">← Back to the site</a>
        <div class="login-box">
          <div class="logo big"><Logo height={80} /></div>
          <h1 class="sr-only">{mode === 'login' ? 'Sign in to bimp' : 'Create your bimp account'}</h1>
          <p class="lead">{mode === 'login' ? 'Sign in to ask your drawings.' : 'Create your account. Your first project is a sample house to try.'}</p>
          <form class="bar" onSubmit={submit} autocomplete="on" noValidate>
            {step !== 'email' && (
              <>
                <button type="button" class="bar-chip" onClick={() => restart(mode)} title="Use a different email">{email} ✕</button>
                <input type="email" name="username" autocomplete="username" value={email} readOnly hidden />
              </>
            )}
            <input
              ref={input}
              type={(step === 'email' ? 'email' : show ? 'text' : 'password') as 'text'}
              name={step === 'email' ? 'username' : 'password'}
              autocomplete={step === 'email' ? 'username' : mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={prompt}
              aria-label={prompt}
              aria-invalid={!!err}
              aria-describedby={`login-err${hint ? ' login-hint' : ''}`}
              value={value}
              onInput={(e) => setValue(e.currentTarget.value)}
              disabled={busy}
            />
            {step !== 'email' && <button type="button" class="bar-show" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>}
            <button class="bar-go" disabled={busy || !value} aria-label="Continue">{busy ? '…' : '→'}</button>
          </form>
          {hint && <p class="muted small login-hint" id="login-hint">{hint}</p>}
          <p class="err" role="alert" id="login-err">{err}</p>
          <p class="muted small login-switch">
            {mode === 'login'
              ? <>New here? <button type="button" class="link" onClick={() => restart('signup')}>Create an account</button></>
              : <>Have an account? <button type="button" class="link" onClick={() => restart('login')}>Sign in</button></>}
          </p>
        </div>
        <p class="small login-foot"><span>Every answer, on the drawing.</span><a class="link" href="/method/">How answers are checked</a></p>
      </main>
      <aside class="login-right" aria-hidden="true">
        <div class="bp-grid" />
        <p class="bp-caption"><span>Sample house · isometric</span><span>Generated by bimp from the plan</span></p>
      </aside>
    </div>
  );
}
