# Integración histórica de solo lectura

`GET /api/integrations/lifetime-artist-streams`, protegido por el mismo `x-integration-token` de la integración diaria.

Devuelve `scope: lifetime`, `synced_at`, `timezone`, `accounts`, `summary`, `total_records` y `records`.

- Las cuentas son las dos primeras por ID, igual que la integración diaria. `position` identifica explícitamente el desglose 1/2 y cada entrada incluye nombre e ID Spotify; no incluye credenciales.
- `summary` cuenta eventos directamente en `reproducciones`: `account_1_streams`, `account_2_streams`, `combined_streams`, `first_played_at`, `last_played_at`.
- `records` contiene esos mismos campos por artista, además de `spotify_artist_id`, `artist_name`, `image_url`.
- No hay filtro por fecha: se incluye todo el historial almacenado para esas cuentas. La primera fecha registrada delimita la cobertura real.
- Una canción compartida acredita una reproducción a cada artista; el total global no suma las filas de artistas, evitando doble conteo.
- Incluso una reproducción todavía sin artista asociado forma parte del total global.
- Una única consulta SQL mantiene consistentes los totales, artistas y cuentas frente a inserciones concurrentes.
- Sin historial, devuelve cuentas disponibles, `records: []`, contadores en cero y fechas nulas.

No requiere cambios en el esquema ni modifica datos del servicio de origen.

## Filtros del catálogo y rango

Los endpoints histórico y diario aceptan `artist_ids` (IDs Spotify separados por comas, máximo 200). El histórico acepta `from=YYYY-MM-DD`; su total global cuenta solo eventos que acreditan al menos un artista seleccionado, sin duplicarlos por colaboraciones. La respuesta histórica incluye `filter` para verificar los filtros aplicados.

`GET /api/integrations/artist-streams-range?from=YYYY-MM-DD&to=YYYY-MM-DD&artist_ids=...` devuelve los conteos por artista y día dentro del rango inclusivo (máximo dos años), usando America/Panama. El filtro de artistas es obligatorio. Los días sin reproducciones no tienen filas. Esta consulta permite importar el año en una sola petición y evita transferir artistas fuera del catálogo.
