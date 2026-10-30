# Duo Charts

**Dos cuentas de Spotify, una historia musical compartida.**

Duo Charts es una aplicación personal que reúne las escuchas de dos personas en un mismo lugar. Muestra qué está sonando, conserva un historial propio y transforma las reproducciones en rankings, tendencias y estadísticas para descubrir tanto los gustos individuales como las coincidencias del dúo.

[Visitar Duo Charts](https://spotify-duo-charts-production.up.railway.app)

## Qué puedes ver

### Overview · La música del dúo

La vista principal combina la actividad en vivo con una mirada conjunta al historial:

- **Sonando ahora:** la canción que reproduce cada cuenta, con su artista y portada.
- **Music Match:** afinidad basada en los artistas compartidos, canciones en común y balance de escuchas entre ambas personas.
- **Hábitos y destacados:** patrones de escucha y favoritos del período.
- **Mapa de escucha:** actividad por días y horas para reconocer cuándo hay más música. Es un mapa de hábitos, no de ubicaciones.
- **Calendario mensual:** reproducciones por día y detalle de la canción más escuchada.
- **Descubrimientos:** canciones y artistas que aparecen por primera vez en el historial registrado.
- **Estadísticas del dúo:** días de actividad compartida y coincidencias musicales del mes.

### Songs, Artists y Albums · Los rankings

Tres vistas dedicadas a los tops de canciones, artistas y álbumes. Cada ranking permite consultar el total conjunto o una cuenta en particular, cambiar entre hoy, siete días, treinta días y todo el historial, y comparar posiciones con el período anterior.

La búsqueda encuentra canciones, artistas y álbumes del catálogo registrado. Los rankings también se pueden exportar en CSV.

### Perfil · Tu espacio personal

Cada persona tiene una vista con su racha actual, su mejor racha, los días con música y sus canciones, artistas y álbumes favoritos de todo el historial.

El perfil incluye una **tarjeta recap descargable como imagen**, con destacados de las escuchas recientes, cambios frente al período anterior y primeros registros. El color de acento se puede personalizar; el rojo es el predeterminado y la elección se guarda en el navegador.

## Cómo funciona

Las cuentas se vinculan mediante la autorización de Spotify. El servidor consulta la reproducción actual aproximadamente cada veinte segundos y recupera las últimas escuchas cada cinco minutos.

Los rankings se calculan a partir del historial de reproducciones que devuelve Spotify, con sus fechas originales. La vista de reproducción actual alimenta el widget en vivo: una canción no se cuenta repetidamente por seguir apareciendo en pantalla. La base de datos evita guardar dos veces la misma reproducción.

El catálogo relaciona canciones, álbumes y artistas, incluidos los colaboradores de cada canción. Las fotos de artistas se revisan por lotes pequeños y se programan para renovarse cada siete días. Si Spotify no responde o limita las solicitudes, se conserva la imagen anterior y se aplaza el siguiente intento.

## Sobre las estadísticas

Los datos representan **las escuchas que la aplicación ha podido registrar**, no necesariamente toda la actividad de una cuenta desde que se creó. La API de Spotify ofrece un historial reciente limitado; una interrupción prolongada puede dejar escuchas fuera del registro.

Por la misma razón, un «descubrimiento» significa la primera aparición en este historial, y «todo el tiempo» abarca los datos conservados por Duo Charts. El mapa, el calendario y las estadísticas horarias usan la zona horaria configurada para el dúo, actualmente Panamá.

Duo Charts es una herramienta de seguimiento y visualización: no reproduce música ni controla el reproductor de Spotify.

## Tecnología

| Parte | Tecnología |
| --- | --- |
| Interfaz | HTML, CSS y JavaScript |
| Servidor y API | Node.js y Express |
| Datos musicales | Spotify Web API |
| Base de datos | PostgreSQL en Supabase |
| Alojamiento | Railway |
| Seguimiento de errores | Sentry |

La interfaz consulta la API de la aplicación, mientras el servidor mantiene la conexión con Spotify y guarda el historial en PostgreSQL. Los tokens de las cuentas se almacenan cifrados. Una API de integración protegida permite compartir estadísticas de artistas con otras aplicaciones relacionadas.

---

Proyecto personal e independiente. No está afiliado a Spotify ni respaldado por Spotify.
