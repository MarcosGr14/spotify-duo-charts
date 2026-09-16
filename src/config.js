require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  INTERVALO_CURRENTLY_MS: 20 * 1000,
  INTERVALO_HISTORIAL_MS: 5 * 60 * 1000,
  // ------------------------------------------------------------
  // ASUNCIÓN EXPLÍCITA (Fase 6 — Night Owl):
  // reproducido_en se guarda como TIMESTAMPTZ (instante absoluto en
  // UTC). Para saber si una reproducción fue "de noche" en la vida
  // real de Marcos/Jackie hace falta convertir ese instante a una
  // zona horaria concreta — la app nunca hizo esto antes.
  //
  // Default: 'America/Panama' (UTC-5 fijo, sin horario de verano)
  // porque es la ubicación conocida de Marcos. Si alguna vez Jackie
  // escucha desde otro huso, esto queda incorrecto para ella — la
  // métrica asume una única zona horaria para el dúo completo, no
  // por usuario. Confirmar con Marcos antes de confiar en Night Owl
  // en producción; mientras tanto es overrideable con la env var
  // ZONA_HORARIA sin tocar código.
  // ------------------------------------------------------------
  ZONA_HORARIA: process.env.ZONA_HORARIA || 'America/Panama'
};