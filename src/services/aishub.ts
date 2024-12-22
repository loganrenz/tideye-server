import { prisma } from '../lib/db';
import { AISHUB } from '../config/constants';

const {
  API_KEY,
  URL,
  RATE_LIMIT,
  LAST_CALL_KEY
} = AISHUB;

interface AISHubResponse {
  ERROR: boolean;
  USERNAME: string;
  FORMAT: string;
  RECORDS?: number;
  ERROR_MESSAGE?: string;
}

interface AISHubVessel {
  MMSI: string;
  NAME: string;
  TIME?: string;
  LONGITUDE?: number;
  LATITUDE?: number;
  [key: string]: any;
}

interface VesselData {
  mmsi: string;
  name: string;
  lastSeen: string;
  position?: {
    longitude: number;
    latitude: number;
  };
  metadata: AISHubVessel;
}

async function getLastCallTime(): Promise<number> {
  const setting = await prisma.systemSettings.findUnique({
    where: { id: LAST_CALL_KEY }
  });
  return setting ? parseInt(setting.value, 10) : 0;
}

async function updateLastCallTime(timestamp: number): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { id: LAST_CALL_KEY },
    create: {
      id: LAST_CALL_KEY,
      value: timestamp.toString()
    },
    update: {
      value: timestamp.toString()
    }
  });
}

async function waitForRateLimit(): Promise<void> {
  const lastCall = await getLastCallTime();
  const now = Date.now();
  const timeSinceLastCall = now - lastCall;

  if (timeSinceLastCall < RATE_LIMIT) {
    const waitTime = RATE_LIMIT - timeSinceLastCall;
    console.log(`Waiting ${waitTime/1000} seconds for rate limit...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

function isValidMMSI(mmsi: string): boolean {
  console.log('Validating MMSI:', mmsi, 'Result:', /^\d{9}$/.test(mmsi));
  return /^\d{9}$/.test(mmsi);
}

async function getInvalidMMSIs(): Promise<Set<string>> {
  const setting = await prisma.systemSettings.findUnique({
    where: { id: AISHUB.INVALID_MMSI_KEY }
  });
  return setting ? new Set(JSON.parse(setting.value)) : new Set();
}

async function addInvalidMMSI(mmsi: string): Promise<void> {
  const invalidMMSIs = await getInvalidMMSIs();
  invalidMMSIs.add(mmsi);
  
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
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

export async function batchGetVesselInfo(mmsis: string[]): Promise<Map<string, VesselData>> {
  const vesselMap = new Map<string, VesselData>();
  
  // Split MMSIs into chunks
  const mmsiChunks = chunkArray(mmsis, AISHUB.MAX_MMSIS_PER_REQUEST);
  
  for (const chunk of mmsiChunks) {
    try {
      await waitForRateLimit();
      
      const params = new URLSearchParams({
        username: API_KEY,
        format: '1',
        output: 'json',
        mmsi: chunk.join(',')
      });

      const url = `${URL}?${params}`;
      console.log('Fetching from URL:', url);

      const response = await fetch(url);
      await updateLastCallTime(Date.now());

      const text = await response.text();
      console.log('Raw response:', text);

      let [metadata, vessels]: [AISHubResponse, AISHubVessel[]] = JSON.parse(text);
      
      // Check for API errors
      if (metadata.ERROR) {
        if (metadata.ERROR_MESSAGE?.includes('Too frequent')) {
          console.log('Rate limit hit, retrying...');
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT));
          return batchGetVesselInfo(mmsis);
        }
        
        // Store invalid MMSI if that's the error
        const invalidMMSIMatch = metadata.ERROR_MESSAGE?.match(/Invalid MMSI "(\d+)"/);
        if (invalidMMSIMatch) {
          const invalidMMSI = invalidMMSIMatch[1];
          console.log(`Storing invalid MMSI: ${invalidMMSI}`);
          await addInvalidMMSI(invalidMMSI);
          
          // Retry without the invalid MMSI
          const remainingMMSIs = mmsis.filter(mmsi => mmsi !== invalidMMSI);
          if (remainingMMSIs.length > 0) {
            return batchGetVesselInfo(remainingMMSIs);
          }
          return new Map();
        }
        
        throw new Error(`AISHub API error: ${metadata.ERROR_MESSAGE}`);
      }

      console.log(`Got ${metadata.RECORDS} vessels from AISHub`);

      if (Array.isArray(vessels)) {
        for (const vessel of vessels) {
          if (vessel.MMSI && vessel.NAME) {
            const vesselData = {
              mmsi: vessel.MMSI.toString(),
              name: vessel.NAME.trim(),
              lastSeen: new Date(vessel.TIME || Date.now()).toISOString(),
              position: vessel.LONGITUDE && vessel.LATITUDE ? {
                longitude: vessel.LONGITUDE,
                latitude: vessel.LATITUDE
              } : undefined,
              metadata: vessel
            };
            
            vesselMap.set(vesselData.mmsi, vesselData);
            
            await prisma.vessel.upsert({
              where: { mmsi: vesselData.mmsi },
              create: {
                mmsi: vesselData.mmsi,
                name: vesselData.name,
                lastSeen: new Date(vesselData.lastSeen),
                metadata: JSON.stringify(vessel)
              },
              update: {
                name: vesselData.name,
                lastSeen: new Date(vesselData.lastSeen),
                metadata: JSON.stringify(vessel)
              }
            });
          }
        }
      }

      // If we have more chunks, wait for rate limit
      if (mmsiChunks.length > 1) {
        console.log('Waiting for rate limit before next chunk...');
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT));
      }
    } catch (error) {
      console.error(`AISHub batch fetch failed for chunk:`, error);
      // Continue with next chunk even if this one failed
    }
  }

  return vesselMap;
} 