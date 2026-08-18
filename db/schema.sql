-- ============================================================
-- SPOTIFY CHARTS TRACKER - Esquema de base de datos
-- PostgreSQL (compatible con Supabase)
-- ============================================================

-- ------------------------------------------------------------
-- 1. CUENTAS DE SPOTIFY (las 2 personas que van a trackear)
-- ------------------------------------------------------------
CREATE TABLE usuarios_spotify (
    id                  SERIAL PRIMARY KEY,
    spotify_user_id     VARCHAR(64) UNIQUE NOT NULL,   -- ID que da Spotify
    nombre_display      VARCHAR(120) NOT NULL,          -- ej: "Marcos", "Jackie"
    imagen_url          TEXT,
    access_token        TEXT NOT NULL,                  -- guardarlos encriptados en la app, no en texto plano
    refresh_token       TEXT NOT NULL,
    token_expira_en     TIMESTAMPTZ NOT NULL,
    necesita_reconexion BOOLEAN NOT NULL DEFAULT false,  -- true si el refresh token dejó de funcionar
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. CATÁLOGO: artistas, álbumes, canciones
--    (se llenan/actualizan solos la primera vez que aparece
--     cada uno en una reproducción)
-- ------------------------------------------------------------
CREATE TABLE artistas (
    id                  SERIAL PRIMARY KEY,
    spotify_artist_id   VARCHAR(64) UNIQUE NOT NULL,
    nombre              VARCHAR(200) NOT NULL,
    imagen_url          TEXT
);

CREATE TABLE albumes (
    id                  SERIAL PRIMARY KEY,
    spotify_album_id    VARCHAR(64) UNIQUE NOT NULL,
    nombre              VARCHAR(200) NOT NULL,
    imagen_url          TEXT,
    fecha_lanzamiento   DATE
);

CREATE TABLE canciones (
    id                  SERIAL PRIMARY KEY,
    spotify_track_id    VARCHAR(64) UNIQUE NOT NULL,
    nombre              VARCHAR(300) NOT NULL,
    album_id            INTEGER REFERENCES albumes(id),
    duracion_ms         INTEGER
);

-- Relación N:M porque una canción puede tener varios artistas (feats)
CREATE TABLE cancion_artistas (
    cancion_id          INTEGER REFERENCES canciones(id) ON DELETE CASCADE,
    artista_id          INTEGER REFERENCES artistas(id) ON DELETE CASCADE,
    es_principal        BOOLEAN DEFAULT true,
    PRIMARY KEY (cancion_id, artista_id)
);

-- ------------------------------------------------------------
-- 3. LA TABLA CLAVE: historial real de reproducciones
--    Cada fila = "esta persona escuchó esta canción a esta hora"
--    Todo lo demás (rankings, tendencias, charts) sale de aquí.
-- ------------------------------------------------------------
CREATE TABLE reproducciones (
    id                  BIGSERIAL PRIMARY KEY,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios_spotify(id),
    cancion_id          INTEGER NOT NULL REFERENCES canciones(id),
    reproducido_en      TIMESTAMPTZ NOT NULL,   -- timestamp que devuelve Spotify (played_at)
    detectado_en        TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo lo captó tu polling
    origen              VARCHAR(20) DEFAULT 'polling'       -- 'polling' o 'recently_played'
);

-- Evita contar dos veces la MISMA reproducción si el polling
-- la agarra en dos ciclos seguidos
CREATE UNIQUE INDEX idx_reproduccion_unica
    ON reproducciones (usuario_id, cancion_id, reproducido_en);

-- Índices para que los rankings no se pongan lentos
CREATE INDEX idx_reproducciones_usuario_fecha
    ON reproducciones (usuario_id, reproducido_en DESC);

CREATE INDEX idx_reproducciones_cancion
    ON reproducciones (cancion_id);

-- ------------------------------------------------------------
-- 4. (Opcional pero recomendado) snapshot de "sonando ahora"
--    Te sirve para el widget de "currently playing" en vivo
--    sin tener que calcularlo desde el historial cada vez.
-- ------------------------------------------------------------
CREATE TABLE reproduccion_actual (
    usuario_id          INTEGER PRIMARY KEY REFERENCES usuarios_spotify(id),
    cancion_id          INTEGER REFERENCES canciones(id),
    empezo_en           TIMESTAMPTZ,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- QUERIES DE EJEMPLO PARA LOS RANKINGS
-- ============================================================

-- 5A. Top canciones INDIVIDUALES de un usuario en los últimos 7 días
-- SELECT c.nombre, COUNT(*) AS veces_escuchada
-- FROM reproducciones r
-- JOIN canciones c ON c.id = r.cancion_id
-- WHERE r.usuario_id = 1
--   AND r.reproducido_en >= now() - INTERVAL '7 days'
-- GROUP BY c.nombre
-- ORDER BY veces_escuchada DESC
-- LIMIT 20;

-- 5B. Chart GLOBAL combinando ambas cuentas (lo más importante del proyecto)
-- SELECT c.nombre, COUNT(*) AS veces_escuchada_total
-- FROM reproducciones r
-- JOIN canciones c ON c.id = r.cancion_id
-- WHERE r.reproducido_en >= now() - INTERVAL '7 days'
-- GROUP BY c.nombre
-- ORDER BY veces_escuchada_total DESC
-- LIMIT 20;

-- 5C. Tendencia: comparar ranking de esta semana vs la semana pasada
-- (para saber si una canción "sube" o "baja")
-- WITH semana_actual AS (
--     SELECT cancion_id, COUNT(*) AS plays,
--            RANK() OVER (ORDER BY COUNT(*) DESC) AS posicion
--     FROM reproducciones
--     WHERE reproducido_en >= now() - INTERVAL '7 days'
--     GROUP BY cancion_id
-- ),
-- semana_pasada AS (
--     SELECT cancion_id, COUNT(*) AS plays,
--            RANK() OVER (ORDER BY COUNT(*) DESC) AS posicion
--     FROM reproducciones
--     WHERE reproducido_en >= now() - INTERVAL '14 days'
--       AND reproducido_en <  now() - INTERVAL '7 days'
--     GROUP BY cancion_id
-- )
-- SELECT c.nombre,
--        sa.posicion AS posicion_actual,
--        sp.posicion AS posicion_anterior,
--        (sp.posicion - sa.posicion) AS cambio  -- positivo = subió
-- FROM semana_actual sa
-- JOIN canciones c ON c.id = sa.cancion_id
-- LEFT JOIN semana_pasada sp ON sp.cancion_id = sa.cancion_id
-- ORDER BY sa.posicion;
