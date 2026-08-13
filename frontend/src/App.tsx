import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import { authApi, bankingApi, SESSION_EXPIRED_EVENT } from './services/api'
import type { LoginChallenge, Transaction, User, Wallet } from './services/api'
import DashboardPage from './Dashboard'
import AuthExperience from './AuthExperience'
import './App.css'

type Screen = 'login' | 'login-otp' | 'register' | 'email-otp' | 'dashboard'
type Notice = { type: 'error' | 'success'; text: string } | null

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    chart: 'M5 19V9m7 10V5m7 14v-7',
    card: 'M3 6h18v12H3zM3 10h18',
    transfer: 'M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    lock: 'M6 10V8a6 6 0 0 1 12 0v2m-14 0h16v10H4z',
    plus: 'M12 5v14m-7-7h14',
    logout: 'M10 17l5-5-5-5m5 5H3m10-9h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.grid} /></svg>
}

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field"><span>{label}</span><input {...props} /></label>
}

function Brand() {
  return <div className="brand"><span className="brand-mark">N</span><span>NOVA<span className="brand-muted">BANK</span></span></div>
}

function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout"><section className="auth-art"><Brand /><div className="art-copy"><p className="eyebrow">BANKING, REIMAGINED</p><h1>A calmer way to manage your money.</h1><p>One secure place for everyday spending, saving, and moving money forward.</p></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /></section><section className="auth-panel">{children}</section></main>
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Create Account', 'Verify Email', 'Account Active']
  return <div className="auth-progress">{labels.map((label, index) => <div className={index + 1 <= step ? 'progress-step complete' : 'progress-step'} key={label}><span>{index + 1 < step ? '✓' : index + 1}</span><small>{label}</small></div>)}</div>
}

function Login({ onOtpRequested, onRegister }: { onOtpRequested: (challenge: LoginChallenge) => void; onRegister: () => void }) {
  const [channel, setChannel] = useState<'email' | 'phone'>('email')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [loading, setLoading] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setNotice(null); setLoading(true)
    try { const result = await authApi.login(channel, identifier, password); onOtpRequested(result) }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to sign in' }) }
    finally { setLoading(false) }
  }
  return <AuthLayout><div className="auth-form"><p className="eyebrow">WELCOME BACK</p><h2>Sign in to your account</h2><p className="muted">Choose how you would like to sign in.</p><div className="channel-toggle" role="tablist"><button className={channel === 'email' ? 'selected' : ''} type="button" onClick={() => { setChannel('email'); setIdentifier('') }}>Email</button><button className={channel === 'phone' ? 'selected' : ''} type="button" onClick={() => { setChannel('phone'); setIdentifier('') }}>Phone</button></div><form onSubmit={submit}><Field label={channel === 'email' ? 'Email address' : 'Phone number'} type={channel === 'email' ? 'email' : 'tel'} value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete={channel === 'email' ? 'email' : 'tel'} required /><Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /><div className="form-row"><span /><button className="text-button" type="button">Forgot password?</button></div>{notice && <Notice notice={notice} />}<button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} <Icon name="arrow" /></button></form><p className="switch-auth">New to NovaBank? <button className="text-button" onClick={onRegister}>Create an account</button></p></div></AuthLayout>
}

function LoginOtp({ challenge: initialChallenge, onVerified, onBack }: { challenge: LoginChallenge; onVerified: (user: User) => void; onBack: () => void }) {
  const [challenge, setChallenge] = useState(initialChallenge); const [code, setCode] = useState(''); const [notice, setNotice] = useState<Notice>(null); const [loading, setLoading] = useState(false); const [resending, setResending] = useState(false)
  async function verify(event: FormEvent) { event.preventDefault(); setLoading(true); setNotice(null); try { const result = await authApi.verifyLoginOtp(challenge.challengeId, code); onVerified(result.user) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to verify login code' }) } finally { setLoading(false) } }
  async function resend() { setResending(true); setNotice(null); try { const result = await authApi.resendLoginOtp(challenge.challengeId); setChallenge(result); setCode(''); setNotice({ type: 'success', text: result.message }) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to resend code' }) } finally { setResending(false) } }
  return <AuthLayout><div className="auth-form otp-form"><button className="back-button" type="button" onClick={onBack}>← Back to Sign In</button><p className="eyebrow">SECURE SIGN IN</p><h2>Enter your login code</h2><p className="muted">Enter the 6-digit code sent to your verified email at <strong>{challenge.destination}</strong>. The code expires in 10 minutes.</p><form onSubmit={verify}><Field label="6-digit login code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />{notice && <Notice notice={notice} />}<button className="primary-button" disabled={loading}>{loading ? 'Verifying…' : 'Verify and sign in'} <Icon name="arrow" /></button></form><button className="secondary-button" type="button" onClick={resend} disabled={resending}>{resending ? 'Sending…' : 'Resend Email OTP'}</button><div className="security-note"><Icon name="lock" /><span>Your login code can only be used once.</span></div></div></AuthLayout>
}

function Register({ onRegistered, onLogin }: { onRegistered: (user: User) => void; onLogin: () => void }) {
  const [form, setForm] = useState({ email: '', phone: '', password: '', confirm: '' })
  const [notice, setNotice] = useState<Notice>(null); const [loading, setLoading] = useState(false)
  const update = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => setForm(current => ({ ...current, [key]: event.target.value }))
  async function submit(event: FormEvent) { event.preventDefault(); setNotice(null); if (form.password !== form.confirm) { setNotice({ type: 'error', text: 'Passwords do not match.' }); return }; setLoading(true); try { const result = await authApi.register(form.email, form.phone, form.password); onRegistered(result.user) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to create account' }) } finally { setLoading(false) } }
  return <AuthLayout><div className="auth-form"><Progress step={1} /><p className="eyebrow">STEP 1 OF 3</p><h2>Create your account</h2><p className="muted">It only takes a minute to open your secure account.</p><form onSubmit={submit}><Field label="Email address" type="email" value={form.email} onChange={update('email')} autoComplete="email" required /><Field label="Phone number" type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" required /><Field label="Password" type="password" value={form.password} onChange={update('password')} autoComplete="new-password" minLength={8} required /><Field label="Confirm password" type="password" value={form.confirm} onChange={update('confirm')} autoComplete="new-password" required />{notice && <Notice notice={notice} />}<button className="primary-button" disabled={loading}>{loading ? 'Creating account…' : 'Create account'} <Icon name="arrow" /></button></form><p className="switch-auth">Already a customer? <button className="text-button" onClick={onLogin}>Back to Sign In</button></p></div></AuthLayout>
}

function Otp({ user, onVerified, onBack }: { user: User; onVerified: (user: User) => void; onBack: () => void }) {
  const [code, setCode] = useState(''); const [notice, setNotice] = useState<Notice>(null); const [loading, setLoading] = useState(false); const [resending, setResending] = useState(false)
  async function verify(event: FormEvent) { event.preventDefault(); setLoading(true); setNotice(null); try { const result = await authApi.verifyOtp(user.id, code); setNotice({ type: 'success', text: 'Email verified successfully.' }); setTimeout(() => onVerified(result.user), 700) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Invalid verification code' }) } finally { setLoading(false) } }
  async function resend() { setResending(true); setNotice(null); try { const result = await authApi.resendOtp(user.id); setNotice({ type: 'success', text: result.message }) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to resend code' }) } finally { setResending(false) } }
  return <AuthLayout><div className="auth-form otp-form"><Progress step={2} /><button className="back-button" type="button" onClick={onBack}>← Back to Sign In</button><p className="eyebrow">STEP 2 OF 3</p><h2>Verify your email</h2><p className="muted">Enter the 6-digit code sent to <strong>{user.email}</strong>.</p><form onSubmit={verify}><Field label="6-digit verification code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />{notice && <Notice notice={notice} />}<button className="primary-button" disabled={loading}>{loading ? 'Verifying…' : 'Verify Email'} <Icon name="arrow" /></button></form><button className="secondary-button" type="button" onClick={resend} disabled={resending}>{resending ? 'Sending…' : 'Resend Email OTP'}</button><div className="security-note"><Icon name="lock" /><span>Your verification is protected with bank-grade security.</span></div></div></AuthLayout>
}

function Notice({ notice }: { notice: Notice }) { return notice ? <div className={`notice ${notice.type}`}>{notice.text}</div> : null }

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [wallets, setWallets] = useState<Wallet[]>([]); const [transactions, setTransactions] = useState<Transaction[]>([]); const [active, setActive] = useState('Overview'); const [notice, setNotice] = useState<Notice>(null); const [loading, setLoading] = useState(true); const [mobileNav, setMobileNav] = useState(false)
  const [transfer, setTransfer] = useState({ receiverWalletId: '', amount: '', description: '' }); const [withdrawal, setWithdrawal] = useState({ amount: '', description: '' }); const [actionLoading, setActionLoading] = useState(false)
  const wallet = wallets[0]; const balance = Number(wallet?.balance ?? 0); const currency = wallet?.currency ?? 'PKR'
  const formattedBalance = useMemo(() => new Intl.NumberFormat('en-PK', { style: 'currency', currency, minimumFractionDigits: 2 }).format(balance), [balance, currency])
  async function loadData() { setLoading(true); try { const [walletResult, transactionResult] = await Promise.all([bankingApi.walletBalance(), bankingApi.transactions()]); setWallets(walletResult.wallets); setTransactions(transactionResult.transactions) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load your accounts' }) } finally { setLoading(false) } }
  useEffect(() => { void loadData() }, [])
  async function doTransfer(event: FormEvent) { event.preventDefault(); if (!wallet) return; setActionLoading(true); setNotice(null); try { await bankingApi.transfer(wallet.id, transfer.receiverWalletId, transfer.amount, transfer.description); setNotice({ type: 'success', text: 'Transfer completed successfully.' }); setTransfer({ receiverWalletId: '', amount: '', description: '' }); await loadData() } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Transfer could not be completed' }) } finally { setActionLoading(false) } }
  async function doWithdrawal(event: FormEvent) { event.preventDefault(); setNotice({ type: 'error', text: 'This retired dashboard cannot submit withdrawals. Please use the current dashboard.' }) }
  async function deposit() { setNotice({ type: 'error', text: 'This retired dashboard cannot submit deposits. Please use the current dashboard.' }) }
  const navItems = [['Overview', 'grid'], ['Payments', 'transfer'], ['Cards', 'card'], ['Insights', 'chart']]
  return <div className="app-shell"><aside className={mobileNav ? 'sidebar open' : 'sidebar'}><Brand /><div className="sidebar-label">Workspace</div><nav>{navItems.map(([label, icon]) => <button className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => { setActive(label); setMobileNav(false) }} key={label}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom"><div className="help-card"><span className="help-icon">?</span><strong>Need a hand?</strong><small>Our team is here 24/7</small><button>Get support <Icon name="arrow" /></button></div><button className="nav-item logout" onClick={onLogout}><Icon name="logout" />Log out</button></div></aside><main className="main-content"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(!mobileNav)}>☰</button><div><p className="eyebrow">PERSONAL BANKING</p><h1>{active === 'Overview' ? `Good morning, ${user.email.split('@')[0]}` : active}</h1></div><div className="topbar-actions"><button className="icon-button" aria-label="Notifications">♢<span /></button><div className="profile"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-name">{user.email.split('@')[0]}</span><span className="chevron">⌄</span></div></div></header><div className="content-wrap">{notice && <Notice notice={notice} />}{loading ? <div className="loading-state">Loading your secure workspace…</div> : <><section className="welcome-row"><div><p className="muted">Tuesday, March 12, 2025</p><h2>Your financial overview</h2></div><button className="outline-button" onClick={() => void loadData()}>↻ Refresh</button></section><section className="dashboard-grid"><article className="balance-card"><div className="balance-top"><span>Total balance</span><span className="status-dot">● Active</span></div><div className="balance-value">{formattedBalance}</div><div className="balance-footer"><span>{currency} account</span><span>Available now</span></div><div className="balance-shine" /></article><div className="stat-card"><span className="stat-icon green">↗</span><span className="muted">Money in</span><strong>+ {currency} 0.00</strong><small>This month</small></div><div className="stat-card"><span className="stat-icon orange">↘</span><span className="muted">Money out</span><strong>- {currency} 0.00</strong><small>This month</small></div></section><section className="quick-actions"><div className="section-heading"><div><p className="eyebrow">SHORTCUTS</p><h3>Quick actions</h3></div></div><div className="action-grid"><button onClick={() => document.getElementById('transfer')?.scrollIntoView({ behavior: 'smooth' })}><span className="action-icon purple"><Icon name="transfer" /></span><span><strong>Send money</strong><small>Transfer to a wallet</small></span><Icon name="arrow" /></button><button onClick={() => document.getElementById('withdraw')?.scrollIntoView({ behavior: 'smooth' })}><span className="action-icon blue"><Icon name="arrow" /></span><span><strong>Withdraw</strong><small>Move money out</small></span><Icon name="arrow" /></button><button onClick={() => void deposit()}><span className="action-icon green"><Icon name="plus" /></span><span><strong>Add funds</strong><small>Deposit unavailable</small></span><Icon name="arrow" /></button></div></section><div className="dashboard-columns"><section className="panel transactions-panel"><div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h3>Recent transactions</h3></div><button className="text-button">View all</button></div>{transactions.length === 0 ? <div className="empty-state">No transactions yet.</div> : <div className="transaction-list">{transactions.slice(0, 5).map(transaction => <div className="transaction-row" key={transaction.id}><span className={`transaction-icon ${transaction.type.toLowerCase()}`}>{transaction.type === 'TRANSFER' ? '↗' : '↘'}</span><span className="transaction-main"><strong>{transaction.type === 'TRANSFER' ? 'Wallet transfer' : transaction.type}</strong><small>{transaction.reference}</small></span><span className={transaction.senderWalletId === wallet?.id ? 'amount out' : 'amount in'}>{transaction.senderWalletId === wallet?.id ? '-' : '+'}{currency} {Number(transaction.amount).toFixed(2)}<small>{transaction.status}</small></span></div>)}</div>}</section><section className="panel account-panel"><div className="section-heading"><div><p className="eyebrow">ACCOUNT</p><h3>Account details</h3></div><span className="verified-pill">Verified</span></div><div className="detail-row"><span>Account holder</span><strong>{user.email}</strong></div><div className="detail-row"><span>Account status</span><strong className="active-text">{user.status ?? 'ACTIVE'}</strong></div><div className="detail-row"><span>Wallet currency</span><strong>{currency}</strong></div><div className="detail-row"><span>Wallet status</span><strong>{wallet?.status ?? '—'}</strong></div></section></div><section className="forms-grid"><section className="panel form-panel" id="transfer"><div className="section-heading"><div><p className="eyebrow">PAYMENTS</p><h3>Send money</h3></div><span className="panel-badge">Secure</span></div><form onSubmit={doTransfer}><Field label="Receiver wallet ID" value={transfer.receiverWalletId} onChange={e => setTransfer({ ...transfer, receiverWalletId: e.target.value })} placeholder="Paste wallet ID" required /><div className="inline-fields"><Field label="Amount" value={transfer.amount} onChange={e => setTransfer({ ...transfer, amount: e.target.value })} placeholder="0.00" inputMode="decimal" required /><Field label="Note (optional)" value={transfer.description} onChange={e => setTransfer({ ...transfer, description: e.target.value })} placeholder="What's it for?" /></div><button className="primary-button compact" disabled={actionLoading || !wallet}>Send transfer <Icon name="arrow" /></button></form></section><section className="panel form-panel" id="withdraw"><div className="section-heading"><div><p className="eyebrow">CASH OUT</p><h3>Withdraw funds</h3></div><span className="panel-badge neutral">Wallet</span></div><form onSubmit={doWithdrawal}><Field label="Amount" value={withdrawal.amount} onChange={e => setWithdrawal({ ...withdrawal, amount: e.target.value })} placeholder="0.00" inputMode="decimal" required /><Field label="Description (optional)" value={withdrawal.description} onChange={e => setWithdrawal({ ...withdrawal, description: e.target.value })} placeholder="Withdrawal note" /><button className="secondary-button compact" disabled={actionLoading || !wallet}>Request withdrawal <Icon name="arrow" /></button></form></section></section></>}</div></main></div>
}

// Retained temporarily to avoid changing the already-verified legacy dashboard implementation.
// New sessions render the completed dashboard above; keeping this reference lets TypeScript
// preserve the old code path without bundling it as the active UI.
void Dashboard
void Login
void LoginOtp
void Register
void Otp

function App() {
  const hasStoredSession = Boolean(authApi.getToken()); const [screen, setScreen] = useState<Screen>(hasStoredSession ? 'dashboard' : 'login'); const [user, setUser] = useState<User | null>(null); const [authMessage, setAuthMessage] = useState<{ kind: 'success' | 'error' | 'warning' | 'info' | 'loading'; message: string } | undefined>(); const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    const expireSession = () => { setUser(null); setAuthMessage({ kind: 'warning', message: 'Your session has expired. Please sign in again.' }); setScreen('login') }
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession)
  }, [])
  useEffect(() => { if (!showSplash) return; const timer = window.setTimeout(() => setShowSplash(false), 2400); return () => window.clearTimeout(timer) }, [showSplash])
  if (showSplash) return <main className="nova-splash" aria-label="Nova Bank is opening"><div className="splash-glow" /><div className="splash-brand"><span>N</span><h1>NOVA <strong>BANK</strong></h1><p>Banking, beautifully secured.</p><div className="splash-loader"><i /></div></div><small>Secure digital banking</small></main>
  if (screen !== 'dashboard' || !user) return <AuthExperience initialToast={authMessage} onAuthenticated={nextUser => { setUser(nextUser); setAuthMessage(undefined); setScreen('dashboard') }} />
  return <DashboardPage user={user} onLogout={() => { setAuthMessage({ kind: 'success', message: 'Logout successful.' }); void authApi.logout().catch(() => undefined); setUser(null); setScreen('login') }} />
}

export default App
