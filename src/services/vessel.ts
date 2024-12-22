import { prisma } from '../lib/db';
import { SignalKClient } from '@tideye/signalk-client';

const AISHUB_API_KEY = 'AH_3819_4C57E4B4';
const AISHUB_URL = 'https://www.aishub.net/api';
const AISHUB_RATE_LIMIT = 60 * 1000; // 60 seconds in milliseconds

let lastAishubCall = 0;

export async function getVesselName(mmsi: string): Promise<string | null> {
  // First check our local database
  const storedVessel = await prisma.vessel.findUnique({
    where: { mmsi }
  });

  if (storedVessel?.name) {
    return storedVessel.name;
  }

  // Try SignalK
  try {
    const signalkClient = new SignalKClient(process.env.SIGNALK_URL || '');
    const vessel = await signalkClient.getVessel(mmsi);
    if (vessel?.name) {
      return vessel.name;
    }
  } catch (error) {
    console.error('SignalK fetch failed:', error);
  }

  // Finally, try AISHub if enough time has passed
  const now = Date.now();
  if (now - lastAishubCall >= AISHUB_RATE_LIMIT) {
    try {
      const response = await fetch(`${AISHUB_URL}/vessel_info.php?mmsi=${mmsi}&format=json&apikey=${AISHUB_API_KEY}`);
      lastAishubCall = now;

      if (!response.ok) {
        throw new Error(`AISHub API error: ${response.status}`);
      }

      const data = await response.json();
      if (data?.vessels?.[0]?.name) {
        const vesselName = data.vessels[0].name.trim();
        
        // Store in database
        await prisma.vessel.upsert({
          where: { mmsi },
          create: {
            mmsi,
            name: vesselName,
            lastSeen: new Date(),
            metadata: JSON.stringify(data.vessels[0])
          },
          update: {
            name: vesselName,
            metadata: JSON.stringify(data.vessels[0])
          }
        });

        return vesselName;
      }
    } catch (error) {
      console.error('AISHub fetch failed:', error);
    }
  }

  return null;
} 