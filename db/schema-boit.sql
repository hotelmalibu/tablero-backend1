-- =====================================================================
--  BOIT · Back Office Inteligente — Esquema del portal de servicios
--  Creativos Tecnológicos IT · se aplica DESPUÉS de db/schema.sql
--  Todo es idempotente: se puede correr en cada despliegue sin dañar datos.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. ROLES NUEVOS
--  Ya existían: super_admin, lider, colaborador, visor, cliente
--  Se agregan:  gestor (gestor de proyectos) e investigador (pasante técnico)
-- ---------------------------------------------------------------------
ALTER TYPE rol_global ADD VALUE IF NOT EXISTS 'gestor';
ALTER TYPE rol_global ADD VALUE IF NOT EXISTS 'investigador';

-- ---------------------------------------------------------------------
--  2. CATÁLOGO DE SERVICIOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text        NOT NULL UNIQUE,
  nombre           text        NOT NULL,
  categoria        text        NOT NULL,   -- investigacion | emprendimiento | cultural | social | ambiental | hidrico | negocio | mercado | riesgo | contable | juridico
  resumen          text,
  descripcion      text,
  incluye          jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- ["Diagnóstico", "Documento final", ...]
  precio_desde_usd numeric(12,2) NOT NULL DEFAULT 0,
  dias_entrega     smallint    NOT NULL DEFAULT 10,
  icono            text,
  destacado        boolean     NOT NULL DEFAULT false,
  activo           boolean     NOT NULL DEFAULT true,
  orden            smallint    NOT NULL DEFAULT 100,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_servicio_categoria ON servicio(categoria) WHERE activo;
DROP TRIGGER IF EXISTS trg_servicio_upd ON servicio;
CREATE TRIGGER trg_servicio_upd BEFORE UPDATE ON servicio
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ---------------------------------------------------------------------
--  3. PEDIDOS  (solicitudes de productos y servicios)
--  Flujo: nuevo → asignado → en_produccion → en_validacion → entregado
--         → pagado → cerrado   (o cancelado en cualquier punto)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE estado_pedido AS ENUM
    ('nuevo','asignado','en_produccion','en_validacion','entregado','pagado','cerrado','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pedido (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio          text          NOT NULL UNIQUE,      -- BOIT-2026-0001
  cliente_id     uuid          REFERENCES usuario(id) ON DELETE SET NULL,
  -- Datos de contacto (el cliente puede pedir sin tener cuenta)
  nombre         text          NOT NULL,
  entidad        text,
  correo         citext        NOT NULL,
  telefono       text,
  estado         estado_pedido NOT NULL DEFAULT 'nuevo',
  -- Asignación interna
  asignado_a     uuid          REFERENCES usuario(id) ON DELETE SET NULL,  -- gestor de proyecto
  apoyo_id       uuid          REFERENCES usuario(id) ON DELETE SET NULL,  -- joven investigador
  agente_virtual text,                                                     -- agente de IA usado
  -- Valores
  subtotal_usd   numeric(12,2) NOT NULL DEFAULT 0,
  iva_usd        numeric(12,2) NOT NULL DEFAULT 0,
  total_usd      numeric(12,2) NOT NULL DEFAULT 0,
  descripcion    text,
  notas_internas text,
  fecha_limite   date,
  entregado_en   timestamptz,
  creado_en      timestamptz   NOT NULL DEFAULT now(),
  actualizado_en timestamptz   NOT NULL DEFAULT now(),
  eliminado_en   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pedido_estado    ON pedido(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_cliente   ON pedido(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedido_asignado  ON pedido(asignado_a);
CREATE INDEX IF NOT EXISTS idx_pedido_correo    ON pedido(correo);
DROP TRIGGER IF EXISTS trg_pedido_upd ON pedido;
CREATE TRIGGER trg_pedido_upd BEFORE UPDATE ON pedido
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- Renglones del pedido
CREATE TABLE IF NOT EXISTS pedido_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid          NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  servicio_id      uuid          REFERENCES servicio(id) ON DELETE SET NULL,
  nombre_servicio  text          NOT NULL,   -- se congela el nombre al momento del pedido
  cantidad         smallint      NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unit_usd  numeric(12,2) NOT NULL DEFAULT 0,
  especificaciones text
);
CREATE INDEX IF NOT EXISTS idx_pedido_item_pedido ON pedido_item(pedido_id);

-- ---------------------------------------------------------------------
--  4. ENTREGABLES  (los documentos que produce el Back Office)
--  La descarga se habilita SOLO cuando el pedido está pagado.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entregable (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid        NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  nombre         text        NOT NULL,
  descripcion    text,
  url            text        NOT NULL,          -- ubicación del archivo (storage/enlace)
  tipo           text        NOT NULL DEFAULT 'documento',
  version        smallint    NOT NULL DEFAULT 1,
  -- Producción y validación
  subido_por     uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  producido_por  text,                          -- 'agente_virtual' | 'gestor' | 'investigador'
  validado_por   uuid        REFERENCES usuario(id) ON DELETE SET NULL,
  validado_en    timestamptz,
  -- Descarga controlada
  token_descarga text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  descargas      integer     NOT NULL DEFAULT 0,
  ultima_descarga timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entregable_pedido ON entregable(pedido_id);
CREATE INDEX IF NOT EXISTS idx_entregable_token  ON entregable(token_descarga);

-- ---------------------------------------------------------------------
--  5. PAGOS  (PayU Latam · WebCheckout + confirmación por webhook)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE estado_pago AS ENUM ('pendiente','aprobado','rechazado','expirado','reembolsado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pago (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid          NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  pasarela       text          NOT NULL DEFAULT 'payu',
  referencia     text          NOT NULL UNIQUE,   -- referenceCode enviado a PayU
  monto          numeric(12,2) NOT NULL,
  moneda         text          NOT NULL DEFAULT 'USD',
  estado         estado_pago   NOT NULL DEFAULT 'pendiente',
  -- Respuesta de la pasarela
  transaccion_id text,
  estado_pasarela text,                           -- APPROVED | DECLINED | PENDING...
  respuesta      jsonb,
  pagado_en      timestamptz,
  creado_en      timestamptz   NOT NULL DEFAULT now(),
  actualizado_en timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pago_pedido ON pago(pedido_id);
DROP TRIGGER IF EXISTS trg_pago_upd ON pago;
CREATE TRIGGER trg_pago_upd BEFORE UPDATE ON pago
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ---------------------------------------------------------------------
--  6. SECUENCIA DE FOLIOS  (BOIT-AAAA-0001)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS pedido_folio_seq START 1;

CREATE OR REPLACE FUNCTION siguiente_folio_pedido() RETURNS text AS $$
  SELECT 'BOIT-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('pedido_folio_seq')::text, 4, '0');
$$ LANGUAGE sql;
