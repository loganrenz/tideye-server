import { Router, RequestHandler } from 'express';
import { batchGetVesselInfo } from '../services/aishub';
import { PrismaClient } from '@prisma/client';
import { AISHUB } from '../config/constants';

const router = Router();
const prisma = new PrismaClient();

const getVesselInfoHandler: RequestHandler = async (req, res, next) => {
  const mmsis = req.query.mmsi as string | string[];
  
  if (!mmsis) {
    res.status(400).json({ error: 'No MMSIs provided' });
    return next();
  }

  const mmsiList = Array.isArray(mmsis) ? mmsis : [mmsis];

  try {
    const vessels = await batchGetVesselInfo(mmsiList);
    res.json(Array.from(vessels.values()));
    return next();
  } catch (error: any) {
    if (error.message.includes('rate limit')) {
      res.status(429).json({ 
        error: 'Rate limit in effect',
        retryAfter: '60 seconds'
      });
      return next();
    }
    res.status(500).json({ 
      error: 'Failed to fetch vessel info',
      details: error.message 
    });
    return next();
  }
};

router.get('/vessels', getVesselInfoHandler);

router.get('/status', async (req, res) => {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { id: AISHUB.LAST_CALL_KEY }
    });
    
    const lastCall = setting ? parseInt(setting.value, 10) : 0;
    const now = Date.now();
    const timeSince = now - lastCall;
    const canCall = timeSince >= AISHUB.RATE_LIMIT;

    res.json({
      lastCall: new Date(lastCall).toISOString(),
      timeSince: Math.floor(timeSince / 1000),
      canCall,
      nextCallIn: canCall ? 0 : Math.ceil((AISHUB.RATE_LIMIT - timeSince) / 1000)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch AISHub status' });
  }
});

router.get('/invalid-mmsis', async (req, res) => {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { id: AISHUB.INVALID_MMSI_KEY }
    });
    
    const invalidMMSIs = setting ? JSON.parse(setting.value) : [];
    res.json(invalidMMSIs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invalid MMSIs' });
  }
});

router.delete('/invalid-mmsis/:mmsi', async (req, res) => {
  try {
    const { mmsi } = req.params;
    const setting = await prisma.systemSettings.findUnique({
      where: { id: AISHUB.INVALID_MMSI_KEY }
    });
    
    const invalidMMSIs = setting ? new Set(JSON.parse(setting.value)) : new Set();
    invalidMMSIs.delete(mmsi);

    await prisma.systemSettings.upsert({
      where: { id: AISHUB.INVALID_MMSI_KEY },
      create: {
        id: AISHUB.INVALID_MMSI_KEY,
        value: JSON.stringify(Array.from(invalidMMSIs))
      },
      update: {
        value: JSON.stringify(Array.from(invalidMMSIs))
      }
    });

    res.json({ message: `Removed ${mmsi} from invalid MMSIs` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove invalid MMSI' });
  }
});

export default router; 