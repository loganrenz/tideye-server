import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import signalkRoutes from '../signalk';

const app = express();
app.use('/api/signalk', signalkRoutes);

describe('SignalK Routes', () => {
  it('should fetch vessel by MMSI', async () => {
    const mmsi = '319139200'; // Example MMSI from your data
    const response = await request(app)
      .get(`/api/signalk/vessels/${mmsi}`)
      .set('Accept', 'application/json');

    console.log('Vessel response:', {
      status: response.status,
      data: response.body
    });

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty('mmsi', mmsi);
  });
}); 