-- Cambio aditivo, ejecutar una vez antes de desplegar el nuevo worker.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.artistas ADD COLUMN IF NOT EXISTS imagen_revisar_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_artistas_imagen_revisar_en
    ON public.artistas (imagen_revisar_en ASC NULLS FIRST, id);
COMMIT;
