const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const express = require('express');
process.env.INTEGRATION_TOKEN = 'integration-tests-only';
jest.mock('../src/db', () => ({ query: jest.fn() }));
const db = require('../src/db');
const { router, obtenerStreamsHistoricosPorArtista } = require('../src/integrationsApi');
const describeWithDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
describeWithDb('Lifetime integration (isolated PostgreSQL)', () => {
  let pool, server, base;
  beforeAll(async () => {
    pool = new Pool({connectionString:process.env.TEST_DATABASE_URL});
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pool.query(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
    db.query.mockImplementation((...args)=>pool.query(...args));
    const app=express();app.use('/api/integrations',router);
    server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${server.address().port}/api/integrations`;
  });
  afterAll(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  test('empty history is explicit zero with no dates',async()=>{
    const data=await obtenerStreamsHistoricosPorArtista(pool);
    expect(data.scope).toBe('lifetime');expect(data.summary.combined_streams).toBe(0);
    expect(data.summary.first_played_at).toBeNull();expect(data.records).toEqual([]);
  });
  test('whole history, collaborations, account isolation and uncredited plays',async()=>{
    await pool.query(`INSERT INTO usuarios_spotify (spotify_user_id,nombre_display,access_token,refresh_token,token_expira_en)
      VALUES ('one','Marcos','private','private',NOW()),('two','Jackie','private','private',NOW()),('extra','Other','private','private',NOW());
      INSERT INTO artistas (spotify_artist_id,nombre) VALUES ('artist1','First'),('artist2','Second');
      INSERT INTO canciones (spotify_track_id,nombre) VALUES ('song','Collaboration'),('uncredited','No credits');
      INSERT INTO cancion_artistas (cancion_id,artista_id) VALUES (1,1),(1,2);
      INSERT INTO reproducciones (usuario_id,cancion_id,reproducido_en) VALUES
      (1,1,'2020-01-01'),(1,1,'2021-01-01'),(2,1,'2022-01-01'),(2,2,'2026-01-01'),(3,1,'2010-01-01');`);
    const data=await obtenerStreamsHistoricosPorArtista(pool);
    expect(data.summary).toMatchObject({account_1_streams:2,account_2_streams:2,combined_streams:4});
    expect(data.summary.first_played_at).toContain('2020-01-01');
    expect(data.summary.last_played_at).toContain('2026-01-01');
    expect(data.total_records).toBe(2);
    for(const r of data.records) expect(r).toMatchObject({account_1_streams:2,account_2_streams:1,combined_streams:3});
    expect(data.records.reduce((n,r)=>n+r.combined_streams,0)).toBe(6);
    expect(JSON.stringify(data.accounts)).not.toContain('private');
    expect(data.accounts.map(a=>a.nombre_display)).toEqual(['Marcos','Jackie']);
  });
  test('endpoint requires integration token and returns expected contract',async()=>{
    expect((await fetch(base+'/lifetime-artist-streams')).status).toBe(401);
    const response=await fetch(base+'/lifetime-artist-streams',{headers:{'x-integration-token':'integration-tests-only'}});
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).summary.combined_streams).toBe(4);
  });
});
