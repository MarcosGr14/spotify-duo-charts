BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS app_private.runtime (
  clave text PRIMARY KEY,
  valor jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
ALTER TABLE app_private.runtime ENABLE ROW LEVEL SECURITY;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER TABLE public.usuarios_spotify ADD COLUMN IF NOT EXISTS ultima_sincronizacion_en timestamptz;
ALTER TABLE public.usuarios_spotify ADD COLUMN IF NOT EXISTS ultimo_intento_en timestamptz;
ALTER TABLE public.usuarios_spotify ADD COLUMN IF NOT EXISTS ultimo_error_sync text;
ALTER TABLE public.usuarios_spotify ADD COLUMN IF NOT EXISTS posibles_huecos integer NOT NULL DEFAULT 0;
ALTER TABLE public.usuarios_spotify ADD COLUMN IF NOT EXISTS elementos_fallidos integer NOT NULL DEFAULT 0;
COMMIT;
