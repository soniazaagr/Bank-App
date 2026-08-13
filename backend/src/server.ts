import walletRoutes from './routes/wallet.routes.js'
import loginRoutes from './routes/login.routes.js'
import transactionRoutes from './routes/transaction.routes.js'
import depositRoutes from './routes/deposit.routes.js'
import withdrawalRoutes from './routes/withdrawal.routes.js'
import sessionRoutes from './routes/session.routes.js'
import notificationRoutes from './routes/notification.routes.js'
import beneficiaryRoutes from './routes/beneficiary.routes.js'
import { testDatabaseConnection } from './config/database.js'
import authRoutes from './routes/auth.routes.js'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'


dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/auth', loginRoutes)
app.use('/api/auth', sessionRoutes)
app.use('/api/wallet', walletRoutes)
app.use('/api/transactions', transactionRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/beneficiaries', beneficiaryRoutes)
app.use('/api/deposits', depositRoutes)
app.use('/api/withdrawals', withdrawalRoutes)

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Bank App backend is running',
  })
})
testDatabaseConnection()
app.listen(PORT, () => {
  console.log(`Bank App API running on http://localhost:${PORT}`)
})
