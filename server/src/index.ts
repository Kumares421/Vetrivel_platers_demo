import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initDb } from './db';
import authRouter, { seedDefaultUsers } from './routes/auth';
import chemicalsRouter from './routes/chemicals';
import suppliersRouter from './routes/suppliers';
import tanksRouter from './routes/tanks';
import receiptsRouter from './routes/receipts';
import openingStockRouter from './routes/openingStock';
import issuesRouter from './routes/issues';
import stockRouter from './routes/stock';
import reversalsRouter from './routes/reversals';
import reportsRouter from './routes/reports';
import attachmentsRouter from './routes/attachments';
import seedRouter from './routes/seed';
import backupRouter from './routes/backup';
import customersRouter from './routes/customers';
import partsRouter from './routes/parts';
import customerOrdersRouter from './routes/customerOrders';
import customerPartsInwardRouter from './routes/customerPartsInward';
import jobCardsRouter from './routes/jobCards';
import chemicalPOsRouter from './routes/chemicalPOs';
import productionRouter from './routes/production';
import qcRouter from './routes/qc';
import dispatchRouter from './routes/dispatch';
import invoicesRouter from './routes/invoices';
import paymentsRouter from './routes/payments';
import accountsReceivableRouter from './routes/accountsReceivable';
import gstReportsRouter from './routes/gstReports';
import financialDashboardRouter from './routes/financialDashboard';
import traceabilityRouter from './routes/traceability';
import productionPlanningRouter from './routes/productionPlanning';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Idempotency-Key', 'x-idempotency-key']
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Mount API Routes
app.use('/api/auth', authRouter);
app.use('/api/chemicals', chemicalsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/tanks', tanksRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/opening-stock', openingStockRouter);
app.use('/api/issues', issuesRouter);
app.use('/api/stock', stockRouter);
app.use('/api/reversals', reversalsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/seed', seedRouter);
app.use('/api/customers', customersRouter);
app.use('/api/parts', partsRouter);
app.use('/api/customer-orders', customerOrdersRouter);
app.use('/api/customer-parts-inward', customerPartsInwardRouter);
app.use('/api/job-cards', jobCardsRouter);
app.use('/api/chemical-pos', chemicalPOsRouter);
app.use('/api/production', productionRouter);
app.use('/api/qc', qcRouter);
app.use('/api/dispatch', dispatchRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/accounts-receivable', accountsReceivableRouter);
app.use('/api/gst-reports', gstReportsRouter);
app.use('/api/financial-dashboard', financialDashboardRouter);
app.use('/api/traceability', traceabilityRouter);
app.use('/api/production-planning', productionPlanningRouter);
app.use('/api', backupRouter);

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend files if built in dist
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Qelanto Factory Manager API Server is running on port ' + PORT);
    }
  });
});

// Global Express Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Express Unhandled Error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

async function startServer() {
  try {
    await initDb();
    await seedDefaultUsers();

    app.listen(PORT, () => {
      console.log(`Qelanto Factory Manager Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
