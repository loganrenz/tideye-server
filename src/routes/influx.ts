import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Request, Response } from 'express';
import { InfluxDB } from '@influxdata/influxdb-client';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Ensure environment variables are loaded
dotenv.config();

// Create shared InfluxDB client
const influxClient = new InfluxDB({
  url: process.env.INFLUXDB_URL || '',
  token: process.env.INFLUXDB_TOKEN || ''
});

const prisma = new PrismaClient();

const router = Router();

// Health check route
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

interface InfluxRow {
  context: string;
  [key: string]: unknown;
}

// Get all vessels MMSIs
router.get('/vessel-positions', async (req: Request, res: Response, next) => {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const queryApi = influxClient.getQueryApi(process.env.INFLUXDB_ORG_ID || '');

  const query = `
    from(bucket: "Tideye")
      |> range(start: ${start.toISOString()}, stop: ${end.toISOString()})
      |> filter(fn: (r) => r["_measurement"] == "navigation.position")
      |> filter(fn: (r) => r["_field"] == "lat" or r["_field"] == "lon")
      |> pivot(rowKey:["_time", "context"], columnKey: ["_field"], valueColumn: "_value")
      |> yield(name: "positions")
  `;

  try {
    const result = await queryApi.collectRows<{ context: string; _time: string; lat: number; lon: number }>(query);
    
    // Store positions in database
    await Promise.all(result.map(async row => {
      const mmsi = row.context.split(':').pop() || '';
      await prisma.positionHistory.create({
        data: {
          mmsi,
          lat: row.lat,
          lon: row.lon,
          timestamp: new Date(row._time),
        }
      });
    }));

    res.json(result);
    return next();
  } catch (error) {
    console.error('Error fetching vessels:', error);
    res.status(500).json({ error: 'Failed to fetch vessels' });
  }
});

// Proxy middleware for other InfluxDB requests
router.use('/', createProxyMiddleware({
  target: process.env.INFLUXDB_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/influx': '',
  },
  on: {
    proxyReq: (proxyReq, req: Request, res) => {
      proxyReq.setHeader('Authorization', `Token ${process.env.INFLUXDB_TOKEN}`);
      
      if (req.body) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    }
  },
}));

export default router; 