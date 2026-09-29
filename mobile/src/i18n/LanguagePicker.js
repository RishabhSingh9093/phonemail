import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { LANGUAGES, setLanguage, t } from './index';

// Approximate bounding boxes for major Indian regions.
// Order matters: smaller regions should come before larger ones.
const REGION_BOXES = [
  // Tamil Nadu + Puducherry
  { name: 'Tamil Nadu', minLat: 8.0, maxLat: 13.6, minLng: 76.2, maxLng: 80.4, lang: 'ta' },
  // Delhi (small box, must come before the broader Hindi belt)
  { name: 'Delhi', minLat: 28.3, maxLat: 28.9, minLng: 76.8, maxLng: 77.4, lang: 'hi' },
  // Broad Hindi belt (checked last so smaller boxes win)
  { name: 'North India', minLat: 23.5, maxLat: 31.0, minLng: 74.0, maxLng: 85.0, lang: 'hi' },
];

function detectLanguageFromCoords(lat, lng) {
  for (const box of REGION_BOXES) {
    if (
      lat >= box.minLat && lat <= box.maxLat &&
      lng >= box.minLng && lng <= box.maxLng
    ) {
      console.log(`Matched ${box.name} -> ${box.lang}`);
      return box.lang;
    }
  }
  return null;
}

export default function LanguagePicker({ visible, current, onClose, onSelect }) {
  const [detecting, setDetecting] = useState(false);

  const choose = (code) => {
    setLanguage(code);
    onSelect(code);
    onClose();
  };

  const detectFromLocation = async () => {
    setDetecting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location not allowed',
          'No problem — pick a language manually from the list below.'
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });

      const { latitude, longitude } = pos.coords;
      console.log('COORDS:', latitude, longitude);

      const detected = detectLanguageFromCoords(latitude, longitude);
      if (detected) {
        choose(detected);
        return;
      }

      Alert.alert(
        'Could not detect',
        'We could not map your location to a language. Pick one manually below.'
      );
    } catch (e) {
      Alert.alert('Detection failed', e.message || 'Try picking manually.');
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('language')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.detectBtn}
            onPress={detectFromLocation}
            disabled={detecting}
          >
            {detecting ? (
              <ActivityIndicator color="#2563eb" />
            ) : (
              <>
                <Ionicons name="navigate" size={18} color="#2563eb" />
                <Text style={styles.detectText}>{t('detect_from_location')}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.reason}>{t('location_reason')}</Text>

          <ScrollView style={styles.list}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.row, current === lang.code && styles.rowActive]}
                onPress={() => choose(lang.code)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.langNative}>{lang.native}</Text>
                  <Text style={styles.langLabel}>{lang.label}</Text>
                </View>
                {current === lang.code && (
                  <Ionicons name="checkmark-circle" size={22} color="#2563eb" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  detectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    padding: 14,
    borderRadius: 12,
    justifyContent: 'center',
    marginBottom: 8,
  },
  detectText: { color: '#2563eb', fontWeight: '700', fontSize: 14 },
  reason: {
    color: '#94a3b8',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  list: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  rowActive: { backgroundColor: '#eff6ff' },
  langNative: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  langLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
});
