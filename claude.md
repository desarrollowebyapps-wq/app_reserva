# 🍔 App Reservaciones de Comida - Guía Maestra

## 📋 Información del Proyecto

**Nombre:** FoodReserve (puedes cambiar)  
**Stack:** React Native + Supabase + PostgreSQL  
**Plataformas:** Android e iOS  
**Inicio:** React Native Expo  

---

## 🏗️ Arquitectura General

```
┌──────────────────────────────────────────────────────┐
│         APP CLIENTE (React Native)                   │
│  - Ver productos del inventario de la tienda         │
│  - Agregar al carrito                               │
│  - Pagar (tarjeta, transferencia, efectivo)         │
│  - Ver estado del pedido en tiempo real             │
│  - Retirar con QR / Número de pedido                │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│    SUPABASE (BD SaaS intacta + 3 tablas nuevas)     │
│                                                      │
│  EXISTENTES (NO MODIFICAR):   NUEVAS:               │
│  ├─ Tienda                    ├─ Reserva           │
│  ├─ Producto (stock)          ├─ DetalleReserva    │
│  ├─ Cliente                   └─ NotificacionReserva│
│  ├─ Categoria                                       │
│  ├─ Usuario                                         │
│  ├─ Venta/DetalleVenta  ← app inserta al entregar  │
│  ├─ MovimientoInventario ← app inserta salida/entrada│
│  └─ OrdenCompra/DetalleCompra (no se toca)         │
│                                                      │
│  Lógica:                                            │
│  - Reserva pagada → rebaja stock_actual + Movimiento│
│  - Estado: pendiente→pagada→preparando→lista→entregada│
│  - Al entregar: crea Venta + DetalleVenta real      │
│  - Cancelación (antes preparando): devuelve stock   │
│  - QR automático + realtime                         │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│     ADMIN PANEL (Panel existente o web React)       │
│  - Ver pedidos online (estado, cliente, items)      │
│  - Marcar como "listo" → Cliente recibe notificación│
│  - Esto ya existe en tu sistema actual              │
└──────────────────────────────────────────────────────┘
```

---

## 🗄️ Estructura de Base de Datos (PostgreSQL en Supabase)

### ✅ Tablas EXISTENTES (Tu BD actual):
- `Tienda` — info de la tienda
- `Producto` — inventario con `stock_actual`
- `Cliente` — clientes registrados
- `Categoria` — categorías de productos
- `Proveedor` — proveedores
- `Venta` + `DetalleVenta` — ventas en mostrador
- `OrdenCompra` — órdenes de compra
- `MovimientoInventario` — historial de stock
- `Usuario` — usuarios del sistema
- `Plan` — planes de suscripción

### 📝 Tablas NUEVAS (schema aditivo, 0 ALTER):

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
  metodo_pago text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente', -- pendiente|pagada|preparando|lista|entregada|cancelada
  payment_id text,
  notas text,
  fecha_entrega_estimada timestamp without time zone,
  venta_id text REFERENCES public.Venta(id), -- NULL hasta entrega
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. DETALLE RESERVA
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

-- 3. NOTIFICACION RESERVA
CREATE TABLE public.NotificacionReserva (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cliente_id text NOT NULL REFERENCES public.Cliente(id),
  reserva_id text NOT NULL REFERENCES public.Reserva(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensaje text,
  leida boolean NOT NULL DEFAULT false,
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 🔑 Índices:

```sql
CREATE INDEX idx_reserva_tienda ON public.Reserva(tienda_id);
CREATE INDEX idx_reserva_cliente ON public.Reserva(cliente_id);
CREATE INDEX idx_reserva_estado ON public.Reserva(estado);
CREATE INDEX idx_reserva_numero ON public.Reserva(numero_pedido);
CREATE INDEX idx_reserva_venta ON public.Reserva(venta_id);
CREATE INDEX idx_detallereserva_reserva ON public.DetalleReserva(reserva_id);
CREATE INDEX idx_detallereserva_producto ON public.DetalleReserva(producto_id);
CREATE INDEX idx_notifreserva_cliente ON public.NotificacionReserva(cliente_id);
CREATE INDEX idx_notifreserva_reserva ON public.NotificacionReserva(reserva_id);
```

### 🚨 Reglas invariantes (no romper SaaS):
1. NUNCA `ALTER TABLE` sobre tablas SaaS
2. App inserta en: `Reserva`, `DetalleReserva`, `NotificacionReserva`, `MovimientoInventario`, `Venta`, `DetalleVenta`
3. App actualiza: `Reserva`, `Producto.stock_actual`, `Producto.updatedAt`
4. Stock rebaja al pagar → devuelve al cancelar
5. `Venta` se crea SOLO al entregar (reporte SaaS cuenta ingreso natural)

---

## 📱 Estructura de Carpetas (React Native)

```
food-reserve-app/
├── app.json (configuración Expo)
├── package.json
├── .env.local (variables secretas - NO COMMITEAR)
│
├── src/
│   ├── config/
│   │   ├── supabase.js          # Conexión a Supabase
│   │   ├── stripe.js            # Configuración Stripe
│   │   └── constants.js         # URLs, claves públicas
│   │
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── LoginScreen.js
│   │   │   ├── RegisterScreen.js
│   │   │   └── SelectStoreScreen.js
│   │   │
│   │   ├── customer/
│   │   │   ├── HomeScreen.js           # Tiendas cercanas
│   │   │   ├── StoreDetailScreen.js    # Productos de la tienda
│   │   │   ├── CartScreen.js           # Carrito
│   │   │   ├── CheckoutScreen.js       # Pago
│   │   │   ├── OrderTrackingScreen.js  # Estado del pedido
│   │   │   ├── OrderHistoryScreen.js   # Historial
│   │   │   └── ProfileScreen.js        # Perfil del cliente
│   │   │
│   │   ├── admin/
│   │   │   ├── AdminDashboard.js       # Panel principal
│   │   │   ├── ProductsManagement.js   # CRUD productos
│   │   │   ├── OrdersManagement.js     # Ver/actualizar pedidos
│   │   │   ├── SettingsScreen.js       # Logo, ubicación, horarios
│   │   │   ├── PaymentSettingsScreen.js # Métodos de pago
│   │   │   ├── AnalyticsScreen.js      # Estadísticas
│   │   │   └── StaffManagement.js      # Si hay múltiples usuarios
│   │   │
│   │   └── shared/
│   │       ├── QRCodeScreen.js         # Ver QR del pedido
│   │       └── NotificationsScreen.js  # Centro de notificaciones
│   │
│   ├── components/
│   │   ├── ProductCard.js
│   │   ├── OrderCard.js
│   │   ├── PaymentMethodSelector.js
│   │   ├── LoadingSpinner.js
│   │   ├── StoreCard.js
│   │   └── ModalConfirmation.js
│   │
│   ├── hooks/
│   │   ├── useAuth.js              # Autenticación
│   │   ├── useStore.js             # Datos de tienda
│   │   ├── useCart.js              # Carrito
│   │   ├── useOrders.js            # Pedidos
│   │   ├── useRealtime.js          # Suscripciones en tiempo real
│   │   └── useLocation.js          # Ubicación del usuario
│   │
│   ├── services/
│   │   ├── authService.js          # Login, registro, logout
│   │   ├── productService.js       # CRUD productos
│   │   ├── orderService.js         # CRUD pedidos
│   │   ├── paymentService.js       # Pagos con Stripe
│   │   ├── storeService.js         # Datos de tienda
│   │   ├── notificationService.js  # Envío de notificaciones
│   │   └── qrService.js            # Generar QR
│   │
│   ├── context/
│   │   ├── AuthContext.js
│   │   ├── CartContext.js
│   │   ├── StoreContext.js
│   │   └── NotificationContext.js
│   │
│   ├── utils/
│   │   ├── formatting.js           # Formatear dinero, fechas
│   │   ├── validation.js           # Validaciones
│   │   ├── locations.js            # Cálculos de distancia
│   │   └── errorHandling.js        # Manejo de errores
│   │
│   ├── navigation/
│   │   ├── RootNavigator.js        # Navigator principal
│   │   ├── CustomerNavigator.js    # Stack de cliente
│   │   ├── AdminNavigator.js       # Stack de admin
│   │   └── AuthNavigator.js        # Stack de autenticación
│   │
│   └── App.js                      # Punto de entrada
│
├── assets/
│   ├── images/
│   ├── icons/
│   └── fonts/
│
└── __tests__/
    ├── services/
    ├── hooks/
    └── components/
```

---

## 🔑 Variables de Entorno (.env.local)

```bash
# SUPABASE
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# STRIPE
STRIPE_PUBLIC_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx (SOLO EN BACKEND)

# APP
API_BASE_URL=https://xxxxx.supabase.co/rest/v1
GOOGLE_MAPS_API_KEY=AIzaSyDxxxxx (opcional, si quieres mapa)

# NOTIFICACIONES
FIREBASE_PROJECT_ID=xxxx (si usas Firebase para push notifications)
```

---

## 🚀 Setup Inicial (Paso a Paso)

### 1. **En Supabase (ya tienes cuenta)**

```bash
# Ve a https://app.supabase.com
# 1. Crea un nuevo proyecto (si no lo hiciste)
# 2. Copia SUPABASE_URL y SUPABASE_ANON_KEY
# 3. Ve a SQL Editor y ejecuta los scripts de tablas (arriba)
# 4. Configura RLS (Row Level Security) para cada tabla
```

### 2. **En tu máquina local**

```bash
# Instalar Node.js si no lo tienes: https://nodejs.org/

# Crear proyecto React Native
npx create-expo-app food-reserve-app
cd food-reserve-app

# Instalar dependencias principales
npm install @supabase/supabase-js
npm install @react-navigation/native @react-navigation/bottom-tabs
npm install @react-native-async-storage/async-storage
npm install expo-qr-code
npm install react-native-stripe-sdk
npm install expo-notifications
npm install expo-location
npm install axios

# Dependencias de desarrollo
npm install --save-dev prettier eslint
```

### 3. **Crear archivo .env.local en la raíz**

```
SUPABASE_URL=tu_url_aqui
SUPABASE_ANON_KEY=tu_key_aqui
STRIPE_PUBLIC_KEY=tu_stripe_key
```

### 4. **Iniciar el proyecto**

```bash
npx expo start
# Luego presionar 'a' para Android o 'i' para iOS
```

---

## 🔐 Autenticación (Flujo)

### Cliente:
1. Abre app → No autenticado → va a LoginScreen
2. Login o Registro
3. Elige tienda o ve todas disponibles
4. HomeScreen → Ve productos → Compra → Paga

### Admin:
1. Login con email de admin
2. Sistema detecta rol = 'admin'
3. Va a AdminDashboard
4. Puede editar todo

---

## 💳 Integración de Pagos (Stripe)

```javascript
// Flujo:
1. Usuario selecciona "Pagar con Tarjeta"
2. App llama a Stripe.js
3. Stripe genera clientSecret
4. Usuario confirma pago
5. Backend procesa en Supabase
6. App actualiza estado a 'paid'
7. Admin ve pedido listo para preparar

// Si selecciona "Transferencia" o "Efectivo"
1. Se genera pedido con status = 'pending_payment'
2. Se guarda en BD
3. Admin ve pedido pendiente de pago
4. Después de confirmar pago, marca como 'paid'
```

---

## 🔔 Notificaciones en Tiempo Real

### Con Supabase Realtime:

```javascript
// Cliente suscribe a cambios su reserva
const sub = supabase
  .channel(`reserva-${reservaId}`)
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'Reserva', filter: `id=eq.${reservaId}` },
    payload => {
      if (payload.new.estado === 'lista') showNotification('Lista para retirar');
    })
  .subscribe();

// Admin actualiza estado
await supabase.from('Reserva').update({ estado: 'lista' }).eq('id', reservaId);
```

### Push Notifications (opcional con Expo):
- Usar `expo-notifications` para alertas locales
- Integrable con Firebase Cloud Messaging

---

## 🎯 Flujos Principales

### CLIENTE - Hacer Pedido:
```
1. HomeScreen (buscar tienda cercana)
   └─ StoreDetailScreen (ver productos)
      └─ CartScreen (agregar items)
         └─ CheckoutScreen (seleccionar pago)
            └─ Pagar (Stripe / datos para transferencia / efectivo al retirar)
               └─ OrderTrackingScreen (Ver estado en tiempo real)
                  └─ Ir a tienda con QR / Número
```

### ADMIN - Gestionar:
```
1. AdminDashboard
   ├─ ProductsManagement
   │  └─ Agregar / Editar / Eliminar productos
   │
   ├─ OrdersManagement
   │  └─ Ver pedidos → Marcar como 'ready' → Cliente retira
   │
   ├─ SettingsScreen
   │  ├─ Logo y fotos
   │  ├─ Ubicación (coordenadas)
   │  ├─ Horarios de atención
   │  └─ Información de contacto
   │
   ├─ PaymentSettingsScreen
   │  └─ Habilitar/deshabilitar métodos de pago
   │
   └─ AnalyticsScreen
      └─ Ventas, pedidos procesados, etc
```

---

## 📦 Dependencias Principales

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x",
    "@react-navigation/native": "^6.x",
    "@react-navigation/bottom-tabs": "^6.x",
    "@react-native-async-storage/async-storage": "^1.x",
    "expo-qr-code": "^1.x",
    "react-native-stripe-sdk": "^1.x",
    "expo-notifications": "^0.x",
    "expo-location": "^15.x",
    "axios": "^1.x",
    "react-native-dotenv": "^3.x"
  },
  "devDependencies": {
    "prettier": "^2.x",
    "eslint": "^8.x"
  }
}
```

---

## 🔐 Seguridad (MUY IMPORTANTE)

1. **NUNCA** commits .env.local
2. **NUNCA** expongas STRIPE_SECRET_KEY en el app
3. **Usa RLS en Supabase** para que solo usuarios vean sus pedidos
4. **Valida en backend** todos los pagos
5. **Encripta** datos sensibles

---

## 📝 Checklist de Desarrollo

- [ ] Crear proyecto Expo
- [ ] Conectar Supabase
- [ ] Implementar autenticación
- [ ] Crear tablas en PostgreSQL
- [ ] Build pantalla de login
- [ ] Build pantalla de registro
- [ ] Build HomeScreen (listar tiendas)
- [ ] Build StoreDetailScreen (productos)
- [ ] Implementar carrito (Context)
- [ ] Implementar Stripe
- [ ] Build CheckoutScreen
- [ ] Implementar creación de pedidos
- [ ] Implementar QR (generación y lectura)
- [ ] Implementar realtime subscriptions
- [ ] Build AdminDashboard
- [ ] Build ProductsManagement
- [ ] Build OrdersManagement
- [ ] Build SettingsScreen
- [ ] Implementar notificaciones push
- [ ] Testing
- [ ] Deploy (EAS Build)

---

## 🆘 Solución de Problemas

### "No puedo conectar a Supabase"
- Verifica SUPABASE_URL y SUPABASE_ANON_KEY
- Revisa que sean strings válidos
- Intenta hacer `npx expo start --clear`

### "El RLS está bloqueando mis queries"
- Ve a Supabase → SQL Editor
- Crea políticas correctas para cada tabla
- Asegúrate de que `auth.users` está configurado

### "Stripe no funciona"
- Verifica que STRIPE_PUBLIC_KEY sea correcto
- Usa keys de test, no de producción
- Revisa la documentación oficial de Stripe

---

## 📚 Documentación Oficial

- [Supabase](https://supabase.com/docs)
- [React Native Docs](https://reactnative.dev/)
- [Expo](https://docs.expo.dev/)
- [Stripe (React Native)](https://stripe.com/docs/stripe-js)
- [React Navigation](https://reactnavigation.org/)

---

## 🎯 Próximos Pasos

1. **Confirma que tienes:**
   - ✅ Proyecto Supabase creado
   - ✅ SUPABASE_URL y SUPABASE_ANON_KEY
   - ✅ Base de datos estructurada
   - ✅ Node.js instalado

2. **Luego diremos:**
   - "Crea el proyecto base"
   - "Configura la conexión a Supabase"
   - "Build pantalla de login"
   - (paso a paso)

---

## 💡 Notas Finales

- Este .md es tu **referencia maestra**
- Actualízalo según cambies el proyecto
- Úsalo con Claude Code en Visual Studio
- Cuando pidas cambios, menciona el archivo/componente específico
- Mantén organizado y commits frecuentes

**¡Listo para empezar! 🚀**
