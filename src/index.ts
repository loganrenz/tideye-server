import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { fileURLToPath } from 'url';
import signalkRoutes from './routes/signalk';
import influxRoutes from './routes/influx';
import compositeRoutes from './routes/composite';
import aishubRoutes from './routes/aishub';
import { specs } from './openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// Serve OpenAPI docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Routes
app.use('/api/signalk', signalkRoutes);
app.use('/api/influx', influxRoutes);
app.use('/api/composite', compositeRoutes);
app.use('/api/aishub', aishubRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`API documentation available at http://localhost:${port}/api-docs`);
  console.log(`Simple UI available at http://localhost:${port}`);
});  