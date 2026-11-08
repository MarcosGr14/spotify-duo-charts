# Duo Charts instalable

La PWA utiliza la misma web y el mismo servidor de Spotify Charts. Instalarla es opcional; el acceso desde el navegador sigue disponible. No hay una base de datos nueva, sincronización paralela ni suscripción adicional.

## Instalar

Después de publicar esta versión por HTTPS:

- **Android / Chrome:** abre la web y despliega «Instalar Duo Charts», al final de la página. Si aparece «Instalar app», púlsalo y confirma en Chrome. También puedes usar el menú de los tres puntos → «Instalar aplicación» o «Añadir a pantalla de inicio».
- **iPhone / Safari:** abre la web en Safari → Compartir → «Añadir a pantalla de inicio». Activa «Abrir como app web» si aparece y pulsa «Añadir».
- **Computadora:** puedes seguir usando la pestaña habitual. En navegadores compatibles también aparecerá la opción de instalar.

Cancelar no afecta a la web. El botón nativo solo aparece cuando el navegador ofrece la instalación; su disponibilidad depende de la plataforma y de sus criterios. No se abre automáticamente. Dentro de la app instalada, la sección muestra que ya está instalada.

Se conservan las cuentas y los datos del servidor. Los navegadores y las apps instaladas pueden aislar sus sesiones o almacenamiento local: podría ser necesario introducir de nuevo el acceso privado y elegir otra vez el color del perfil. No se copian ni exportan credenciales al instalar.

## Sin conexión

Las escuchas, los rankings y las estadísticas **requieren internet**. Al abrir una página sin conexión, el worker muestra una pantalla pública con «Volver a intentar». No guarda datos musicales, tokens, sesiones, HTML de la aplicación ni respuestas autenticadas. El primer acceso necesita red para instalar el worker.

Las API, OAuth, login, health, peticiones no GET y otros orígenes quedan fuera del worker. Solo se almacenan recursos estáticos conocidos con hash, obtenidos sin credenciales y con cabeceras públicas/inmutables, además del fallback público generado. Las respuestas privadas, redirigidas o no-store no se guardan. La autenticación y la CSP existentes se mantienen.

## Publicación y mantenimiento

- Publicar por HTTPS y ejecutar con `NODE_ENV=production`. El registro se habilita únicamente en ese entorno. No hacen falta paquetes adicionales ni un comando de compilación nuevo.
- El manifiesto tiene identificador `/`, inicio `/` y alcance `/`, correspondientes al despliegue actual en la raíz del dominio. Mantener ese identificador. Mover la app a otro dominio o subdirectorio requiere revisar rutas y alcance; no basta con mover archivos.
- `src/pwa.js` genera la versión a partir del contenido del HTML, JS, CSS, iconos, worker y revisión de Railway si existe. Cada cambio genera URLs estáticas nuevas y una caché versionada `duo-charts-pwa-*`. No editar versiones a mano.
- HTML, manifiesto, configuración y `/sw.js` se sirven con `Cache-Control: no-store`. Los recursos con hash son inmutables. Si se añade un proxy/CDN, debe respetar esas cabeceras y el modo privado.
- Al publicar, la app detecta el worker nuevo en las siguientes visitas, al regresar a una pestaña tras un minuto o durante la comprobación horaria. Si sigue abierta aparece «Actualizar cuando esté listo». La recarga requiere pulsar ese botón; otras pestañas no se recargan automáticamente.
- Un formulario modificado, un campo en edición o un guardado marcado `aria-busy="true"` bloquea la recarga. Si se añaden formularios, tras guardar deben emitir `duo:form-saved` desde el formulario, o con `detail.form`, para confirmar que sus cambios ya están guardados. Restablecer un formulario solo limpia el estado de ese formulario.
- El worker nuevo limpia exclusivamente cachés antiguas del proyecto. En desarrollo se retiran únicamente registros `/sw.js?app=duo-charts` del propio origen y cachés con ese prefijo. Nunca se borran cookies, localStorage, IndexedDB ni datos de otras aplicaciones.
- Los PNG de `public/pwa-icons/` se derivan del símbolo actual de la cabecera. Se incluyen las fuentes SVG. El icono maskable tiene fondo opaco y margen para recortes; los tamaños son 192, 512 y 180 px para Apple. Regenerarlos solo si cambia la marca.

## Comprobación local aislada

`npm run preview:pwa` inicia la vista previa en `http://127.0.0.1:55932`. No carga `.env`, ni los módulos de base de datos o polling. Usa dos cuentas ficticias y rankings simulados. Las secciones analíticas sin fixture muestran un aviso; no es un fallo del servidor real.

La vista previa habilita el registro de producción sobre el contexto seguro de localhost. Sus botones de prueba permiten comprobar el worker, forzar temas para revisar el diseño, simular cancelación/doble toque, generar una build local nueva y cortar la navegación. Esos controles y endpoints no se montan en producción.

Si activas «Simular pérdida de conexión», la navegación local queda desconectada hasta reiniciar la vista previa o enviar un POST local a `/__pwa-test/network/online`. Pulsa «Volver a intentar» después de recuperar la red. Estos controles simulan fallos de red; no apagan la conexión del equipo.

Pruebas automáticas: `npm test`. Las pruebas de PostgreSQL requieren `TEST_DATABASE_URL` apuntando a una base local descartable. Nunca usar la conexión real para pruebas.

## Validación realizada y límites

- Suite completa con PostgreSQL local aislado: manifiesto, tamaños PNG, cabeceras, política de acceso privado, instalación aceptada/cancelada, AbortError, doble toque, modo instalado, desarrollo, caché, exclusiones, actualización y protección de formularios.
- Navegador Chromium local: worker real activo, actualización esperando sin recarga, activación tras pulsar el botón, limpieza de cachés antiguas, API ausente de caché, pantalla sin conexión y recuperación de la web.
- Anchos 320, 390, 768 y 1440 px en claro y oscuro, con temas forzados por el fixture local: sin desbordamiento horizontal; `theme-color` coincide con el fondo. Se corrigió el ancho mínimo del podio y el contraste de texto sobre acentos. Las instrucciones de instalación se revisaron en móvil.
- El diálogo de instalación se probó mediante eventos simulados; no se completó una instalación nativa del sistema operativo. El modo standalone y la cancelación se cubrieron con pruebas automatizadas.
- No se probó en teléfonos físicos, Safari real ni una PWA publicada. Tras publicar, comprobar instalación/desinstalación, notch y barra de inicio, teclado abierto, giro de pantalla, zoom, modo privado, cambio de tema del sistema y una actualización con la app instalada en Android y iPhone. Las capturas de un viewport no verifican gestos ni teclado nativo.
- No se añadieron dependencias. La validación se realizó localmente, sin operar contra servicios reales.
