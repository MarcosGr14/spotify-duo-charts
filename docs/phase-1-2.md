# Fiabilidad y seguridad

## Estado comprobado el 3 de noviembre de 2026

- Respaldos reales creados y restaurados en PostgreSQL aislado, con conteos y tokens verificados.
- Estado de sincronización aplicado en Supabase; las dos cuentas sincronizaron con éxito, cero elementos fallidos.
- Railway y la conexión local usan duo_runtime, con LOGIN y nueva contraseña establecidos por el propietario.
- BACKUP_DATABASE_URL, ENCRYPTION_KEY y BACKUP_PASSPHRASE configurados como secretos del repositorio.
- 81 pruebas pasaron con PostgreSQL real; smoke de interfaz, assets, health y API correcto.
- npm audit --omit=dev: cero vulnerabilidades conocidas. Persisten avisos de desarrollo en dependencias de Jest; no se aplicó una bajada de versión forzada.
- Código desplegado y CI correcto. Primer workflow de respaldo y restauración completado correctamente.
- Contraseña administrativa rotada por el propietario; respaldo GitHub y conexión local actualizados y comprobados.
- SSL enforcement global activado y comprobado; el propietario confirmó que solo se conectan Spotify Charts y los respaldos.


## Cambios incluidos

- Estado OAuth aleatorio, ligado mediante cookie HttpOnly al navegador, caducidad de diez minutos y consumo atómico de un solo uso en `app_private.runtime`.
- Solo se pueden reconectar las cuentas existentes. Las nuevas requieren su ID explícito en `SPOTIFY_ALLOWED_USER_IDS`. No se usan etiquetas de URL como autorización.
- Renovación de tokens agrupada por cuenta; solo `invalid_grant` exige reconexión. Timeout y límites temporales conservan las credenciales.
- Todas las solicitudes a Spotify pasan por una cola con timeout de diez segundos y pausa 429 persistente. Si falta Retry-After: una hora para límites temporales, un día para QUOTA_EXCEEDED.
- El historial conserva prioridad. Los ciclos no se solapan consigo mismos; la reproducción actual se consulta solo con visitantes recientes. Se mantiene la captura de historial sin visitas.
- Cada elemento se importa de forma independiente; errores parciales quedan contados y se reintentan con la ventana reciente. Los duplicados siguen protegidos por el índice único existente.
- Cada cuenta registra intentos, éxito completo, fallos de elementos y posibles huecos. Un hueco es una advertencia, no una recuperación inventada.
- Las fotos se mantienen ante errores; se renuevan por lotes y respetan la pausa compartida.
- Cabeceras de seguridad, límites de solicitudes, callback sin interpolaciones inseguras y health público sin detalles internos.
- El modo `SITE_VISIBILITY=public` conserva el acceso actual. `private` exige Basic Auth sobre HTTPS (usuario `duo` y `SITE_PASSWORD`, mínimo 20 caracteres); protege frontend y API. Las integraciones mantienen su token propio.
- AES-GCM con tag de 128 bits y prefijo de versión para tokens nuevos. Se leen cifrados anteriores y tokens antiguos reconocibles; nunca se rota automáticamente la clave existente.

## Respaldo y recuperación

`npm run backup` crea un respaldo consistente de los esquemas de Spotify (`public` y `app_private`), con snapshot compartido para los conteos y pg_dump. No respalda Auth/Storage de Supabase ni el esquema ajeno diario.

El paquete incluye el dump, conteos, hash y ENCRYPTION_KEY. Está cifrado con AES-256-GCM y clave derivada de una contraseña independiente mediante scrypt. No imprime secretos ni guarda SQL plano permanente.

`npm run backup:verify -- archivo.duobak` restaura en una base local vacía llamada `duo_restore_test`, comprueba conteos y descifrado de tokens. Rechaza la URL de producción y destinos externos; no borra una base existente. Usa RESTORE_TEST_DATABASE_URL.

La contraseña independiente local se guarda con permisos 600 en `~/.local/share/duo-charts-recovery/backup-passphrase`. Conservar una copia segura fuera de esta máquina: sin esa contraseña no se puede recuperar el respaldo.

El workflow `.github/workflows/backup.yml` realiza respaldo diario a las 03:15 de Panamá y restauración de prueba en PostgreSQL aislado. Guarda únicamente el paquete cifrado en GitHub Actions durante 30 días. Requiere secretos BACKUP_DATABASE_URL (pooler de sesión, no transacción), ENCRYPTION_KEY actual y BACKUP_PASSPHRASE. Un fallo de backup o restauración hace fallar el job.

Una programación en GitHub solo está activa después de subir el workflow a la rama principal y configurar sus secretos. La retención de Actions no es un archivo permanente ni una garantía de ejecución exacta.

## Orden de publicación

1. Tener un respaldo comprobado.
2. Aplicar `node scripts/apply-phase12.js` con una conexión de administración. Solo añade estado, columnas e índices; no borra historial ni cambia tokens.
3. Desplegar el código con una réplica y comprobar /health y el avance de sincronización.
4. Verificar el workflow de respaldo ejecutándolo manualmente y revisar su resultado.

Cambiar una contraseña previamente expuesta requiere actualizar DATABASE_URL en los entornos que la usan. No consta como completado por el mero hecho de introducir estas protecciones. Mantener ENCRYPTION_KEY: cambiarla sin recifrar los tokens impediría leerlos.

## Permisos mínimos de PostgreSQL

Preparar una credencial exclusiva de la aplicación, sin ser propietaria de la base. Permisos necesarios: USAGE en public/app_private; SELECT/INSERT/UPDATE en las siete tablas de Spotify; DELETE solo en reproduccion_actual y app_private.runtime; USAGE/SELECT en secuencias y SELECT/INSERT/UPDATE/DELETE en runtime. No necesita DROP/ALTER ni acceso a diario. Las tablas de public deben conservar RLS y una política dirigida exclusivamente al rol interno de la aplicación si ese rol no tiene BYPASSRLS.

La creación y adopción de esa credencial se debe realizar junto con la rotación de DATABASE_URL; el código no cambia silenciosamente las credenciales existentes ni activa políticas públicas.

## TLS de PostgreSQL

Se detectó que la conexión previa no usaba TLS. Para hosts Supabase, el servidor,
los cambios de esquema y el respaldo ahora exigen cifrado, verifican el hostname
y confían en la CA oficial de Supabase incluida en `db/certs/supabase-ca.crt`.
Se comprobó esta conexión contra el proyecto real. No se usa rejectUnauthorized=false.
La CA pública procede de https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt.
Revisar su vigencia cuando Supabase anuncie una rotación de certificados.

Con el pooler, pg_stat_ssl describe el tramo pooler→PostgreSQL, no el cliente→pooler.
La verificación local del cliente usa stream.encrypted y stream.authorized.
El tramo interno también está cifrado tras activar SSL enforcement en Supabase.

## Compatibilidad de despliegue

El lector nuevo acepta el cifrado anterior y enc:v1. Si se revierte a una versión
antigua que no reconozca ese prefijo, antes de usarla se puede retirar únicamente
el prefijo de access_token/refresh_token con substring(... FROM 8) donde LIKE
'enc:v1:%'. No cambiar ENCRYPTION_KEY ni descifrar los valores: el contenido cifrado
es exactamente el mismo. Hacer respaldo antes de cualquier reversión.

## Verificación de producción

- CI del commit 7a74ad9 correcto: https://github.com/MarcosGr14/spotify-duo-charts/actions/runs/41692657740.
- Railway desplegado y /health devuelve 200 con la base conectada.
- Las siete fotos solicitadas tienen URLs nuevas respecto a las originales.
- SSL obligatorio activado; conexión del cliente validada y pg_stat_ssl=true.
- duo_runtime probado bajo RLS: permite registrar y consultar escuchas, sin borrar historial ni acceder a diario.
- Railway y la conexión local utilizan duo_runtime.
- Contraseña administrativa rotada por el propietario; secreto de GitHub actualizado mediante scripts/update-connections.js.
- Respaldo, restauración aislada y subida del archivo cifrado comprobados con la nueva credencial: https://github.com/MarcosGr14/spotify-duo-charts/actions/runs/41697401603.
- Programación diaria a las 03:15 de Panamá, con retención de 30 días.

## Actualización de conexiones

El asistente `node scripts/update-connections.js` solicita las dos contraseñas sin
mostrarlas. Codifica los símbolos para URL, comprueba el acceso por TLS y el rol
de cada conexión antes de guardar DATABASE_URL y BACKUP_DATABASE_URL en .env.
Después actualiza únicamente el secreto BACKUP_DATABASE_URL del repositorio.
No imprime contraseñas ni modifica la conexión desplegada en Railway.
