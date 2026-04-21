# ⚡ SETUP RÁPIDO - Checklist (30 minutos máximo)

## Paso 1️⃣: Preparar tu Supabase (10 min)

### A. Obtener credenciales
- [ ] Abre https://app.supabase.com
- [ ] Entra a tu proyecto
- [ ] Settings → API
- [ ] **COPIA** Project URL → `SUPABASE_URL`
- [ ] **COPIA** Anon public key → `SUPABASE_ANON_KEY`
- [ ] **GUARDA** en un editor de texto temporal

### B. Crear tablas (si no existen)
- [ ] Ve a SQL Editor
- [ ] Copia TODO el SQL de `SUPABASE_SETUP.md` (PASO 2)
- [ ] Ejecuta el SQL
- [ ] Verifica que aparezcan todas las tablas en "Tables"

### C. Activar autenticación
- [ ] Ve a Authentication → Providers
- [ ] Email/Password → actívalo
- [ ] ✅ Ready!

---

## Paso 2️⃣: Agregar Tablas a tu Supabase (5 min)

En Supabase SQL Editor, ejecuta:

```sql
-- Tabla 1: Reserva (cabecera)
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
  metodo_pago text NOT NULL DEFAULT 'tarjeta',
  estado text NOT NULL DEFAULT 'pendiente',
  payment_id text,
  notas text,
  fecha_entrega_estimada timestamp without time zone,
  venta_id text REFERENCES public.Venta(id),
  createdAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tabla 2: DetalleReserva
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

-- Tabla 3: NotificacionReserva
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

-- Índices
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

**IMPORTANTE:** 0 ALTER sobre tablas SaaS. Solo 3 tablas nuevas con FK.

---

## Paso 3️⃣: Crear Proyecto React Native (5 min)

```bash
# En tu terminal:
npx create-expo-app app-compras

# Entra a la carpeta:
cd app-compras

# Instala las dependencias básicas:
npm install @supabase/supabase-js
npm install react-native-dotenv
```

---

## Paso 4️⃣: Configurar Variables de Entorno (2 min)

### A. Crear archivo `.env` en la raíz

En `app-compras/.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EXPO_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_xxxxx
```

(Reemplaza `xxx` con tus credenciales reales)

### B. Crear `.gitignore` (si no existe)

```
node_modules/
.env
.env.local
.DS_Store
*.log
```

---

## Paso 4️⃣: Crear Estructura de Carpetas (3 min)

```bash
# En la raíz del proyecto:

mkdir -p src/config
mkdir -p src/services
mkdir -p src/screens/auth
mkdir -p src/components
mkdir -p src/hooks
mkdir -p src/context
mkdir -p src/utils
mkdir -p src/navigation
```

---

## Paso 5️⃣: Crear Archivo de Conexión Supabase (2 min)

### Crear: `src/config/supabase.js`

```javascript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('❌ Faltan SUPABASE_URL o SUPABASE_ANON_KEY en .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default supabase;
```

---

## Paso 6️⃣: Actualizar `package.json` (1 min)

Busca la sección `"main"` y verifica que sea:

```json
{
  "main": "expo-router/entry",
  // ... resto del archivo
}
```

Si usas expo-router, instálalo:

```bash
npm install expo-router expo-constants
```

---

## Paso 7️⃣: Crear `App.js` Básico (2 min)

Reemplaza el contenido de `App.js`:

```javascript
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import supabase from './src/config/supabase';

export default function App() {
  const [isConnected, setIsConnected] = useState(null);

  useEffect(() => {
    testConnection();
  }, []);

  const testConnection = async () => {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .limit(1);

      if (error) {
        console.error('❌ Error:', error.message);
        setIsConnected(false);
      } else {
        console.log('✅ Conectado a Supabase!');
        setIsConnected(true);
      }
    } catch (err) {
      console.error('❌ Error:', err);
      setIsConnected(false);
    }
  };

  if (isConnected === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.text}>Conectando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.text, isConnected ? styles.success : styles.error]}>
        {isConnected ? '✅ Conectado a Supabase' : '❌ Error de conexión'}
      </Text>
      <Text style={styles.subtitle}>
        {isConnected
          ? 'El proyecto está listo para desarrollar'
          : 'Verifica tus variables de entorno'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  success: {
    color: '#4CAF50',
  },
  error: {
    color: '#f44336',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
```

---

## Paso 8️⃣: Iniciar el Proyecto (3 min)

```bash
# En la terminal, en la raíz del proyecto:
npx expo start

# Verás opciones:
# Presiona 'a' para Android
# Presiona 'i' para iOS
# Presiona 'w' para web
```

### Resultado esperado:
- Ves un simulador/emulador
- Aparece pantalla blanca con un mensaje
- **Si aparece "✅ Conectado a Supabase"** → ¡ÉXITO!
- **Si aparece "❌ Error de conexión"** → Revisa variables de entorno

---

## 🔧 Si algo falla:

### Error: "Cannot find module '@supabase/supabase-js'"
```bash
npm install --save @supabase/supabase-js
```

### Error: "Faltan SUPABASE_URL o SUPABASE_ANON_KEY"
- Abre `.env`
- Verifica que tengas ambas variables
- Reinicia Expo: `npx expo start --clear`

### Error: "Cannot connect to Supabase"
- Verifica que SUPABASE_URL sea correcto (sin espacios)
- Verifica que SUPABASE_ANON_KEY sea completa
- En Supabase, ve a Settings → API y copia de nuevo

### El simulador no inicia
- Cierra todo y ejecuta: `npx expo start --clear`
- Si usas Android: Abre Android Studio primero y crea un emulador

---

## 📋 Verificación Final

### Checklist:
- [ ] `.env` existe con tus credenciales
- [ ] Carpeta `src/` creada con subcarpetas
- [ ] `src/config/supabase.js` existe
- [ ] `App.js` actualizado
- [ ] `npm install` se ejecutó sin errores
- [ ] `npx expo start` inicia correctamente
- [ ] App muestra "✅ Conectado a Supabase"

### Si todo está ✅:
Pasa al siguiente documento: `PRIMERA_PANTALLA.md`

---

## 📊 Estructura Actual

```
food-reserve-app/
├── .env                              ← Variables (NO COMMITEAR)
├── .gitignore
├── package.json
├── App.js                            ← App principal actualizado
│
├── src/
│   ├── config/
│   │   └── supabase.js              ← ✅ Conexión lista
│   ├── services/
│   ├── screens/
│   │   └── auth/
│   ├── components/
│   ├── hooks/
│   ├── context/
│   ├── utils/
│   └── navigation/
│
└── node_modules/
    └── @supabase/supabase-js
```

---

## 🚀 Próximo Paso

Una vez todo esté funcionando:

```bash
# Guarda todos los cambios:
git init
git add .
git commit -m "Initial setup with Supabase connection"

# Entonces avísame:
# "✅ Todo funcionando, lista para la siguiente pantalla"
```

**¿Algo no funciona? Copia el error completo y avísame.** 🆘

---

## 💡 Consejo

Mantén estos 3 archivos a mano:
1. `claude.md` - Tu referencia maestra
2. `SUPABASE_SETUP.md` - Detalles de BD
3. `SETUP_CHECKLIST.md` - Este archivo

**¡Vamos! 🚀**
