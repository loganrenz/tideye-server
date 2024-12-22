import { Router, RequestHandler } from 'express';
import { SignalKClient } from '@tideye/signalk-client';
import { InfluxDB } from '@influxdata/influxdb-client';
import dotenv from 'dotenv';
import { prisma } from '../lib/db';
import { getVesselName } from '../services/vessel';
import { batchGetVesselInfo } from '../services/aishub';
import { AISHUB } from '../config/constants';

dotenv.config();

const router = Router();

// Initialize clients
const signalkClient = new SignalKClient(process.env.SIGNALK_URL || '');
const influxClient = new InfluxDB({
  url: process.env.INFLUXDB_URL || '',
  token: process.env.INFLUXDB_TOKEN || ''
});

interface VesselInfo {
  mmsi: string;
  name?: string;
  lastSeen: string;
}

interface CachedVessel {
  mmsi: string;
  name: string | null;
  lastSeen: Date;
  metadata: string | null;
}

interface InfluxQueryOptions {
  maxRetries: number;
  timeout: number;
}

async function queryInfluxWithRetry(
  queryApi: any, 
  query: string, 
  options: InfluxQueryOptions = { maxRetries: 3, timeout: 30000 }
): Promise<any[]> {
  let attempt = 0;
  while (attempt < options.maxRetries) {
    try {
      return await Promise.race([
        queryApi.collectRows(query),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), options.timeout)
        )
      ]);
    } catch (error) {
      attempt++;
      console.log(`InfluxDB query attempt ${attempt} failed:`, error);
      if (attempt === options.maxRetries) throw error;
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Max retries reached');
}

const MAX_QUERY_DAYS = 7; // Maximum range in days

const getVesselNamesHandler: RequestHandler = async (req, res, next) => {
  const queryApi = influxClient.getQueryApi(process.env.INFLUXDB_ORG_ID || '');
  
  // Parse date parameters with fallback to last 24 hours
  const end = req.query.end ? new Date(req.query.end as string) : new Date();
  const start = req.query.start 
    ? new Date(req.query.start as string)
    : new Date(end.getTime() - 24 * 60 * 60 * 1000);

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ error: 'Invalid date format' });
    return next();
  }

  // Check range limit
  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > MAX_QUERY_DAYS) {
    res.status(400).json({ 
      error: `Date range too large. Maximum range is ${MAX_QUERY_DAYS} days` 
    });
    return next();
  }

  try {
    // First check SQLite cache for all vessels
    const cachedVessels = await prisma.vessel.findMany({
      where: {
        lastSeen: {
          gte: start,
          lte: end
        }
      },
      orderBy: {
        lastSeen: 'desc'
      }
    });

    const vesselData = new Map<string, any>();
    const cachedMMSIs = new Set(cachedVessels.map((v: CachedVessel) => v.mmsi));
    
    // Add cached vessels to response
    cachedVessels.forEach((vessel: CachedVessel) => {
      vesselData.set(vessel.mmsi, {
        mmsi: vessel.mmsi,
        name: vessel.name,
        lastSeen: vessel.lastSeen.toISOString(),
        metadata: vessel.metadata ? JSON.parse(vessel.metadata) : undefined
      });
    });

    // Get vessels from InfluxDB that aren't in cache
    const query = `
      from(bucket: "Tideye")
        |> range(start: ${start.toISOString()}, stop: ${end.toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "navigation.position")
        |> group(columns: ["context"])
        |> last()
        |> keep(columns: ["_time", "context"])
        |> yield(name: "vessels")
    `;

    const result = await queryInfluxWithRetry(queryApi, query);
    const mmsis = result.map(row => row.context.split(':').pop() || '');
    
    // Filter out already cached MMSIs
    const uncachedMMSIs = mmsis.filter(mmsi => !cachedMMSIs.has(mmsi));

    // Try SignalK for uncached vessels
    for (const mmsi of uncachedMMSIs) {
      try {
        const vessel = await signalkClient.getVessel(mmsi);
        if (vessel?.name) {
          vesselData.set(mmsi, {
            mmsi,
            name: vessel.name,
            lastSeen: new Date().toISOString(),
            position: vessel.navigation?.position
          });
          
          // Update cache
          await prisma.vessel.upsert({
            where: { mmsi },
            create: {
              mmsi,
              name: vessel.name,
              lastSeen: new Date(),
              metadata: JSON.stringify(vessel)
            },
            update: {
              name: vessel.name,
              lastSeen: new Date(),
              metadata: JSON.stringify(vessel)
            }
          });
        }
      } catch (error) {
        console.error(`SignalK fetch failed for ${mmsi}:`, error);
      }
    }

    // Only try AISHub for vessels we couldn't find elsewhere
    const missingMmsis = uncachedMMSIs.filter(mmsi => !vesselData.has(mmsi));
    if (missingMmsis.length > 0) {
      try {
        const canCallAISHub = await prisma.systemSettings.findUnique({
          where: { id: AISHUB.LAST_CALL_KEY }
        }).then(setting => {
          if (!setting) return true;
          const lastCall = parseInt(setting.value, 10);
          return Date.now() - lastCall >= AISHUB.RATE_LIMIT;
        });

        if (canCallAISHub) {
          const aisHubVessels = await batchGetVesselInfo(missingMmsis);
          for (const [mmsi, vessel] of aisHubVessels) {
            vesselData.set(mmsi, vessel);
          }
        } else {
          console.log('Skipping AISHub call due to rate limit');
        }
      } catch (error) {
        console.error('AISHub batch fetch failed:', error);
      }
    }

    res.json(
      Array.from(vesselData.values())
        .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    );
    return next();
  } catch (error: any) {
    console.error('Failed to fetch vessel names:', error);
    res.status(500).json({
      error: 'Failed to fetch vessel names',
      details: error.message
    });
    return next();
  }
};

/**
 * @openapi
 * /api/composite/vessel-names:
 *   get:
 *     summary: Get names of vessels seen within a time range
 *     tags: [Vessels]
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start time (ISO 8601). Defaults to 24 hours ago
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End time (ISO 8601). Defaults to now
 *     responses:
 *       200:
 *         description: List of vessels with names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   mmsi:
 *                     type: string
 *                   name:
 *                     type: string
 *                   lastSeen:
 *                     type: string
 *                     format: date-time
 *       400:
 *         description: Invalid date format
 *       500:
 *         description: Server error
 */
router.get('/vessel-names', getVesselNamesHandler);

export default router; 