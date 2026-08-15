# Spotify Charts Tracker

Backend que conecta dos cuentas de Spotify independientes, registra en tiempo
real qué escuchan, y guarda el historial real para armar charts individuales
y combinados (con tendencias de sube/baja).

## 1. Configurar la app en Spotify

1. Andá a https://developer.spotify.com/dashboard y creá una app.
   (Necesitás que la cuenta que crea la app tenga Spotify Premium — Spotify
   lo exige desde 2026 para poder registrar apps nuevas.)
2. En "Redirect URIs" agregá exactamente: `http://127.0.0.1:3000/callback`
   — **NO uses `localhost`**, Spotify ya no lo acepta desde noviembre 2025,
   tiene que ser la IP literal `127.0.0.1`.
3. En "Users and Access" (modo Development) agregá el email de la segunda
   cuenta de Spotify (la de tu compañera/o), o no va a poder loguearse.
4. Copiá el Client ID y el Client Secret.

## 2. Configurar variables de entorno

```
cp .env.example .env
```

Completá `.env` con tu Client ID, Client Secret, y la URL de tu base de
datos Postgres (podés usar Supabase gratis para esto).

## 3. Crear la base de datos

```
psql "$DATABASE_URL" -f db/schema.sql
```

## 4. Instalar dependencias y correr

```
npm install
npm start
```

## 5. Conectar las dos cuentas

- Abrí `http://127.0.0.1:3000/login/marcos` con tu cuenta
- Abrí `http://127.0.0.1:3000/login/jackie` con la otra cuenta (o el nombre
  que quieras usar en la URL — es solo una etiqueta, no afecta la lógica)

**Importante:** usá siempre `127.0.0.1` en el navegador, no `localhost` —
aunque las dos apunten a tu máquina, para Spotify son hosts distintos y
si no coinciden con el redirect_uri registrado te va a tirar error.

A partir de ahí el servidor arranca solo dos ciclos:
- Cada 20s consulta "currently-playing" de ambas cuentas (para un widget en vivo)
- Cada 5 min trae el historial real ("recently-played") y lo guarda en la
  tabla `reproducciones`, que es de donde salen los rankings y charts.

## 6. Ver el dashboard

Con el servidor corriendo, simplemente abrí en el navegador:

```
http://127.0.0.1:5000/
```

(cambiá el puerto si usás otro). Vas a ver:
- Arriba, un "ticker" con lo que está sonando ahora mismo en cada cuenta (se actualiza cada 20s)
- Abajo, el ranking — con tabs para alternar entre el chart **global** (combinando ambas cuentas) y el **individual** de cada quien, más un selector de ventana de tiempo (hoy / 7 días / 30 días)
- Cada canción muestra cuántas veces sonó y una flecha ▲/▼ comparando contra el período anterior

## Estructura

```
src/
  config.js       variables de entorno centralizadas
  db.js           pool de conexión a Postgres
  spotifyAuth.js  login OAuth + refresh de tokens
  catalog.js      evita duplicar canciones/artistas/álbumes
  poller.js       lógica de consulta a la API de Spotify
  chartsApi.js    endpoints /api/currently-playing, /api/charts, /api/usuarios
  index.js        arranca servidor + schedulers
public/
  index.html      dashboard
  style.css       identidad visual cyberpunk cian/magenta
  app.js          consume la API y renderiza en vivo
db/
  schema.sql      esquema completo de la base de datos
```
