# Inventario funcional y plan de mejora

## Alcance y regla de preservación

Este inventario describe el código del repositorio en la rama `main` al iniciar la actualización. No consulta ni modifica la base de datos remota. El historial de Spotify es información esencial y no se debe truncar, reemplazar ni borrar durante las mejoras de interfaz o funciones.

## Arquitectura observada

- **Servidor:** Node.js y Express 5 (`src/index.js`), sirve `public/`, monta OAuth y API, expone `/health` y ejecuta los ciclos automáticos.
- **Persistencia:** PostgreSQL mediante `pg` (`src/db.js`). `db/schema.sql` define las tablas que usa la app; el inventario remoto y cualquier cambio a Supabase requieren una revisión independiente.
- **Integración:** OAuth de Spotify, renovación de tokens, cifrado de tokens (`src/spotifyAuth.js`, `src/crypto.js`) y polling (`src/poller.js`).
- **Cliente:** HTML/CSS/JavaScript sin framework (`public/index.html`, `public/style.css`, `public/app.js`).
- **Observabilidad:** Sentry (`src/instrument.js`) y health check HTTP con comprobación de base de datos.
- **Ejecución:** `npm start`; pruebas Jest existentes (`npm test`). No se ejecutan pruebas automáticamente en esta actualización.

## Funciones existentes que deben mantenerse

1. Conectar/reconectar dos cuentas de Spotify.
2. Consultar qué reproduce cada cuenta y mostrar progreso aproximado; refresco del widget cada 20 segundos.
3. Recoger historial real cada cinco minutos y evitar duplicados mediante el índice único del historial.
4. Rankings globales e individuales de canciones, artistas y álbumes.
5. Filtros por hoy, 7 días, 30 días y todo el tiempo; búsqueda por artista; paginación.
6. Top 3, tendencias frente al período anterior y gráfica de 14 días al expandir una fila.
7. Music Match y balance de escucha en la vista general.
8. Insights: canción más escuchada, escucha nocturna y obsesión compartida.
9. `/health` y captura de errores con Sentry.

## Mapa de datos

| Tabla | Propósito en la app | Importancia |
| --- | --- | --- |
| `usuarios_spotify` | Cuentas conectadas, perfil y tokens cifrados | Crítica; nunca borrar/recrear como parte de una mejora visual |
| `reproducciones` | Historial individual con instante de escucha | Crítica; fuente de rankings e insights |
| `canciones` | Catálogo de tracks | Crítica; enlazado al historial |
| `artistas` | Catálogo de artistas | Crítica; enlazado a canciones |
| `albumes` | Catálogo de álbumes | Crítica; enlazado a canciones |
| `cancion_artistas` | Relación de canciones y artistas | Crítica para atribución y conteo correcto |
| `reproduccion_actual` | Estado actual por cuenta | Derivada/temporal respecto al historial |

El esquema SQL es una referencia del repositorio; no demuestra por sí mismo que producción tenga exactamente las mismas columnas, restricciones o políticas. Confirmar diferencias antes de proponer migraciones.

## Flujos principales

- **OAuth:** `/login/:persona` → Spotify → `/callback` → perfil/token cifrado en `usuarios_spotify`.
- **Recolección:** ciclos del servidor consultan currently-playing y recently-played y actualizan catálogo, snapshot e historial.
- **Dashboard:** `public/app.js` consume `/api/currently-playing`, `/api/usuarios`, `/api/charts`, `/api/historial-item`, `/api/music-match` y `/api/records`.
- **Actividad:** `/api/activity` deriva calendario, mapa horario, rachas, primeros registros y coincidencias del dúo desde `reproducciones` y el catálogo.
- **Estado de servicio:** `/health` comprueba conexión a PostgreSQL y devuelve 200 o 503.

## Hallazgos de la línea base

- La interfaz ya dispone de las capacidades analíticas descritas arriba; Fases 5 y 6 las amplían sin sustituirlas.
- La búsqueda se aplica dentro del tipo de ranking seleccionado: título/artista/álbum en canciones, nombre/artista en álbumes y nombre en artistas.
- El frontend genera parte del HTML con `innerHTML`; cualquier texto llegado desde datos debe tratarse como no confiable antes de insertarse como markup.
- Las etiquetas de interfaz mezclan español e inglés. Se preserva el idioma visual existente durante esta actualización.
- Existe `.env.example` con placeholders; `.env` está ignorado por Git. Para uso local, `DATABASE_URL` debe apuntar a una conexión accesible desde el equipo y el secreto no debe compartirse ni incluirse en el commit.
- Los tests de integración de ranking/records pueden borrar tablas de la base configurada en `TEST_DATABASE_URL`; nunca apuntar esa variable a producción.

## Mejoras de Fases 5 y 6

### Visual y experiencia

- Reforzar jerarquía, contraste, enfoque de teclado y adaptación móvil.
- Alinear las tarjetas de estado actual, match, insights y charts con una misma escala visual.
- Mejorar estados de carga, interacción, foco visible y movimiento reducido sin cambiar las métricas ni sus criterios.
- Mantener la paleta original y mejorar legibilidad, contraste, espaciado y adaptación móvil.

### Función añadida

- Exportar a CSV el ranking con el tipo, período, cuenta/alcance y búsqueda seleccionados.
- Solicitar el ranking filtrado en una consulta acotada de hasta 5001 filas; el archivo incluye un máximo de 5000 y avisa si hay más. No se crea una tabla ni se altera el historial.
- Generar el archivo localmente en el navegador, con protección contra fórmulas de hoja de cálculo y valores con separadores/comillas.
- Recordar localmente la vista, el período y la cuenta seleccionados; no se envían preferencias a Spotify ni a la base de datos.
- Escapar textos dinámicos y limitar URLs de imágenes a HTTP(S) antes de insertarlos en el HTML.
- Añadir un diario musical de solo lectura: calendario mensual seleccionable, mapa de día/hora, rachas históricas por cuenta y coincidencias del dúo.
- Mantener el diario compartido en Overview; mantener Songs, Artists y Albums centrados en sus rankings; añadir Perfil con resumen individual, tops históricos y recap PNG.
- Guardar el color de acento preferido por cuenta en el navegador, sin almacenar preferencias en Supabase.
- Mostrar descubrimientos como primer registro encontrado en el historial. No equivale necesariamente a la fecha real en que alguien descubrió una canción; la app no puede inferir reproducciones anteriores a su propio historial.
- Usar la misma `ZONA_HORARIA` global de la app para ambos usuarios, sin migrar timestamps ni introducir preferencias individuales.
- Las nuevas funciones no escriben ni eliminan datos, y no requieren cambios de esquema en Supabase.

## Pendientes fuera del alcance de estas fases

- Respaldo y restauración verificable de Supabase.
- Revisión/corrección de RLS, índices y políticas en producción.
- Borrado del esquema/tablas `diario`.
- Cambios en Railway, variables de entorno, región o plan.
- Cambios que modifiquen o eliminen registros de Spotify.
