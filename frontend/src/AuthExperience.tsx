import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import { authApi } from './services/api'
import type { LoginChallenge, User } from './services/api'

type RegistrationView = 'login' | 'create' | 'email' | 'ready'
type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading'
type Toast = { kind: ToastKind; message: string } | null

const steps = ['Create Account', 'Email Verification', 'Account Verification']

function normalizePakistanMobile(value: string) {
  if (/^03\d{9}$/.test(value)) return `+92${value.slice(1)}`
  return value
}

function isValidPakistanMobile(value: string) {
  return /^\+923\d{9}$/.test(normalizePakistanMobile(value))
}

function limitPakistanMobileInput(value: string) {
  const cleaned = value.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+')) return `+${cleaned.slice(1).replace(/\D/g, '').slice(0, 12)}`
  return cleaned.replace(/\D/g, '').slice(0, 11)
}

function MiniIcon({ name }: { name: 'arrow' | 'eye' | 'eyeOff' | 'lock' | 'mail' | 'check' | 'info' }) {
  const paths = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    eyeOff: 'm3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.2A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a14 14 0 0 1-2.2 3.2M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.3 3.3-.7',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z',
    mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
    check: 'm5 12 4 4L19 6',
    info: 'M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}

function NovaBrand() {
  return <div className="auth-brand"><span>N</span><strong>NOVA <i>BANK</i></strong></div>
}

function CenterToast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  if (!toast) return null
  return <div className="auth-toast-layer" role={toast.kind === 'error' ? 'alert' : 'status'} aria-live="polite"><div className={`auth-toast ${toast.kind}`}><span className="toast-icon">{toast.kind === 'success' ? <MiniIcon name="check" /> : toast.kind === 'loading' ? <span className="spinner" /> : <MiniIcon name="info" />}</span><div><strong>{toast.kind === 'error' ? 'Something went wrong' : toast.kind === 'warning' ? 'Action required' : toast.kind === 'success' ? 'Success' : toast.kind === 'loading' ? 'Please wait' : 'Nova Bank'}</strong><p>{toast.message}</p></div>{toast.kind !== 'loading' && <button type="button" onClick={onClose} aria-label="Dismiss notification">×</button>}</div></div>
}

function StepNavigator({ view, hasRegistration, verified, onNavigate }: { view: RegistrationView; hasRegistration: boolean; verified: boolean; onNavigate: (step: number) => void }) {
  const current = view === 'create' ? 1 : view === 'email' ? 2 : view === 'ready' ? 3 : 0
  return <nav className="auth-steps" aria-label="Account setup progress">{steps.map((label, index) => { const number = index + 1; const complete = verified ? number <= 2 : hasRegistration && number === 1; const state = complete ? 'complete' : current === number ? 'current' : 'pending'; return <button type="button" className={`auth-step ${state}`} onClick={() => onNavigate(number)} aria-current={current === number ? 'step' : undefined} key={label}><span>{complete ? <MiniIcon name="check" /> : number}</span><small>Step {number}</small><strong>{label}</strong>{state === 'pending' && <i><MiniIcon name="lock" /></i>}</button> })}</nav>
}

function AuthField({ label, icon, suffix, ...props }: { label: string; icon: 'mail' | 'lock'; suffix?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="premium-field"><span>{label}</span><div><MiniIcon name={icon} /><input {...props} />{suffix}</div></label>
}

function AuthFrame({ children, view, hasRegistration, verified, onNavigate, onLogin }: { children: ReactNode; view: RegistrationView; hasRegistration: boolean; verified: boolean; onNavigate: (step: number) => void; onLogin: () => void }) {
  return <main className="premium-auth"><aside className="auth-story"><NovaBrand /><div className="story-copy"><span className="trust-pill"><MiniIcon name="lock" /> Secure digital banking</span><h1>Banking built around your life.</h1><p>Protected access, thoughtful design, and complete control over your money—all in one place.</p><div className="trust-row"><span><MiniIcon name="check" /> Encrypted access</span><span><MiniIcon name="check" /> Secure verification</span></div></div><small>© 2026 Nova Bank. Banking, made beautifully simple.</small></aside><section className="auth-workspace"><header><NovaBrand /><button type="button" className="signin-link" onClick={onLogin}>Already a customer? <strong>Sign in</strong></button></header><StepNavigator view={view} hasRegistration={hasRegistration} verified={verified} onNavigate={onNavigate} /><div className="auth-card-stage">{children}</div></section></main>
}

function SignInCard({ onCreate, onChallenge, notify }: { onCreate: () => void; onChallenge: (challenge: LoginChallenge) => void; notify: (toast: Toast) => void }) {
  const [channel, setChannel] = useState<'email' | 'phone'>('email'); const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false)
  const phoneInvalid = channel === 'phone' && identifier.length > 0 && !isValidPakistanMobile(identifier)
  async function submit(event: FormEvent) { event.preventDefault(); if (phoneInvalid) return; setLoading(true); notify({ kind: 'loading', message: 'Verifying your credentials securely…' }); try { const challenge = await authApi.login(channel, channel === 'phone' ? normalizePakistanMobile(identifier) : identifier, password); notify({ kind: 'success', message: 'Verification code sent to your verified email.' }); onChallenge(challenge) } catch (error) { notify({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to sign in.' }) } finally { setLoading(false) } }
  return <article className="premium-auth-card"><div className="card-heading"><span className="card-icon"><MiniIcon name="lock" /></span><p>WELCOME BACK</p><h2>Sign in securely</h2><span>Access your Nova Bank account with your email or phone number.</span></div><div className="identity-tabs" role="tablist"><button type="button" role="tab" aria-selected={channel === 'email'} className={channel === 'email' ? 'active' : ''} onClick={() => { setChannel('email'); setIdentifier('') }}>Email address</button><button type="button" role="tab" aria-selected={channel === 'phone'} className={channel === 'phone' ? 'active' : ''} onClick={() => { setChannel('phone'); setIdentifier('') }}>Phone number</button></div><form onSubmit={submit}><AuthField icon="mail" label={channel === 'email' ? 'Email address' : 'Phone number'} type={channel === 'email' ? 'email' : 'tel'} value={identifier} onChange={event => setIdentifier(channel === 'phone' ? limitPakistanMobileInput(event.target.value) : event.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '03001234567 or +923001234567'} autoComplete={channel === 'email' ? 'email' : 'tel'} aria-invalid={phoneInvalid} required />{phoneInvalid && <p className="inline-error">Enter 03001234567 or +923001234567.</p>}<AuthField icon="lock" label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required suffix={<button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><MiniIcon name={showPassword ? 'eyeOff' : 'eye'} /></button>} /><div className="auth-form-row"><span>Protected by secure authentication</span><button type="button" onClick={() => notify({ kind: 'info', message: 'Password recovery is not available yet. Please contact Nova Bank support.' })}>Forgot password?</button></div><button className="auth-submit" disabled={loading || phoneInvalid}>{loading ? <><span className="spinner" /> Signing in…</> : <>Sign in securely <MiniIcon name="arrow" /></>}</button></form><div className="auth-divider"><span>New to Nova Bank?</span></div><button type="button" className="auth-secondary" onClick={onCreate}>Create your Nova Bank account</button></article>
}

function CreateCard({ onRegistered, notify }: { onRegistered: (user: User) => void; notify: (toast: Toast) => void }) {
  const [form, setForm] = useState({ email: '', phone: '', password: '', confirm: '' }); const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false)
  const passwordReady = form.password.length >= 8 && form.password.length <= 64; const phoneValid = isValidPakistanMobile(form.phone); const passwordTouched = form.password.length > 0
  async function submit(event: FormEvent) { event.preventDefault(); if (!phoneValid || !passwordReady) return; if (form.password !== form.confirm) { notify({ kind: 'warning', message: 'Your passwords do not match. Please try again.' }); return } setLoading(true); notify({ kind: 'loading', message: 'Creating your secure Nova Bank profile…' }); try { const result = await authApi.register(form.email, normalizePakistanMobile(form.phone), form.password); notify({ kind: 'success', message: 'Account created successfully. Verification code sent to your email.' }); onRegistered(result.user) } catch (error) { notify({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to create your account.' }) } finally { setLoading(false) } }
  const update = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => setForm(value => ({ ...value, [key]: key === 'phone' ? limitPakistanMobileInput(event.target.value) : event.target.value }))
  return <article className="premium-auth-card create-card"><div className="card-heading"><span className="card-icon"><MiniIcon name="mail" /></span><p>OPEN YOUR ACCOUNT</p><h2>Let’s get you started</h2><span>Join Nova Bank in a few secure steps.</span></div><form onSubmit={submit}><div className="field-grid"><AuthField icon="mail" label="Email address" type="email" value={form.email} onChange={update('email')} placeholder="name@example.com" autoComplete="email" required /><div><AuthField icon="mail" label="Phone number" type="tel" value={form.phone} onChange={update('phone')} placeholder="03001234567 or +923001234567" autoComplete="tel" aria-invalid={form.phone.length > 0 && !phoneValid} required />{form.phone.length > 0 && !phoneValid && <p className="inline-error">Use 03001234567 or +923001234567. Pakistani mobile numbers must start with 3.</p>}</div></div><AuthField icon="lock" label="Create password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={update('password')} placeholder="8–64 characters" autoComplete="new-password" minLength={8} maxLength={64} aria-invalid={passwordTouched && !passwordReady} required suffix={<button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><MiniIcon name={showPassword ? 'eyeOff' : 'eye'} /></button>} />{passwordTouched && !passwordReady && <p className="inline-error">Password must contain between 8 and 64 characters.</p>}<div className={`password-guide ${passwordReady ? 'valid' : ''}`}><span><MiniIcon name={passwordReady ? 'check' : 'info'} /> 8–64 characters</span><span><MiniIcon name="lock" /> Use a password unique to Nova Bank</span></div><AuthField icon="lock" label="Confirm password" type={showPassword ? 'text' : 'password'} value={form.confirm} onChange={update('confirm')} placeholder="Re-enter your password" autoComplete="new-password" minLength={8} maxLength={64} required />{form.confirm.length > 0 && form.confirm !== form.password && <p className="inline-error">Passwords do not match.</p>}<p className="terms-copy">By continuing, you agree to Nova Bank’s secure banking terms and privacy policy.</p><button className="auth-submit" disabled={loading || !phoneValid || !passwordReady || form.password !== form.confirm}>{loading ? <><span className="spinner" /> Creating account…</> : <>Create secure account <MiniIcon name="arrow" /></>}</button></form></article>
}

function OtpCard({ user, challenge, onVerified, notify }: { user: User; challenge?: LoginChallenge; onVerified: (user: User) => void; notify: (toast: Toast) => void }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']); const [loading, setLoading] = useState(false); const [resending, setResending] = useState(false); const [activeChallenge, setActiveChallenge] = useState(challenge); const autoAttemptedCode = useRef(''); const requestInFlight = useRef(false)
  const maskedEmail = user.email.replace(/^(.{2}).*(@.*)$/, '$1••••$2')
  function changeDigit(index: number, value: string) { const digit = value.replace(/\D/g, '').slice(-1); setDigits(current => current.map((item, position) => position === index ? digit : item)); if (digit) document.getElementById(`otp-${index + 1}`)?.focus() }
  const verifyCode = useCallback(async (code: string, manual = false) => { if (requestInFlight.current || code.length !== 6 || (!manual && autoAttemptedCode.current === code)) return; if (!manual) autoAttemptedCode.current = code; requestInFlight.current = true; setLoading(true); notify({ kind: 'loading', message: 'Verifying your email securely…' }); try { const result = activeChallenge ? await authApi.verifyLoginOtp(activeChallenge.challengeId, code) : await authApi.verifyOtp(user.id, code); notify({ kind: 'success', message: 'Email verified successfully.' }); onVerified(result.user) } catch (error) { notify({ kind: 'error', message: error instanceof Error ? error.message : 'Invalid verification code.' }) } finally { requestInFlight.current = false; setLoading(false) } }, [activeChallenge, notify, onVerified, user.id])
  useEffect(() => { const code = digits.join(''); if (code.length === 6) void verifyCode(code) }, [digits, verifyCode])
  async function resend() { setResending(true); try { let message: string; if (activeChallenge) { const result = await authApi.resendLoginOtp(activeChallenge.challengeId); setActiveChallenge(result); message = result.message } else { const result = await authApi.resendOtp(user.id); message = result.message } setDigits(['', '', '', '', '', '']); notify({ kind: 'success', message: message || 'Verification code sent to your email.' }) } catch (error) { notify({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to resend the code.' }) } finally { setResending(false) } }
  return <article className="premium-auth-card otp-card"><div className="mail-orb"><MiniIcon name="mail" /></div><div className="card-heading"><p>EMAIL VERIFICATION</p><h2>Check your inbox</h2><span>We sent a secure six-digit code to <strong>{maskedEmail}</strong>.</span></div><div className="otp-digits" aria-label="Six-digit verification code">{digits.map((digit, index) => <input id={`otp-${index}`} key={index} aria-label={`Digit ${index + 1}`} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} value={digit} disabled={loading} onChange={event => changeDigit(index, event.target.value)} onKeyDown={event => { if (event.key === 'Backspace' && !digit) document.getElementById(`otp-${index - 1}`)?.focus() }} />)}</div><div className="otp-auto-state" role="status">{loading ? <><span className="spinner" /> Verifying your code…</> : 'Verification starts automatically after the sixth digit.'}</div><button className="auth-submit otp-verify-button" type="button" onClick={() => void verifyCode(digits.join(''), true)} disabled={loading || digits.some(digit => !digit)}>{loading ? <><span className="spinner" /> Verifying…</> : <>Verify Email <MiniIcon name="arrow" /></>}</button><button className="resend-link" type="button" onClick={resend} disabled={resending || loading}>{resending ? 'Sending a new code…' : 'Didn’t receive it? Resend code'}</button><div className="secure-note"><MiniIcon name="lock" /> This code expires shortly and can only be used once.</div></article>
}

function ReadyCard({ user, onContinue }: { user: User; onContinue: (user: User) => void }) {
  return <article className="premium-auth-card ready-card"><div className="success-orb"><MiniIcon name="check" /></div><p className="ready-kicker">ACCOUNT VERIFIED</p><h2>You’re ready to bank</h2><p>Your email has been verified and your Nova Bank account is secure and ready to use.</p><div className="verification-summary"><span><i><MiniIcon name="check" /></i><span><small>Email status</small><strong>Verified</strong></span></span><span><i><MiniIcon name="lock" /></i><span><small>Account status</small><strong>Active & secure</strong></span></span></div><button className="auth-submit" onClick={() => onContinue(user)}>Continue to Dashboard <MiniIcon name="arrow" /></button></article>
}

function GatedCard({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) {
  return <article className="premium-auth-card gated-card"><span className="gated-icon"><MiniIcon name="lock" /></span><p>ONE STEP AT A TIME</p><h2>{title}</h2><span>{message}</span><button className="auth-submit" type="button" onClick={onAction}>{action} <MiniIcon name="arrow" /></button></article>
}

export default function AuthExperience({ onAuthenticated, initialToast }: { onAuthenticated: (user: User) => void; initialToast?: Toast }) {
  const [view, setView] = useState<RegistrationView>('login'); const [pendingUser, setPendingUser] = useState<User | null>(null); const [verifiedUser, setVerifiedUser] = useState<User | null>(null); const [loginChallenge, setLoginChallenge] = useState<LoginChallenge | null>(null); const [toast, setToast] = useState<Toast>(initialToast ?? null)
  function navigateStep(step: number) { if (step === 1) { setView('create'); return } if (step === 2) { setView('email'); if (!pendingUser) setToast({ kind: 'info', message: 'Create your account first, then you can verify your email.' }); return } setView('ready'); if (!verifiedUser) setToast({ kind: 'warning', message: pendingUser ? 'Complete email verification before accessing your verified account.' : 'Create an account and verify your email first.' }) }
  let content: ReactNode
  if (view === 'login' && !loginChallenge) content = <SignInCard onCreate={() => setView('create')} notify={setToast} onChallenge={challenge => setLoginChallenge(challenge)} />
  else if (view === 'login' && loginChallenge) content = <OtpCard user={{ id: '', email: loginChallenge.destination }} challenge={loginChallenge} notify={setToast} onVerified={onAuthenticated} />
  else if (view === 'create') content = <CreateCard notify={setToast} onRegistered={user => { setPendingUser(user); setView('email') }} />
  else if (view === 'email' && pendingUser) content = <OtpCard user={pendingUser} notify={setToast} onVerified={user => { setVerifiedUser(user); setView('ready') }} />
  else if (view === 'ready' && verifiedUser) content = <ReadyCard user={verifiedUser} onContinue={onAuthenticated} />
  else if (view === 'email') content = <GatedCard title="Create your account first" message="We need your registration details before we can send and verify an email code." action="Go to Create Account" onAction={() => setView('create')} />
  else content = <GatedCard title="Verification is not complete" message="Verify your email before continuing to your secured Nova Bank account." action={pendingUser ? 'Verify Email' : 'Create Account'} onAction={() => setView(pendingUser ? 'email' : 'create')} />
  return <><AuthFrame view={view} hasRegistration={Boolean(pendingUser)} verified={Boolean(verifiedUser)} onNavigate={navigateStep} onLogin={() => { setView('login'); setLoginChallenge(null) }}>{content}</AuthFrame><CenterToast toast={toast} onClose={() => setToast(null)} /></>
}
