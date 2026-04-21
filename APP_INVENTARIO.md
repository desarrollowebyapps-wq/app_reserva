# 🛍️ App Reserva - Guía Adaptada (Schema Aditivo)

## 🎯 Caso

Tienda ya tiene SaaS con:
- `Producto` (stock_actual)
- `Cliente`
- `Venta` + `DetalleVenta` (POS mostrador)
- `OrdenCompra` + `DetalleCompra` (compras proveedor)
- `MovimientoInventario` (auditoría stock)
- `Categoria`, `Proveedor`, `Usuario`, `Tienda`, `Plan`

**Regla dura:** NO modificar tablas existentes. SaaS sigue operando intacto. Solo tablas nuevas con FK.

**Objetivo:** App móvil = POS de reserva. Cliente:
1. Ve productos tienda
2. Carrito
3. Paga (tarjeta/transfer/efectivo)
4. Retira con QR/número
5. Estado realtime

Al pagar → rebaja `stock_actual` (evita sobreventa con mostrador).
Al entregar → crea `Venta` real (reporte SaaS cuenta ingreso).

---

## 📊 Flujo Datos

```
CLIENTE ABRE APP
    ↓
LOGIN (tabla Cliente existente)
    ↓
VE PRODUCTOS (SELECT FROM Producto WHERE tienda_id=X AND activo=true)
    ↓
CARRITO (estado local app)
    ↓
PAGA (Stripe / transfer / efectivo)
    ↓
INSERT Reserva (estado='pagada')
INSERT DetalleReserva (N filas)
INSERT MovimientoInventario (tipo='salida', ref='Reserva-<num>')
UPDATE Producto.stock_actual -= cantidad
    ↓
GENERA QR
    ↓
Cliente ve estado realtime (suscripción Reserva)
    ↓
Admin (SaaS o app admin) cambia estado: pagada → preparando → lista
    ↓
CLIENTE RECIBE NOTIF "Lista para retirar"
    ↓
CLIENTE LLEGA CON QR
    ↓
Admin marca 'entregada':
  INSERT Venta (estado='completada', numero_ticket nuevo)
  INSERT DetalleVenta (copia de DetalleReserva)
  UPDATE Reserva SET estado='entregada', venta_id=<venta.id>
  (NO rebaja stock otra vez — ya bajó al pagar)
```

### Cancelación (antes de 'preparando')
```
UPDATE Reserva SET estado='cancelada'
INSERT MovimientoInventario (tipo='entrada', ref='Reserva-<num>-cancel', motivo='Cancelación reserva')
UPDATE Producto.stock_actual += cantidad
```

---

## 🗄️ 3 Tablas Nuevas (0 ALTER)

```sql
-- 1. RESERVA (cabecera)
CREATE TABLE public.Reserva (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tienda_id text NOT NULL REFERENCES public.Tienda(id),
  cliente_id text NOT NULL REFERENCES public.Cliente(id),
  numero_pedido text NOT NULL UNIQUE,
  qr_code text,
  qr_code_url text,
  total_bruto integer NOT NULL,
  descuento integer NOT NULL DEFAULT 0,
  impuesto integer NOT NULL,
  total_neto integer NOT NULL,
  metodo_pago text NOT NULL,              -- tarjeta|transferencia|efectivo
  estado text NOT NULL DEFAULT 'pendiente', -- pendiente|pagada|preparando|lista|entregada|cancelada
  payment_id text,
  notas text,
  fecha_entrega_estimada timestamp without time zone,
  venta_id text REFERENCES public.Venta(id), -- NULL hasta entrega
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reserva_tienda ON public.Reserva(tienda_id);
CREATE INDEX idx_reserva_cliente ON public.Reserva(cliente_id);
CREATE INDEX idx_reserva_estado ON public.Reserva(estado);
CREATE INDEX idx_reserva_numero ON public.Reserva(numero_pedido);
CREATE INDEX idx_reserva_venta ON public.Reserva(venta_id);

-- 2. DETALLE RESERVA (items)
CREATE TABLE public.DetalleReserva (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reserva_id text NOT NULL REFERENCES public.Reserva(id) ON DELETE CASCADE,
  producto_id text NOT NULL REFERENCES public.Producto(id),
  cantidad integer NOT NULL,
  precio_unitario integer NOT NULL,
  descuento_item integer NOT NULL DEFAULT 0,
  subtotal integer NOT NULL,
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_detallereserva_reserva ON public.DetalleReserva(reserva_id);
CREATE INDEX idx_detallereserva_producto ON public.DetalleReserva(producto_id);

-- 3. NOTIFICACION RESERVA
CREATE TABLE public.NotificacionReserva (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cliente_id text NOT NULL REFERENCES public.Cliente(id),
  reserva_id text NOT NULL REFERENCES public.Reserva(id) ON DELETE CASCADE,
  tipo text NOT NULL,                     -- estado_cambio|lista|cancelada
  titulo text NOT NULL,
  mensaje text,
  leida boolean NOT NULL DEFAULT false,
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifreserva_cliente ON public.NotificacionReserva(cliente_id);
CREATE INDEX idx_notifreserva_reserva ON public.NotificacionReserva(reserva_id);
```

---

## 🔐 RLS

```sql
-- Cliente ve sus reservas
CREATE POLICY "Cliente ve sus reservas"
  ON public.Reserva FOR SELECT
  USING (cliente_id = auth.uid()::text);

-- Cliente crea reservas propias
CREATE POLICY "Cliente crea reserva"
  ON public.Reserva FOR INSERT
  WITH CHECK (cliente_id = auth.uid()::text);

-- Cliente cancela (solo antes de preparando)
CREATE POLICY "Cliente cancela reserva"
  ON public.Reserva FOR UPDATE
  USING (cliente_id = auth.uid()::text AND estado IN ('pendiente','pagada'));

-- Admin tienda ve/edita reservas su tienda
CREATE POLICY "Admin gestiona reservas tienda"
  ON public.Reserva FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.Usuario
      WHERE Usuario.tienda_id = Reserva.tienda_id
      AND Usuario.id = auth.uid()::text
    )
  );

-- DetalleReserva: mismos permisos via reserva_id
CREATE POLICY "Ver detalle reserva"
  ON public.DetalleReserva FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.Reserva r
      WHERE r.id = DetalleReserva.reserva_id
      AND (r.cliente_id = auth.uid()::text
        OR EXISTS (SELECT 1 FROM public.Usuario u
                   WHERE u.tienda_id = r.tienda_id AND u.id = auth.uid()::text))
    )
  );

-- Cliente ve productos activos
CREATE POLICY "Clientes ven productos activos"
  ON public.Producto FOR SELECT
  USING (activo = true);

-- Cliente ve notifs propias
CREATE POLICY "Cliente ve notifs"
  ON public.NotificacionReserva FOR SELECT
  USING (cliente_id = auth.uid()::text);
```

---

## 🔄 Servicio: Crear Reserva (con stock)

```javascript
// src/services/reservaService.js
import supabase from '../config/supabase';

export const crearReservaConStock = async (reserva, items) => {
  // 1. INSERT Reserva
  const { data: nuevaReserva, error: e1 } = await supabase
    .from('Reserva')
    .insert([reserva])
    .select()
    .single();
  if (e1) throw e1;

  // 2. Por cada item: detalle + movimiento + rebaja stock
  for (const item of items) {
    await supabase.from('DetalleReserva').insert({
      reserva_id: nuevaReserva.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.cantidad * item.precio_unitario,
    });

    const { data: prod } = await supabase
      .from('Producto')
      .select('stock_actual')
      .eq('id', item.producto_id)
      .single();

    if (prod.stock_actual < item.cantidad) {
      throw new Error(`Stock insuficiente: ${item.producto_id}`);
    }

    await supabase
      .from('Producto')
      .update({
        stock_actual: prod.stock_actual - item.cantidad,
        updatedAt: new Date(),
      })
      .eq('id', item.producto_id);

    await supabase.from('MovimientoInventario').insert({
      producto_id: item.producto_id,
      tipo: 'salida',
      cantidad: item.cantidad,
      referencia: `Reserva-${nuevaReserva.numero_pedido}`,
      motivo: 'Reserva app',
    });
  }

  return nuevaReserva;
};
```

## 🔄 Servicio: Entregar Reserva (crea Venta real)

```javascript
export const entregarReserva = async (reservaId) => {
  // 1. Leer reserva + detalles
  const { data: reserva } = await supabase
    .from('Reserva').select('*').eq('id', reservaId).single();
  const { data: detalles } = await supabase
    .from('DetalleReserva').select('*').eq('reserva_id', reservaId);

  // 2. Crear Venta (estado='completada') — reporte SaaS la cuenta
  const { data: venta } = await supabase
    .from('Venta')
    .insert([{
      tienda_id: reserva.tienda_id,
      cliente_id: reserva.cliente_id,
      numero_ticket: `APP-${reserva.numero_pedido}`,
      total_bruto: reserva.total_bruto,
      descuento: reserva.descuento,
      impuesto: reserva.impuesto,
      total_neto: reserva.total_neto,
      metodo_pago: reserva.metodo_pago,
      estado: 'completada',
      notas: `Reserva app ${reserva.numero_pedido}`,
    }])
    .select().single();

  // 3. Copiar detalles a DetalleVenta (NO toca stock, ya bajó al pagar)
  for (const d of detalles) {
    await supabase.from('DetalleVenta').insert({
      venta_id: venta.id,
      producto_id: d.producto_id,
      cantidad: d.cantidad,
      precio_unitario: d.precio_unitario,
      descuento_item: d.descuento_item,
      subtotal: d.subtotal,
    });
  }

  // 4. Marcar reserva entregada
  await supabase
    .from('Reserva')
    .update({ estado: 'entregada', venta_id: venta.id, updatedAt: new Date() })
    .eq('id', reservaId);

  return venta;
};
```

## 🔄 Servicio: Cancelar Reserva (devuelve stock)

```javascript
export const cancelarReserva = async (reservaId) => {
  const { data: reserva } = await supabase
    .from('Reserva').select('*').eq('id', reservaId).single();

  if (!['pendiente','pagada'].includes(reserva.estado)) {
    throw new Error('Solo se puede cancelar antes de preparando');
  }

  const { data: detalles } = await supabase
    .from('DetalleReserva').select('*').eq('reserva_id', reservaId);

  for (const d of detalles) {
    const { data: prod } = await supabase
      .from('Producto').select('stock_actual').eq('id', d.producto_id).single();

    await supabase
      .from('Producto')
      .update({ stock_actual: prod.stock_actual + d.cantidad, updatedAt: new Date() })
      .eq('id', d.producto_id);

    await supabase.from('MovimientoInventario').insert({
      producto_id: d.producto_id,
      tipo: 'entrada',
      cantidad: d.cantidad,
      referencia: `Reserva-${reserva.numero_pedido}-cancel`,
      motivo: 'Cancelación reserva',
    });
  }

  await supabase
    .from('Reserva')
    .update({ estado: 'cancelada', updatedAt: new Date() })
    .eq('id', reservaId);
};
```

---

## 📱 Estructura App

```
app/
├── src/
│   ├── config/supabase.js
│   │
│   ├── services/
│   │   ├── authService.js        (tabla Cliente)
│   │   ├── productoService.js    (SELECT Producto)
│   │   ├── reservaService.js     (crear/entregar/cancelar)
│   │   ├── pagoService.js        (Stripe)
│   │   └── qrService.js
│   │
│   ├── screens/
│   │   ├── auth/ (Login, Register)
│   │   ├── cliente/ (Home, Carrito, Checkout, Reserva, QR, Historial)
│   │   └── admin/ (PedidosAdmin — cambia estados)
│   │
│   ├── context/ (Auth, Cart)
│   └── App.js
```

---

## 🔔 Realtime

```javascript
// PedidoScreen.js
useEffect(() => {
  const sub = supabase
    .channel(`reserva-${reservaId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'Reserva', filter: `id=eq.${reservaId}` },
      payload => {
        if (payload.new.estado === 'lista') showNotification('Lista para retirar');
        setReserva(payload.new);
      })
    .subscribe();
  return () => sub.unsubscribe();
}, [reservaId]);
```

---

## ✅ Ventajas Schema Aditivo

- 0 ALTER — SaaS intacto
- `MovimientoInventario` recibe filas nuevas (comportamiento normal, `referencia` distingue origen)
- Stock real previene sobreventa entre POS físico y app
- Al entregar → `Venta` real → reportes SaaS cuentan ingreso natural
- Reservas pendientes NO inflan ventas (no hay `Venta` hasta entrega)
- Cancelación devuelve stock limpio

## 🚨 Reglas Invariantes

1. App NUNCA hace `ALTER TABLE` en tablas SaaS
2. App SOLO inserta en: `Reserva`, `DetalleReserva`, `NotificacionReserva`, `MovimientoInventario`, `Venta`, `DetalleVenta`
3. App SOLO actualiza: `Reserva`, `Producto.stock_actual`, `Producto.updatedAt`
4. Stock rebaja al pagar (estado='pagada'), devuelve al cancelar
5. `Venta` se crea SOLO al entregar (no al reservar) — preserva semántica reporte SaaS

## 🎯 Checklist

### BD
- [ ] Crear `Reserva`
- [ ] Crear `DetalleReserva`
- [ ] Crear `NotificacionReserva`
- [ ] Índices
- [ ] RLS

### App cliente
- [ ] Login/Register (Cliente)
- [ ] Home (productos)
- [ ] Carrito (local)
- [ ] Checkout (Stripe)
- [ ] crearReservaConStock
- [ ] QR
- [ ] Pantalla reserva realtime
- [ ] Historial
- [ ] Cancelar

### Admin
- [ ] Ver Reserva por tienda
- [ ] Cambiar estado (pagada→preparando→lista)
- [ ] entregarReserva (crea Venta)
