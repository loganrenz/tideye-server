import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import influxRoutes from '../influx';

const app = express();
app.use('/api/influx', influxRoutes);

describe('Influx Routes', () => {
  it('should proxy request to InfluxDB', async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 60000);

    const requestBody = {
      query: `
        from(bucket: "Tideye")
          |> range(start: ${start.toISOString()}, stop: ${end.toISOString()})
          |> filter(fn: (r) => r["_measurement"] == "environment.wind.speedApparent")
          |> filter(fn: (r) => r["_field"] == "value")
          |> filter(fn: (r) => r["context"] == "vessels.urn:mrn:imo:mmsi:368327340")
          |> filter(fn: (r) => r["self"] == "true")
          |> aggregateWindow(every: 1s, fn: mean, createEmpty: false)
          |> yield(name: "latest")
      `,
      dialect: {
        header: true,
        delimiter: ",",
        quoteChar: "\"",
        commentPrefix: "#",
        annotations: ["datatype", "group", "default"]
      },
      type: 'flux'
    };

    console.log('\nWind Speed Query:', requestBody.query);

    try {
      const response = await request(app)
        .post('/api/influx/api/v2/query')
        .query({ org: process.env.INFLUXDB_ORG_ID })
        .set('Content-Type', 'application/json; encoding=utf-8')
        .set('Accept', '*/*')
        .send(requestBody);

      console.log('Response status:', response.status);
      if (response.status !== 200) {
        console.error('Error details:', {
          status: response.status,
          body: response.body
        });
      }

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    } catch (error) {
      console.error('Request error:', error);
      throw error;
    }
  });

  it('should fetch all vessels from the last week', async () => {
    const vesselQuery = `
      from(bucket: "Tideye")
        |> range(start: ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}, stop: ${new Date().toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "navigation.position")
        |> filter(fn: (r) => r["_field"] == "value")
        |> group(columns: ["context"])
        |> distinct(column: "context")
        |> yield(name: "vessels")
    `;

    console.log('\nVessels Query:', vesselQuery);

    const response = await request(app)
      .get('/api/influx/vessels')
      .set('Accept', '*/*');

    console.log('Vessels response:', {
      status: response.status,
      data: response.text.slice(0, 200) + '...'
    });

    expect(response.status).toBe(200);
    expect(response.text).toBeDefined();
    
    const lines = response.text.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    
    const header = lines[0];
    expect(header).toContain('context');
  });

  it('should fetch unique vessel MMSIs', async () => {
    const vesselQuery = `
      from(bucket: "Tideye")
        |> range(start: ${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}, stop: ${new Date().toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "navigation.position")
        |> group(columns: ["context"])
        |> distinct(column: "context")
        |> yield(name: "vessels")
    `;

    console.log('\nVessel MMSIs Query:', vesselQuery);

    const response = await request(app)
      .get('/api/influx/vessel-positions')
      .set('Accept', 'application/json');

    console.log('MMSIs response:', {
      status: response.status,
      data: response.body
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    
    if (response.body.length > 0) {
      const vessel = response.body[0];
      expect(vessel).toHaveProperty('mmsi');
    }
  });
}); 