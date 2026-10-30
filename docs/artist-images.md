# Renovación de fotos de artistas

La columna y el índice ya se aplicaron al proyecto de producción el 30 de octubre de 2026.
Para otros entornos, ejecutar en el SQL Editor de Supabase el archivo
`db/updates/artist-image-refresh.sql`. Es aditivo: añade una fecha de revisión y
un índice, sin borrar ni reemplazar fotos ni historial. El usuario de la app
necesita poder actualizar la nueva columna, igual que imagen_url.

Luego subir el código a GitHub para desplegar en Railway. El worker arranca al
iniciar el servidor y revisa como máximo cinco artistas cada cinco minutos.
Revisa el catálogo existente gradualmente; cada foto válida se renueva a los
siete días. Una respuesta sin foto o un fallo individual se reintenta al día
siguiente y conserva la URL anterior. HTTP 429 pausa según Retry-After (una hora si falta ese encabezado); 401/403
pausa un día. Las pausas de pendientes se guardan en la base de datos.

Los mensajes `[foto artista ...] HTTP 403`, `HTTP 401` o `HTTP 429` identifican
restricciones de acceso, autorización o cuota respectivamente. No incluyen tokens.
Los logs de producción del 30 de octubre confirmaron HTTP 429 / QUOTA_EXCEEDED.
Se espacian las peticiones del lote por 300 ms y se registra el próximo intento.

Para priorizar las siete fotos solicitadas, después de añadir la columna:

```sql
UPDATE public.artistas
SET imagen_revisar_en = now() - interval '1 day'
WHERE lower(nombre) IN ('yves','evan','lngshot','woodz','ive','xg','riize');
```

Las filas aún sin fecha se procesan primero. Comprobar después del despliegue:

```sql
SELECT nombre, imagen_url, imagen_revisar_en
FROM public.artistas
WHERE lower(nombre) IN ('yves','evan','lngshot','woodz','ive','xg','riize');
```

Una fecha futura indica cuándo se reintentará/revisará la imagen; los logs
permiten distinguir una respuesta válida de una pausa. No poner imagen_url a
NULL para forzar un refresco.

Usar una réplica de Railway: el bloqueo de solapamiento es por proceso.

Las fechas de álbumes con precisión de año/mes se normalizan al primer día del
período para almacenarlas en DATE. Por ejemplo, 2002 se guarda como 2002-01-01;
ese día representa precisión parcial, no una fecha exacta conocida.
