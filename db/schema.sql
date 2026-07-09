-- =====================================================================
--  Tablero de Control de Proyectos — Esquema de base de datos
--  Creativos Tecnológicos IT
--  PostgreSQL 13+
--
--  Aplicar:  psql -d tablero -f db/schema.sql
--  (o vía  npm run migrate)
-- =====================================================================

-- Extensiones ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- correo case-insensitive

-- Tipos enumerados ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE rol_global      AS ENUM ('super_admin','lider','colaborador','visor','cliente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rol_proyecto    AS ENUM ('lider','colaborador','visor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_proyecto AS ENUM ('activo','en_pausa','cerrado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_hito       AS ENUM ('interno','cliente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_hito      AS ENUM ('pendiente','en_progreso','en_riesgo','cumplido','incumplido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_actividad AS ENUM ('sin_iniciar','en_progreso','en_revision','bloqueado','completo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_evidencia   AS ENUM ('archivo','enlace','nota');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Función: mantener actualizado_en ------------------------------------
CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
--  USUARIO
-- =====================================================================
CREATE TABLE IF NOT EXISTS usuario (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text        NOT NULL,
  email          citext      NOT NULL UNIQUE,
  password_hash  text        NOT NULL,
  rol_global     rol_global  NOT NULL DEFAULT 'colaborador',
  activo         boolean     NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  eliminado_en   timestamptz
);
DROP TRIGGER IF EXISTS trg_usuario_upd ON usuario;
CREATE TRIGGER trg_usuario_upd BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
--  CLIENTE  (externo)
-- =====================================================================
CREATE TABLE IF NOT EXISTS cliente (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa        text        NOT NULL,
  contacto_nombre text,
  contacto_email  citext,
  telefono       text,
  notas          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  eliminado_en   timestamptz
);
DROP TRIGGER IF EXISTS trg_cliente_upd ON cliente;
CREATE TRIGGER trg_cliente_upd BEFORE UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
--  PROYECTO   (cliente_id NULL = proyecto interno)
-- =====================================================================
CREATE TABLE IF NOT EXISTS proyecto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           text            NOT NULL,
  descripcion      text,
  cliente_id       uuid            REFERENCES cliente(id) ON DELETE SET NULL,
  lider_id         uuid            REFERENCES usuario(id) ON DELETE SET NULL,
  estado           estado_proyecto NOT NULL DEFAULT 'activo',
  fecha_inicio     date,
  fecha_fin_estimada date,
  creado_por       uuid            REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en        timestamptz     NOT NULL DEFAULT now(),
  actualizado_en   timestamptz     NOT NULL DEFAULT now(),
  eliminado_en     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_proyecto_cliente ON proyecto(cliente_id);
CREATE INDEX IF NOT EXISTS idx_proyecto_lider   ON proyecto(lider_id);
DROP TRIGGER IF EXISTS trg_proyecto_upd ON proyecto;
CREATE TRIGGER trg_proyecto_upd BEFORE UPDATE ON proyecto
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
--  MIEMBRO_PROYECTO   (rol con alcance por proyecto — RBAC)
-- =====================================================================
CREATE TABLE IF NOT EXISTS miembro_proyecto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid         NOT NULL REFERENCES usuario(id)  ON DELETE CASCADE,
  proyecto_id  uuid         NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  rol_proyecto rol_proyecto NOT NULL DEFAULT 'colaborador',
  creado_en    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, proyecto_id)
);
CREATE INDEX IF NOT EXISTS idx_miembro_proyecto ON miembro_proyecto(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_miembro_usuario  ON miembro_proyecto(usuario_id);

-- =====================================================================
--  HITO   (interno vs. compromiso con cliente)
-- =====================================================================
CREATE TABLE IF NOT EXISTS hito (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id           uuid        NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  nombre                text        NOT NULL,
  descripcion           text,
  tipo                  tipo_hito   NOT NULL DEFAULT 'interno',
  estado                estado_hito NOT NULL DEFAULT 'pendiente',
  fecha_objetivo_interna date,       -- fecha del equipo (con colchón)
  fecha_compromiso      date,        -- fecha real comprometida con el cliente
  visible_cliente       boolean     NOT NULL DEFAULT false,
  requiere_evidencia    boolean     NOT NULL DEFAULT false,
  aprobado_por          uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  aprobado_en           timestamptz,
  creado_por            uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  eliminado_en          timestamptz,
  -- un hito de cliente exige fecha de compromiso
  CONSTRAINT hito_compromiso_chk CHECK (tipo <> 'cliente' OR fecha_compromiso IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_hito_proyecto ON hito(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_hito_estado   ON hito(estado);
DROP TRIGGER IF EXISTS trg_hito_upd ON hito;
CREATE TRIGGER trg_hito_upd BEFORE UPDATE ON hito
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
--  ACTIVIDAD   (trabajo diario; rueda hacia el hito)
-- =====================================================================
CREATE TABLE IF NOT EXISTS actividad (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id    uuid             NOT NULL REFERENCES proyecto(id) ON DELETE CASCADE,
  hito_id        uuid             REFERENCES hito(id) ON DELETE SET NULL,
  titulo         text             NOT NULL,
  descripcion    text,
  producto       text,            -- entregable
  responsable_id uuid             REFERENCES usuario(id) ON DELETE SET NULL,
  estado         estado_actividad NOT NULL DEFAULT 'sin_iniciar',
  avance         smallint         NOT NULL DEFAULT 0,
  prioridad      smallint         NOT NULL DEFAULT 2,   -- 1 alta, 2 media, 3 baja
  fecha_inicio   date,
  fecha_fin      date,
  creado_por     uuid             REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en      timestamptz      NOT NULL DEFAULT now(),
  actualizado_en timestamptz      NOT NULL DEFAULT now(),
  eliminado_en   timestamptz,
  CONSTRAINT actividad_avance_chk    CHECK (avance BETWEEN 0 AND 100),
  CONSTRAINT actividad_prioridad_chk CHECK (prioridad BETWEEN 1 AND 3),
  CONSTRAINT actividad_fechas_chk    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_actividad_proyecto    ON actividad(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_actividad_hito        ON actividad(hito_id);
CREATE INDEX IF NOT EXISTS idx_actividad_responsable ON actividad(responsable_id);
CREATE INDEX IF NOT EXISTS idx_actividad_estado      ON actividad(estado);
DROP TRIGGER IF EXISTS trg_actividad_upd ON actividad;
CREATE TRIGGER trg_actividad_upd BEFORE UPDATE ON actividad
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- =====================================================================
--  COMENTARIO   (contexto vive con el trabajo)
-- =====================================================================
CREATE TABLE IF NOT EXISTS comentario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id uuid        NOT NULL REFERENCES actividad(id) ON DELETE CASCADE,
  autor_id     uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  texto        text        NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comentario_actividad ON comentario(actividad_id);

-- =====================================================================
--  EVIDENCIA   (prueba de cumplimiento — obligatoria en hitos de cliente)
-- =====================================================================
CREATE TABLE IF NOT EXISTS evidencia (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hito_id      uuid           REFERENCES hito(id) ON DELETE CASCADE,
  actividad_id uuid           REFERENCES actividad(id) ON DELETE CASCADE,
  tipo         tipo_evidencia NOT NULL DEFAULT 'enlace',
  url          text,
  descripcion  text,
  subido_por   uuid           REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en    timestamptz    NOT NULL DEFAULT now(),
  -- debe adjuntarse a un hito o a una actividad
  CONSTRAINT evidencia_destino_chk CHECK (hito_id IS NOT NULL OR actividad_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_evidencia_hito      ON evidencia(hito_id);
CREATE INDEX IF NOT EXISTS idx_evidencia_actividad ON evidencia(actividad_id);

-- =====================================================================
--  BITACORA   (auditoría — no se borra)
-- =====================================================================
CREATE TABLE IF NOT EXISTS bitacora (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  entidad    text        NOT NULL,   -- 'proyecto' | 'hito' | 'actividad' | ...
  entidad_id uuid,
  accion     text        NOT NULL,   -- 'crear' | 'actualizar' | 'eliminar' | 'aprobar' | ...
  detalle    jsonb,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bitacora_entidad ON bitacora(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha   ON bitacora(creado_en DESC);

-- =====================================================================
--  NOTIFICACION   (alertas de riesgo / vencimiento)
-- =====================================================================
CREATE TABLE IF NOT EXISTS notificacion (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid        NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo       text        NOT NULL,
  mensaje    text        NOT NULL,
  entidad    text,
  entidad_id uuid,
  leida      boolean     NOT NULL DEFAULT false,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notificacion_usuario ON notificacion(usuario_id, leida);

-- =====================================================================
--  VISTA: estado de hito derivado del avance de sus actividades
--  (apoyo para "gestión por excepción" del super admin)
-- =====================================================================
CREATE OR REPLACE VIEW v_hito_resumen AS
SELECT
  h.id,
  h.proyecto_id,
  h.nombre,
  h.tipo,
  h.estado,
  h.fecha_compromiso,
  COUNT(a.id)                                        AS total_actividades,
  COUNT(a.id) FILTER (WHERE a.estado = 'completo')   AS actividades_completas,
  COUNT(a.id) FILTER (WHERE a.estado = 'bloqueado')  AS actividades_bloqueadas,
  COALESCE(ROUND(AVG(a.avance)), 0)                  AS avance_promedio
FROM hito h
LEFT JOIN actividad a
  ON a.hito_id = h.id AND a.eliminado_en IS NULL
WHERE h.eliminado_en IS NULL
GROUP BY h.id;
