import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../.env') });
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders.js';
import syncRouter from './routes/sync.js';
import statsRouter from './routes/stats.js';
import pricesRouter from './routes/prices.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/orders', ordersRouter);
app.use('/api/sync', syncRouter);
app.use('/api/stats', statsRouter);
app.use('/api/prices', pricesRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
