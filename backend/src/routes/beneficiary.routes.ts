import { randomUUID } from 'crypto'
import { Router } from 'express'
import { pool } from '../config/database.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware.js'

const router = Router()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['FUNDING_SOURCE', 'WITHDRAWAL_DESTINATION'] as const
type BeneficiaryKind = typeof KINDS[number]

function validKind(value: unknown): value is BeneficiaryKind { return typeof value === 'string' && KINDS.includes(value as BeneficiaryKind) }
function present(row: Record<string, unknown>) { return { id: row.id, kind: row.kind, provider: row.provider, label: row.label, maskedIdentifier: row.masked_identifier, status: row.status, createdAt: row.created_at } }
function maskIdentifier(value: string) { const compact = value.replace(/\s/g, ''); return `•••• ${compact.slice(-4)}` }

router.get('/', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const kind = req.query.kind
  if (!req.userId) return res.status(401).json({ success: false, message: 'User authentication required' })
  if (!validKind(kind)) return res.status(400).json({ success: false, message: 'A valid beneficiary kind is required' })
  try {
    const result = await pool.query(`SELECT id, kind, provider, label, masked_identifier, status, created_at FROM financial_beneficiaries WHERE user_id = $1 AND kind = $2 AND status = 'ACTIVE' ORDER BY created_at DESC`, [req.userId, kind])
    return res.json({ success: true, beneficiaries: result.rows.map(present) })
  } catch (error) { console.error('Beneficiary retrieval error:', error); return res.status(500).json({ success: false, message: 'Unable to load funding sources' }) }
})

router.post('/', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { kind, label, identifier } = req.body ?? {}
  if (!req.userId) return res.status(401).json({ success: false, message: 'User authentication required' })
  if (!validKind(kind)) return res.status(400).json({ success: false, message: 'A valid beneficiary kind is required' })
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) return res.status(400).json({ success: false, message: 'A beneficiary name of up to 80 characters is required' })
  if (typeof identifier !== 'string' || !/^[A-Za-z0-9 -]{4,64}$/.test(identifier.trim())) return res.status(400).json({ success: false, message: 'Enter a valid test account identifier' })
  try {
    const result = await pool.query(`INSERT INTO financial_beneficiaries (id, user_id, kind, label, masked_identifier) VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, provider, label, masked_identifier, status, created_at`, [randomUUID(), req.userId, kind, label.trim(), maskIdentifier(identifier.trim())])
    return res.status(201).json({ success: true, beneficiary: present(result.rows[0]) })
  } catch (error) { console.error('Beneficiary creation error:', error); return res.status(500).json({ success: false, message: 'Unable to add funding source' }) }
})

router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) return res.status(401).json({ success: false, message: 'User authentication required' })
  const beneficiaryId = req.params.id
  if (typeof beneficiaryId !== 'string' || !UUID_PATTERN.test(beneficiaryId)) return res.status(400).json({ success: false, message: 'A valid beneficiary id is required' })
  try {
    const result = await pool.query(`UPDATE financial_beneficiaries SET status = 'INACTIVE', deactivated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE' RETURNING id`, [beneficiaryId, req.userId])
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Beneficiary not found' })
    return res.status(204).send()
  } catch (error) { console.error('Beneficiary deactivation error:', error); return res.status(500).json({ success: false, message: 'Unable to deactivate beneficiary' }) }
})

export default router
