import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../config/database.js'

const accessSecret: string = process.env.JWT_ACCESS_SECRET ?? ''

if (!accessSecret) {
  throw new Error('JWT_ACCESS_SECRET is missing from .env')
}

export interface AuthenticatedRequest extends Request {
  userId?: string
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const authorization = req.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
      })
    }

    const token = authorization.slice(7)

    const decoded = jwt.verify(token, accessSecret)

    if (
      typeof decoded === 'string' ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
      })
    }

    if (decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type',
      })
    }

    const userResult = await pool.query(
      `
      SELECT id
      FROM users
      WHERE id = $1 AND status = 'ACTIVE'
      LIMIT 1
      `,
      [decoded.sub],
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      })
    }

    req.userId = decoded.sub

    next()
  } catch {
    console.error('Authentication operation failed')

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired access token',
    })
  }
}
