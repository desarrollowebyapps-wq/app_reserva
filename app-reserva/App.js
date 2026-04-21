import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import supabase from './src/config/supabase';

export default function App() {
  const [status, setStatus] = useState('checking');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('Tienda').select('id').limit(1);
        if (error) {
          setStatus('error');
          setDetail(error.message);
        } else {
          setStatus('ok');
          setDetail(`Filas leidas: ${data?.length ?? 0}`);
        }
      } catch (e) {
        setStatus('error');
        setDetail(String(e?.message ?? e));
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      {status === 'checking' && <ActivityIndicator size="large" color="#007AFF" />}
      <Text style={[styles.title, status === 'ok' && styles.ok, status === 'error' && styles.err]}>
        {status === 'checking' ? 'Conectando...' : status === 'ok' ? 'Conectado a Supabase' : 'Error de conexion'}
      </Text>
      {!!detail && <Text style={styles.detail}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', marginTop: 12, textAlign: 'center' },
  ok: { color: '#2e7d32' },
  err: { color: '#c62828' },
  detail: { marginTop: 12, fontSize: 14, color: '#555', textAlign: 'center' },
});
