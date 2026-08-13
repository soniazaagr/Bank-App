import type { Request, Response } from 'express'

export const REFRESH_TOKEN_COOKIE = 'bank_refresh_token'
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth'

const isProduction = process.env.NODE_ENV === 'production'

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict' as const,
  path: REFRESH_TOKEN_COOKIE_PATH,
  maxAge: 30 * 24 * 60 * 60 * 1000,
}

export function readRefreshTokenCookie(req: Request): string | undefined {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return undefined

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name === REFRESH_TOKEN_COOKIE) {
      return part.slice(separator + 1).trim()
    }
  }

  return undefined
}

export function setRefreshTokenCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions)
}

export function clearRefreshTokenCookie(res: Response) {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
  })
}
