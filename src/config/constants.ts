export const AISHUB = {
  API_KEY: 'AH_3819_4C57E4B4',
  URL: 'https://data.aishub.net/ws.php',
  RATE_LIMIT: 1 * 60 * 1000, // 1 minute in milliseconds
  LAST_CALL_KEY: 'aishub_last_call',
  INVALID_MMSI_KEY: 'aishub_invalid_mmsis',
  MAX_MMSIS_PER_REQUEST: 25 // Maximum MMSIs per request
} as const; 