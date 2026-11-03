-- Credencial futura: sin LOGIN y sin contraseña. No sustituye DATABASE_URL.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='duo_runtime') THEN
    CREATE ROLE duo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public,app_private TO duo_runtime;
GRANT SELECT,INSERT,UPDATE ON public.usuarios_spotify,public.artistas,public.albumes,
  public.canciones,public.cancion_artistas,public.reproducciones,public.reproduccion_actual TO duo_runtime;
GRANT DELETE ON public.reproduccion_actual TO duo_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON app_private.runtime TO duo_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO duo_runtime;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios_spotify','artistas','albumes','canciones','cancion_artistas','reproducciones','reproduccion_actual'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='duo_server') THEN
      EXECUTE format('CREATE POLICY duo_server ON public.%I FOR ALL TO duo_runtime USING(true) WITH CHECK(true)',t);
    END IF;
  END LOOP;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='app_private' AND tablename='runtime' AND policyname='duo_runtime_server') THEN
    CREATE POLICY duo_runtime_server ON app_private.runtime FOR ALL TO duo_runtime USING(true) WITH CHECK(true);
  END IF;
END $$;
COMMIT;
