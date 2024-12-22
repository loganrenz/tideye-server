import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import compositeRoutes from '../composite';

const app = express();
app.use('/api/composite', compositeRoutes);

describe('Composite Routes', () => {
  it('should fetch vessel names', async () => {
    const response = await request(app)
      .get('/api/composite/vessel-names')
      .set('Accept', 'application/json');

    console.log('Vessel names response:', {
      status: response.status,
      count: response.body?.length,
      sample: response.body?.slice(0, 2)
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    
    if (response.body.length > 0) {
      const vessel = response.body[0];
      expect(vessel).toHaveProperty('mmsi');
      expect(vessel).toHaveProperty('lastSeen');
    }
  });
}); 