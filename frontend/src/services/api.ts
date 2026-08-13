const API_BASE_URL = 'https://bank-app-yeq4.onrender.com'
const ACCESS_TOKEN_KEY = 'bank_access_token'

type ApiError = Error & { status?: number }

export const SESSION_EXPIRED_EVENT = 'bank:session-expired'

function messageForStatus(status: number, backendMessage?: string) {
  if (status === 401) return backendMessage === 'Invalid credentials'
    ? 'Invalid email, phone number, or password.'
    : backendMessage || 'Your session has expired. Please sign in again.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return backendMessage || 'We could not complete this request. Please try again.'
  return backendMessage || ({
    400: 'Please check the information you entered.',
    403: 'You are not allowed to perform this action.',
    404: 'The requested record could not be found.',
    409: 'This request conflicts with the current account state.',
    422: 'This request could not be completed.',
  }[status] ?? 'Something went wrong. Please try again.')
}

async function refreshAccessToken() {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => ({})) as { accessToken?: string }
  if (!payload.accessToken) return null
  localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken)
  return payload.accessToken
}

async function request<T>(path: string, options: RequestInit = {}, token?: string, retry = true): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: 'include' })
  } catch {
    throw new Error('Unable to connect to the banking server. Please try again.')
  }

  if (response.status === 401 && token && retry) {
    const refreshedToken = await refreshAccessToken().catch(() => null)
    if (refreshedToken) return request<T>(path, options, refreshedToken, false)
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string
  }

  if (!response.ok) {
    const error = new Error(messageForStatus(response.status, payload.message)) as ApiError
    error.status = response.status
    throw error
  }

  return payload
}

export type User = { id: string; email: string; phone?: string; status?: string }
export type LoginChallenge = {
  challengeId: string
  destination: string
  message: string
}
export type Wallet = { id: string; currency: string; balance: string | number; status: string }
export type WalletRecipient = { walletId: string; identifier: string; currency: string; status: string }
export type FinancialBeneficiary = { id: string; kind: 'FUNDING_SOURCE' | 'WITHDRAWAL_DESTINATION'; provider: 'DEVELOPMENT_TEST'; label: string; maskedIdentifier: string; status: string; createdAt: string }
export type Transaction = {
  id: string
  reference: string
  type: string
  status: string
  amount: string | number
  currency?: string
  senderWalletId?: string
  receiverWalletId?: string
  description?: string | null
  createdAt?: string
  completedAt?: string
}

export type TransactionPage = {
  transactions: Transaction[]
  pagination: { page: number; limit: number; hasMore: boolean }
}

export type SecurityNotification = {
  id: string
  type: 'LOGIN_SUCCESS'
  title: string
  message: string
  authMethod: string
  createdAt: string
}

export const authApi = {
  async login(channel: 'email' | 'phone', identifier: string, password: string) {
    return request<LoginChallenge>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ [channel]: identifier, password }),
    })
  },
  async verifyLoginOtp(challengeId: string, code: string) {
    let result: { accessToken: string; user: User }
    try {
      result = await request<{ accessToken: string; user: User }>('/api/auth/login/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeId, code }),
      })
    } catch (error) {
      if (error instanceof Error && /invalid|expired|not found/i.test(error.message)) {
        throw new Error('Invalid or expired verification code.', { cause: error })
      }
      throw error
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken)
    return result
  },
  async resendLoginOtp(challengeId: string) {
    return request<LoginChallenge>('/api/auth/login/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ challengeId }),
    })
  },
  async register(email: string, phone: string, password: string) {
    return request<{ user: User; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, phone, password }),
    })
  },
  async verifyOtp(userId: string, code: string) {
    const result = await request<{ accessToken: string; user: User; message: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ userId, channel: 'EMAIL', code }),
    })
    localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken)
    return result
  },
  async resendOtp(userId: string) {
    return request<{ message: string }>('/api/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ userId, channel: 'EMAIL' }),
    })
  },
  async logout() {
    await request('/api/auth/logout', { method: 'POST' })
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  },
  getToken() {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  },
  clearToken() {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  },
}

export const bankingApi = {
  walletBalance() {
    return request<{ wallets: Wallet[] }>('/api/wallet/balance', {}, authApi.getToken() ?? undefined)
  },
  transactions(page = 1, limit = 100) {
    return request<TransactionPage>(`/api/transactions?page=${page}&limit=${limit}`, {}, authApi.getToken() ?? undefined)
  },
  recipient(walletId: string) {
    return request<{ recipient: WalletRecipient }>(`/api/wallet/recipient/${encodeURIComponent(walletId)}`, {}, authApi.getToken() ?? undefined)
  },
  transfer(senderWalletId: string, receiverWalletId: string, amount: string, description: string) {
    return request<{ transaction: Transaction; message: string }>('/api/transactions/transfer', {
      method: 'POST',
      body: JSON.stringify({ senderWalletId, receiverWalletId, amount, description }),
    }, authApi.getToken() ?? undefined)
  },
  transactionDetails(id: string) {
    return request<{ transaction: Transaction }>(`/api/transactions/${id}`, {}, authApi.getToken() ?? undefined)
  },
  beneficiaries(kind: FinancialBeneficiary['kind']) {
    return request<{ beneficiaries: FinancialBeneficiary[] }>(`/api/beneficiaries?kind=${encodeURIComponent(kind)}`, {}, authApi.getToken() ?? undefined)
  },
  addBeneficiary(kind: FinancialBeneficiary['kind'], label: string, identifier: string) {
    return request<{ beneficiary: FinancialBeneficiary }>('/api/beneficiaries', { method: 'POST', body: JSON.stringify({ kind, label, identifier }) }, authApi.getToken() ?? undefined)
  },
  deactivateBeneficiary(id: string) {
    return request<void>(`/api/beneficiaries/${encodeURIComponent(id)}`, { method: 'DELETE' }, authApi.getToken() ?? undefined)
  },
  withdrawal(walletId: string, beneficiaryId: string, amount: string, description: string, idempotencyKey: string) {
    return request<{ transaction: Transaction; wallet: Wallet; message: string }>('/api/withdrawals', {
      method: 'POST', body: JSON.stringify({ walletId, beneficiaryId, amount, description, idempotencyKey }),
    }, authApi.getToken() ?? undefined)
  },
  deposit(walletId: string, beneficiaryId: string, amount: string, idempotencyKey: string) {
    return request<{ transaction: Transaction; wallet: Wallet; message: string }>('/api/deposits', {
      method: 'POST', body: JSON.stringify({ walletId, beneficiaryId, amount, idempotencyKey }),
    }, authApi.getToken() ?? undefined)
  },
}

export const notificationApi = {
  security() {
    return request<{ securityNotifications: SecurityNotification[] }>('/api/notifications/security', {}, authApi.getToken() ?? undefined, false)
  },
}
