import { Router, Request, Response, RequestHandler } from 'express';
import { SignalKClient } from '@tideye/signalk-client';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Ensure environment variables are loaded
dotenv.config();

const router = Router();

if (!process.env.SIGNALK_URL) {
  throw new Error('SIGNALK_URL environment variable is required');
}

const signalkClient = new SignalKClient(process.env.SIGNALK_URL);
console.log('SignalK Client Info:', signalkClient.getClientInfo());

router.get('/vessel', async (req, res) => {
  try {
    const vessel = await signalkClient.getSelf();
    res.json(vessel);
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Failed to fetch vessel data',
      details: error.message 
    });
  }
});

interface VesselParams {
  mmsi: string;
}

const vesselHandler: RequestHandler = async (req, res, next) => {
  const { mmsi } = req.params;
  console.log(`Attempting to fetch vessel with MMSI: ${mmsi}`);
  
  try {
    const vessel = await signalkClient.getVessel(mmsi);
    
    if (!vessel) {
      console.error(`No vessel found with MMSI: ${mmsi}`);
      res.status(404).json({ error: `No vessel found with MMSI: ${mmsi}` });
      return next();
    }

    // Store in database
    await prisma.vessel.upsert({
      where: { mmsi },
      create: {
        mmsi,
        name: vessel.name || 'Unknown',
        lastSeen: new Date(),
        metadata: JSON.stringify(vessel)
      },
      update: {
        lastSeen: new Date(),
        metadata: JSON.stringify(vessel)
      }
    });

    console.log(`Successfully fetched vessel: ${mmsi}`);
    res.json(vessel);
    return next();
  } catch (error: any) {
    console.error('Failed to fetch vessel data:', {
      mmsi,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch vessel data',
      details: error.message
    });
    return next();
  }
};

router.get('/vessels/:mmsi', vesselHandler);

export default router; 