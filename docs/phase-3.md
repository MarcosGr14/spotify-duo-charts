# Fase 3: rendimiento y consumo

## Cambios

- Caché JSON en memoria después de la autenticación y los límites de peticiones. Rankings y usuarios: 30 s; actividad, records, coincidencias e historial de un elemento: 60 s; reproducción actual: 3 s. La sincronización de escuchas conserva su frecuencia.
- Peticiones simultáneas con la misma ruta y filtros comparten una consulta. Los errores y las exportaciones grandes no se almacenan. Máximo 128 respuestas, 8 MiB en total y 512 KiB por respuesta; se descartan las menos usadas. No hay caché pública de datos musicales en navegador ni CDN.
- Catálogo: hasta 2.000 canciones recientes durante una hora evitan repetir los mismos upserts. Un cambio en los metadatos genera otra clave. Las reproducciones siguen guardándose individualmente y los fallos se reintentan.
- La interfaz cancela solicitudes de filtros/vistas anteriores y pausa las actualizaciones mientras la pestaña está oculta. Al regresar recupera la vista actual. El Top 3 se oculta en Perfil y una respuesta tardía de Overview no puede sustituir el ranking de otra vista.
- Métricas privadas en `/api/integrations/performance`, con el mismo token Bearer de las integraciones: memoria RSS, consultas, errores, tiempos acumulados, conexiones y uso de caché. `Server-Timing` muestra el tiempo de procesamiento HTTP. No se exponen SQL, tokens ni datos de escucha en las métricas.
- `APP_WORKERS_ENABLED=false` permite verificar una instancia local sin duplicar el polling de producción. El valor predeterminado mantiene los workers activos.

Las respuestas pueden reflejar datos de hasta 60 segundos antes por la caché. Esta no sustituye el almacenamiento persistente y se vacía al reiniciar.

## Railway

Aplicado exclusivamente al servicio Spotify Charts:

- Una réplica en US East, Virginia, cerca de Supabase; antes estaba en Amsterdam.
- Máximo 1 vCPU y 0,5 GB de RAM por réplica. La validación local utilizó aproximadamente 105–111 MiB de RSS. Los límites restringen recursos, no fijan una factura mensual.
- Healthcheck `/health` con espera de 60 s y reinicio On Failure, hasta 10 intentos.
- Esperar al resultado de CI antes de desplegar.
- Serverless desactivado para conservar la captura programada del historial aunque nadie abra la web.

No se añade Redis, otro servicio ni una segunda réplica. No se aplica un apagado por presupuesto que pueda interrumpir la captura. Conviene observar RAM y facturación durante un ciclo completo; subir el límite de memoria si se acerca sostenidamente a 400 MiB o aparecen reinicios por falta de memoria.

## Medición inicial y validación

Muestras de tres peticiones por ruta desde el mismo equipo el 3 de noviembre de 2026. Son medianas HTTP orientativas, no percentiles de carga ni garantías de latencia.

| API | Antes, Amsterdam | Virginia, antes de la caché nueva |
| --- | ---: | ---: |
| Canciones, 30 días | 739 ms | 381 ms |
| Artistas, todo el historial | 308 ms | 122 ms |
| Actividad | 603 ms | 167 ms |
| Music Match | 483 ms | 117 ms |
| Records | 398 ms | 118 ms |

`EXPLAIN ANALYZE` de rankings: canciones 27,6 ms, artistas 8,6 ms y álbumes 5,0 ms. Los índices actuales son suficientes para el volumen observado; no se añaden índices ni tablas de agregados sin una necesidad medida.

La prueba local de ocho peticiones concurrentes idénticas produjo una consulta SQL y siete respuestas compartidas. Los aciertos de caché se procesaron en aproximadamente 1–2 ms. La suite completa pasó con PostgreSQL aislado: 12 suites, 84 pruebas. No se migraron ni eliminaron datos de producción.
