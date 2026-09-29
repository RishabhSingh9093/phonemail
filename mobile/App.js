import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  FlatList, ScrollView, ActivityIndicator, Alert,
  SafeAreaView, KeyboardAvoidingView, Platform, StatusBar,
  RefreshControl, Modal, Image, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { t, setLanguage, detectDeviceLanguage, LANGUAGES } from './src/i18n';
import LanguagePicker from './src/i18n/LanguagePicker';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5001';
const POLL_INTERVAL = 5000;
const SCREEN_W = Dimensions.get('window').width;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

const LIGHT = {
  bg: '#f8fafc', surface: '#ffffff', surface2: '#f1f5f9', border: '#e2e8f0',
  text: '#0f172a', textMuted: '#64748b', textDim: '#94a3b8',
  primary: '#2563eb', primarySoft: '#eff6ff',
  danger: '#dc2626', dangerSoft: '#fee2e2',
  success: '#059669', successBg: '#ecfdf5',
  tabBar: '#ffffff', tabInactive: '#94a3b8',
  skeleton: '#e2e8f0',
  overlay: 'rgba(0,0,0,0.95)',
};
const DARK = {
  bg: '#0b1220', surface: '#111a2e', surface2: '#1c2942', border: '#1f2b47',
  text: '#e6edf7', textMuted: '#94a3b8', textDim: '#64748b',
  primary: '#3b82f6', primarySoft: '#1e293b',
  danger: '#f87171', dangerSoft: '#3b1f1f',
  success: '#34d399', successBg: '#0f2e26',
  tabBar: '#111a2e', tabInactive: '#64748b',
  skeleton: '#1f2b47',
  overlay: 'rgba(0,0,0,0.95)',
};

const FOLDERS = [
  { key: 'inbox', icon: 'mail-outline' },
  { key: 'drafts', icon: 'document-text-outline' },
  { key: 'spam', icon: 'warning-outline' },
  { key: 'trash', icon: 'trash-outline' },
];
const FILTERS = [{ key: 'all' }, { key: 'unread' }, { key: 'favorites' }];

const haptic = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};

const formatSize = (bytes) => {
  if (!bytes || bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
};

const isImageMime = (mime) => (mime || '').startsWith('image/');

// ---------------- Authed image loader ----------------
function useAuthedUri(url, token) {
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'web') { setUri(url); return () => { cancelled = true; }; }
    (async () => {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!cancelled) setUri(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [url, token]);
  return uri;
}

function AuthImage({ url, token, style, resizeMode, colors }) {
  const uri = useAuthedUri(url, token);
  if (!uri) {
    return (
      <View style={[style, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  const source = Platform.OS === 'web'
    ? { uri }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
  return <Image source={source} style={style} resizeMode={resizeMode || 'contain'} />;
}

// ---------------- Full-screen preview modal ----------------
function PreviewModal({ visible, attachment, token, onClose, colors }) {
  if (!visible || !attachment) return null;
  const url = `${API_URL}${attachment.url}`;
  const isImg = isImageMime(attachment.mime_type);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 12,
          }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', flex: 1, textAlign: 'center', fontWeight: '600' }} numberOfLines={1}>
              {attachment.filename}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            {isImg ? (
              <AuthImage
                url={url}
                token={token}
                resizeMode="contain"
                style={{ width: SCREEN_W - 32, height: '100%' }}
                colors={colors}
              />
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Ionicons name="document-text-outline" size={96} color="#94a3b8" />
                <Text style={{ color: '#e6edf7', marginTop: 12, fontWeight: '600' }}>
                  {attachment.filename}
                </Text>
                <Text style={{ color: '#94a3b8', marginTop: 4, fontSize: 12 }}>
                  {formatSize(attachment.size)}
                </Text>
              </View>
            )}
          </View>

          <Text style={{ color: '#94a3b8', textAlign: 'center', paddingBottom: 8, fontSize: 11 }}>
            Tap the download button in the message to save to your device
          </Text>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ---------------- Contacts picker ----------------
function ContactsPicker({ visible, onClose, onPick, colors }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setLoading(true); setError('');
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') { setError('Contacts permission denied.'); setLoading(false); return; }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
          sort: Contacts.SortTypes.FirstName,
        });
        const filtered = (data || []).map((c) => {
          const phone = c.phoneNumbers && c.phoneNumbers[0] && c.phoneNumbers[0].number;
          const email = c.emails && c.emails[0] && c.emails[0].email;
          return { id: c.id, name: c.name || '(no name)', contact: phone || email };
        }).filter((c) => c.contact);
        setContacts(filtered);
      } catch (e) { setError(e.message || 'Could not read contacts'); }
      finally { setLoading(false); }
    })();
  }, [visible]);

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '75%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Pick a contact</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          </View>
          {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />}
          {error ? <Text style={{ color: colors.danger, textAlign: 'center', padding: 20 }}>{error}</Text> : null}
          {!loading && !error && (
            <FlatList
              data={contacts}
              keyExtractor={(item) => String(item.id)}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.textMuted, padding: 20 }}>No contacts with phone or email.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  onPress={() => { haptic.light(); onPick(item.contact); onClose(); }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.name}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{item.contact}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [theme, setTheme] = useState('light');
  const [token, setToken] = useState(null);
  const [booting, setBooting] = useState(true);

  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState('');

  const [screen, setScreen] = useState('list');
  const [activeTab, setActiveTab] = useState('inbox');
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [attachQueue, setAttachQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showContactsPicker, setShowContactsPicker] = useState(false);

  const [me, setMe] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [profileLanguage, setProfileLanguage] = useState('en');
  const [showLangPicker, setShowLangPicker] = useState(false);

  const [previewAtt, setPreviewAtt] = useState(null);

  const [toasts, setToasts] = useState([]);

  const seenConvIds = useRef(new Set());
  const notifEnabled = useRef(false);
  const shareLockRef = useRef(false);

  const colors = theme === 'dark' ? DARK : LIGHT;
  const styles = createStyles(colors);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3000);
  }, []);

  const api = useCallback(async (path, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    let res;
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
    } catch { throw new Error(t('network_error')); }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch {
      throw new Error('Server returned an unexpected response.');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('theme');
        if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme);
        const savedLang = await AsyncStorage.getItem('language');
        const initialLang = savedLang || detectDeviceLanguage();
        setLanguage(initialLang);
        setProfileLanguage(initialLang);
        const savedToken = await AsyncStorage.getItem('token');
        if (savedToken) setToken(savedToken);
      } catch {}
      finally { setBooting(false); }
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        notifEnabled.current = finalStatus === 'granted';
      } catch { notifEnabled.current = false; }
    })();
  }, [token]);

  const toggleTheme = async () => {
    haptic.light();
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    await AsyncStorage.setItem('theme', next);
  };

  const loadMe = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/me');
      setMe(data);
      setProfileName(data.name || '');
      setProfileLanguage(data.language || 'en');
    } catch {}
  }, [token, api]);
  useEffect(() => { loadMe(); }, [loadMe]);

  const loadConversations = useCallback(async (opts = {}) => {
    if (!token) return;
    if (!opts.silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      else params.set('folder', activeTab === 'profile' ? 'inbox' : activeTab);
      const qs = params.toString();
      const data = await api(`/conversations${qs ? `?${qs}` : ''}`);
      const list = data.conversations || [];
      if (notifEnabled.current && seenConvIds.current.size > 0) {
        for (const c of list) {
          if (!seenConvIds.current.has(c.id) && !c.is_read) {
            try {
              await Notifications.scheduleNotificationAsync({
                content: { title: c.subject || 'New message', body: c.preview || '' },
                trigger: null,
              });
            } catch {}
          }
        }
      }
      seenConvIds.current = new Set(list.map((c) => c.id));
      setConversations(list);
    } catch (e) { if (!opts.silent) toast(e.message, 'error'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, activeTab, searchQuery, api, toast]);

  useEffect(() => {
    if (!token || activeTab === 'profile') return;
    loadConversations();
    const interval = setInterval(() => loadConversations({ silent: true }), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [token, activeTab, loadConversations]);

  useEffect(() => {
    if (!token || activeTab === 'profile') return;
    const timer = setTimeout(() => loadConversations(), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, token, activeTab, loadConversations]);

  const requestOtp = async () => {
    if (!phone) return setError('Please enter a phone number');
    haptic.light();
    setAuthLoading(true); setError(''); setDevOtp('');
    try {
      const data = await api('/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone }) });
      if (data.otp) setDevOtp(data.otp);
      setStep('otp'); setOtp('');
    } catch (e) { haptic.error(); setError(e.message); }
    setAuthLoading(false);
  };

  const verifyOtp = async () => {
    if (!otp) return setError('Please enter the OTP');
    setAuthLoading(true); setError('');
    try {
      let data;
      try { data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone, otp }) }); }
      catch (e) {
        if (e.message.toLowerCase().includes('not found')) {
          data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ phone, otp }) });
        } else throw e;
      }
      await AsyncStorage.setItem('token', data.token);
      setToken(data.token);
      haptic.success();
      toast(t('welcome'), 'success');
    } catch (e) { haptic.error(); setError(e.message); }
    setAuthLoading(false);
  };

  const logout = async () => {
    await AsyncStorage.removeItem('token');
    setToken(null); setStep('phone'); setPhone(''); setOtp(''); setDevOtp('');
    setMe(null); setConversations([]); setActiveTab('inbox');
    seenConvIds.current = new Set();
    toast(t('logged_out'), 'info');
  };

  const openConversation = async (conv) => {
    haptic.light();
    setSelectedConv(conv); setScreen('conversation');
    setLoadingMessages(true);
    try {
      const data = await api(`/conversations/${conv.id}/messages`);
      const msgs = data.messages || [];
      setMessages(msgs);
      const unreadIds = msgs.filter((m) => !m.is_read).map((m) => m.id);
      if (unreadIds.length > 0) {
        await Promise.all(unreadIds.map((id) =>
          api(`/messages/${id}/read`, { method: 'PATCH' }).catch(() => {})
        ));
        setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, is_read: true } : c)));
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoadingMessages(false); }
  };

  // ---------- Attachments ----------
  const pickAndUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) return;
      const file = res.assets[0];
      if (file.size && file.size > 10 * 1024 * 1024) {
        return toast('File too large (max 10 MB)', 'error');
      }

      setUploading(true);
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name || 'file',
        type: file.mimeType || 'application/octet-stream',
      });

      const response = await fetch(`${API_URL}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      setAttachQueue((prev) => [...prev, data.attachment]);
      haptic.success();
      toast(`Attached ${data.attachment.filename}`, 'success');
    } catch (e) {
      haptic.error();
      toast(e.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id) => {
    haptic.light();
    setAttachQueue((prev) => prev.filter((a) => a.id !== id));
  };

  // Download (save to device) — separate from preview
  const downloadAttachment = async (att) => {
    if (shareLockRef.current) return;
    shareLockRef.current = true;
    try {
      haptic.light();
      const safeName = (att.filename || 'file').replace(/[^\w.\-]/g, '_');

      if (Platform.OS === 'web') {
        const res = await fetch(`${API_URL}${att.url}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        // PDFs and images: open in new tab so the browser renders them
        const mime = att.mime_type || '';
        if (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('text/')) {
          window.open(blobUrl, '_blank');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          toast('Opened: ' + att.filename, 'success');
          return;
        }

        // Everything else: download
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = att.filename || safeName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        toast('Downloaded: ' + att.filename, 'success');
        return;
      }

      const fileUri = FileSystem.documentDirectory + safeName;
      const dl = await FileSystem.downloadAsync(
        `${API_URL}${att.url}`,
        fileUri,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (dl.status !== 200) throw new Error('Download failed');

      if (Platform.OS === 'android') {
        try {
          const contentUri = await FileSystem.getContentUriAsync(dl.uri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri, flags: 1, type: att.mime_type || '*/*',
          });
          toast('Opened: ' + att.filename, 'success');
          return;
        } catch (openErr) { /* fall through */ }
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, {
          dialogTitle: att.filename, mimeType: att.mime_type || undefined,
        });
      } else {
        toast('Saved: ' + att.filename, 'success');
      }
    } catch (e) {
      if (!String(e.message || '').includes('Another share request')) {
        haptic.error();
        toast(e.message || 'Download failed', 'error');
      }
    } finally {
      setTimeout(() => { shareLockRef.current = false; }, 800);
    }
  };

  const sendReply = async () => {
    if (!composeBody.trim() && attachQueue.length === 0) return;
    try {
      await api(`/messages/${selectedConv.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          body: composeBody || '(attachment)',
          attachmentIds: attachQueue.map((a) => a.id),
        }),
      });
      setComposeBody(''); setAttachQueue([]);
      haptic.success();
      toast(t('reply_sent'), 'success');
      openConversation(selectedConv);
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const sendMessage = async () => {
    if (!composeTo || !composeSubject || (!composeBody && attachQueue.length === 0)) {
      haptic.error();
      return toast(t('fill_fields'), 'error');
    }
    try {
      await api('/messages', {
        method: 'POST',
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody || '(attachment)',
          attachmentIds: attachQueue.map((a) => a.id),
        }),
      });
      setComposeTo(''); setComposeSubject(''); setComposeBody(''); setAttachQueue([]);
      setScreen('list');
      haptic.success();
      toast(t('message_sent'), 'success');
      loadConversations();
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const deleteMessage = async (conversationId) => {
    try {
      await api(`/conversations/${conversationId}`, { method: 'DELETE' });
      haptic.medium();
      toast(t('conversation_deleted'), 'success');
      loadConversations();
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const restoreConversation = async (convId) => {
    try {
      await api(`/conversations/${convId}/folder`, {
        method: 'PATCH', body: JSON.stringify({ folder: 'inbox' }),
      });
      haptic.success();
      toast(t('conversation_restored'), 'success');
      loadConversations();
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const permanentDelete = async (convId) => {
    try {
      await api(`/conversations/${convId}/permanent`, { method: 'DELETE' });
      haptic.medium();
      toast(t('conversation_deleted_permanently'), 'success');
      loadConversations();
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const confirmDelete = (convId) => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(`${t('delete_conversation')}\n\n${t('delete_confirm')}`);
      if (ok) deleteMessage(convId);
      return;
    }
    Alert.alert(t('delete_conversation'), t('delete_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => deleteMessage(convId) },
    ]);
  };

  const confirmPermanentDelete = (convId) => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(`${t('delete_permanently')}\n\n${t('delete_permanent_confirm')}`);
      if (ok) permanentDelete(convId);
      return;
    }
    Alert.alert(t('delete_permanently'), t('delete_permanent_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => permanentDelete(convId) },
    ]);
  };

  const markAllRead = async () => {
    try {
      await api('/conversations/mark-all-read', { method: 'PATCH' });
      haptic.medium();
      toast(t('all_marked_read'), 'success');
      loadConversations();
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveProfile = async () => {
    try {
      await api('/me', { method: 'PATCH', body: JSON.stringify({ name: profileName, language: profileLanguage }) });
      await AsyncStorage.setItem('language', profileLanguage);
      setLanguage(profileLanguage);
      haptic.success();
      toast(t('profile_saved'), 'success');
      loadMe();
    } catch (e) { haptic.error(); toast(e.message, 'error'); }
  };

  const onPickLanguage = async (code) => {
    setProfileLanguage(code);
    setLanguage(code);
    await AsyncStorage.setItem('language', code);
  };

  const filtered = conversations.filter((c) => {
    if (activeFilter === 'unread') return !c.is_read;
    if (activeFilter === 'favorites') return c.is_favorite;
    return true;
  });

  const ToastLayer = () => (
    <View style={styles.toastContainer} pointerEvents="box-none">
      {toasts.map((tt) => (
        <TouchableOpacity
          key={tt.id} activeOpacity={0.9}
          onPress={() => setToasts((prev) => prev.filter((x) => x.id !== tt.id))}
          style={[styles.toast, { backgroundColor: colors.surface, borderColor: colors.border },
            tt.type === 'error' && { borderColor: colors.danger },
            tt.type === 'success' && { borderColor: colors.success }]}
        >
          <Text style={{ fontWeight: '800', color: tt.type === 'error' ? colors.danger : colors.success }}>
            {tt.type === 'error' ? '✕' : tt.type === 'success' ? '✓' : 'ℹ'}
          </Text>
          <Text style={{ color: colors.text, flex: 1 }}>{tt.message}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // Chip for non-image attachments (with download button)
  const AttachmentChip = ({ att, removable }) => (
    <View style={[styles.attachChip, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
        onPress={() => downloadAttachment(att)}
      >
        <Ionicons name="document-text-outline" size={16} color={colors.primary} />
        <Text style={[styles.attachChipName, { color: colors.text }]} numberOfLines={1}>
          {att.filename}
        </Text>
        <Text style={[styles.attachChipSize, { color: colors.textDim }]}>
          {formatSize(att.size)}
        </Text>
      </TouchableOpacity>
      {removable ? (
        <TouchableOpacity onPress={() => removeAttachment(att.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={18} color={colors.danger} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => downloadAttachment(att)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );

  // Image block — shows image, tap = full-screen preview, small download button overlay
  const ImageAttachment = ({ att }) => (
    <View style={{ position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
      <TouchableOpacity
        onPress={() => { haptic.light(); setPreviewAtt(att); }}
        activeOpacity={0.9}
      >
        <AuthImage
          url={`${API_URL}${att.url}`}
          token={token}
          resizeMode="contain"
          style={{
            width: '100%',
            height: 300,
            backgroundColor: colors.surface2,
          }}
          colors={colors}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={{
          position: 'absolute', bottom: 8, right: 8,
          backgroundColor: 'rgba(0,0,0,0.6)',
          width: 36, height: 36, borderRadius: 18,
          alignItems: 'center', justifyContent: 'center',
        }}
        onPress={() => downloadAttachment(att)}
      >
        <Ionicons name="download-outline" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  if (booting) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ---------- AUTH ----------
  if (!token) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.authScroll} showsVerticalScrollIndicator={false}>
            <TouchableOpacity style={styles.langBtnTop} onPress={() => setShowLangPicker(true)}>
              <Ionicons name="globe-outline" size={16} color={colors.primary} />
              <Text style={[styles.langBtnText, { color: colors.primary }]}>
                {(LANGUAGES.find((l) => l.code === profileLanguage) || LANGUAGES[0]).native}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.langBtnTop, { right: 70 }]} onPress={toggleTheme}>
              <Ionicons name={theme === 'light' ? 'moon-outline' : 'sunny-outline'} size={16} color={colors.primary} />
            </TouchableOpacity>

            <View style={styles.logoContainer}>
              <View style={[styles.logoCircleOuter, { borderColor: colors.border }]}>
                <View style={[styles.logoCircleInner, { borderColor: colors.border }]}>
                  <View style={[styles.logoBox, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name="mail" size={32} color={colors.primary} />
                    <Ionicons name="phone-portrait-outline" size={20} color={colors.primary} style={styles.logoPhoneIcon} />
                  </View>
                </View>
              </View>
              <Text style={[styles.logoText, { color: colors.text }]}>{t('app_name')}</Text>
            </View>

            <Text style={[styles.title, { color: colors.text }]}>
              {step === 'phone' ? t('tagline') : t('otp_sent_to', { phone })}
            </Text>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.dangerSoft }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              </View>
            ) : null}

            {step === 'phone' ? (
              <>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="sparkles" size={16} color={colors.primary} />
                    <Text style={[styles.cardHeaderText, { color: colors.primary }]}>{t('auto_detected')}</Text>
                  </View>
                  <View style={[styles.inputRow, { borderColor: colors.border }]}>
                    <Text style={[styles.countryCode, { color: colors.text }]}>+91</Text>
                    <View style={[styles.inputDivider, { backgroundColor: colors.border }]} />
                    <TextInput
                      style={[styles.phoneInput, { color: colors.text }]}
                      placeholder="98765 43210" placeholderTextColor={colors.textDim}
                      value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                    />
                    <Ionicons name="pencil" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.cardHelper}>
                    <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    <Text style={[styles.cardHelperText, { color: colors.textMuted }]}>{t('helper_edit')}</Text>
                  </View>
                </View>
                <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={requestOtp} disabled={authLoading}>
                  {authLoading ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Text style={styles.primaryButtonText}>{t('send_otp')}</Text>
                      <Ionicons name="arrow-forward" size={20} color="#fff" style={styles.buttonIcon} />
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="keypad" size={16} color={colors.primary} />
                    <Text style={[styles.cardHeaderText, { color: colors.primary }]}>{t('otp_sent_to', { phone })}</Text>
                  </View>
                  <View style={[styles.inputRow, { borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.otpInput, { color: colors.text }]}
                      placeholder="000000" placeholderTextColor={colors.textDim}
                      value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6}
                    />
                  </View>
                  {devOtp ? (
                    <View style={[styles.devOtpBox, { backgroundColor: colors.successBg }]}>
                      <Ionicons name="code-working" size={16} color={colors.success} />
                      <Text style={[styles.devOtpText, { color: colors.success }]}>{t('dev_otp')}: {devOtp}</Text>
                    </View>
                  ) : null}
                </View>
                <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={verifyOtp} disabled={authLoading}>
                  {authLoading ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Text style={styles.primaryButtonText}>{t('verify_open')}</Text>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" style={styles.buttonIcon} />
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setStep('phone'); setError(''); }}>
                  <Text style={[styles.linkText, { color: colors.primary }]}>{t('use_another')}</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={styles.footer}>
              <Ionicons name="shield-checkmark" size={16} color={colors.textMuted} />
              <Text style={[styles.footerText, { color: colors.textMuted }]}>{t('footer_security')}</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        <LanguagePicker
          visible={showLangPicker} current={profileLanguage}
          onClose={() => setShowLangPicker(false)} onSelect={onPickLanguage}
        />
      </SafeAreaView>
    );
  }

  // ---------- COMPOSE ----------
  if (screen === 'compose') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => { setScreen('list'); setAttachQueue([]); }}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{t('compose')}</Text>
            <TouchableOpacity onPress={sendMessage}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('send')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, paddingRight: 48 }]}
                placeholder={t('to')} placeholderTextColor={colors.textDim}
                value={composeTo} onChangeText={setComposeTo} autoCapitalize="none"
              />
              <TouchableOpacity
                style={{ position: 'absolute', right: 12, top: 14 }}
                onPress={() => { haptic.light(); setShowContactsPicker(true); }}
              >
                <Ionicons name="people-circle-outline" size={26} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder={t('subject')} placeholderTextColor={colors.textDim}
              value={composeSubject} onChangeText={setComposeSubject}
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, height: 180 }]}
              placeholder={t('message_placeholder')} placeholderTextColor={colors.textDim}
              value={composeBody} onChangeText={setComposeBody}
              multiline textAlignVertical="top"
            />

            {attachQueue.length > 0 && (
              <View style={{ marginBottom: 12, gap: 6 }}>
                {attachQueue.map((a) => (
                  <AttachmentChip key={a.id} att={a} removable />
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={pickAndUpload} disabled={uploading}
            >
              {uploading ? <ActivityIndicator color={colors.primary} /> : (
                <>
                  <Ionicons name="attach" size={20} color={colors.primary} />
                  <Text style={[styles.secondaryButtonText, { color: colors.primary, marginLeft: 6 }]}>
                    Attach file
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
        <ContactsPicker
          visible={showContactsPicker}
          onClose={() => setShowContactsPicker(false)}
          onPick={(v) => setComposeTo(v)}
          colors={colors}
        />
        <ToastLayer />
      </SafeAreaView>
    );
  }

  // ---------- CONVERSATION ----------
  if (screen === 'conversation') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => { setScreen('list'); setAttachQueue([]); setComposeBody(''); }}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('back')}</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {selectedConv?.subject || 'Conversation'}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {loadingMessages ? (
            <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {messages.map((m) => (
                <View key={m.id} style={[styles.messageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.messageMeta}>
                    <Text style={[styles.messageFrom, { color: colors.primary }]}>
                      {m.sender_id ? t('you') : t('external')}
                    </Text>
                    <Text style={[styles.messageTime, { color: colors.textDim }]}>
                      {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                    </Text>
                  </View>
                  <Text style={[styles.messageBody, { color: colors.text }]}>{m.body}</Text>

                  {m.attachments && m.attachments.length > 0 && (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {m.attachments.map((a) => (
                        isImageMime(a.mime_type)
                          ? <ImageAttachment key={a.id} att={a} />
                          : <AttachmentChip key={a.id} att={a} />
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {attachQueue.length > 0 && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
              {attachQueue.map((a) => (
                <AttachmentChip key={a.id} att={a} removable />
              ))}
            </View>
          )}

          <View style={[styles.replyContainer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.attachIconBtn, { borderColor: colors.border }]}
              onPress={pickAndUpload} disabled={uploading}
            >
              {uploading ? <ActivityIndicator color={colors.primary} size="small" /> : (
                <Ionicons name="attach" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
            <TextInput
              style={[styles.replyInput, { backgroundColor: colors.surface2, color: colors.text }]}
              placeholder={t('reply')} placeholderTextColor={colors.textDim}
              value={composeBody} onChangeText={setComposeBody}
            />
            <TouchableOpacity style={[styles.replyButton, { backgroundColor: colors.primary }]} onPress={sendReply}>
              <Ionicons name="send" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        <PreviewModal
          visible={!!previewAtt}
          attachment={previewAtt}
          token={token}
          onClose={() => setPreviewAtt(null)}
          colors={colors}
        />
        <ToastLayer />
      </SafeAreaView>
    );
  }

  // ---------- PROFILE ----------
  if (activeTab === 'profile') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('profile_settings')}</Text>
          <TouchableOpacity onPress={toggleTheme}>
            <Ionicons name={theme === 'light' ? 'moon-outline' : 'sunny-outline'} size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          <View style={[styles.avatarLarge, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{(me?.phone || 'P').replace(/[^\d]/g, '').slice(-2)}</Text>
          </View>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('phone_number')}</Text>
          <Text style={[styles.fieldValue, { color: colors.text }]}>{me?.phone || '-'}</Text>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('phonemail_address')}</Text>
          <Text style={[styles.fieldValue, { color: colors.text }]}>{me?.phonemail_address || '-'}</Text>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('display_name')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={profileName} onChangeText={setProfileName}
            placeholder={t('your_name')} placeholderTextColor={colors.textDim}
          />
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{t('language')}</Text>
          <TouchableOpacity
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
            onPress={() => setShowLangPicker(true)}
          >
            <Text style={{ color: colors.text, fontSize: 15 }}>
              {(LANGUAGES.find((l) => l.code === profileLanguage) || LANGUAGES[0]).native}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary, marginTop: 24 }]} onPress={saveProfile}>
            <Text style={styles.primaryButtonText}>{t('save_changes')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerButton, { borderColor: colors.dangerSoft, marginTop: 12 }]} onPress={logout}>
            <Text style={[styles.dangerButtonText, { color: colors.danger }]}>{t('logout')}</Text>
          </TouchableOpacity>
        </ScrollView>
        <View style={[styles.tabBar, { backgroundColor: colors.tabBar, borderTopColor: colors.border }]}>
          {FOLDERS.map((f) => (
            <TouchableOpacity key={f.key} style={styles.tabItem}
              onPress={() => { haptic.light(); setActiveTab(f.key); setSearchQuery(''); setActiveFilter('all'); }}>
              <Ionicons name={f.icon} size={22} color={colors.tabInactive} />
              <Text style={[styles.tabLabel, { color: colors.tabInactive }]}>{t(f.key)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('profile')}>
            <Ionicons name="person-outline" size={22} color={colors.primary} />
            <Text style={[styles.tabLabel, { color: colors.primary }]}>{t('profile')}</Text>
          </TouchableOpacity>
        </View>
        <ToastLayer />
        <LanguagePicker
          visible={showLangPicker} current={profileLanguage}
          onClose={() => setShowLangPicker(false)} onSelect={onPickLanguage}
        />
      </SafeAreaView>
    );
  }

  // ---------- MAIN LIST ----------
  const folderLabel = t(activeTab);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{folderLabel}</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Ionicons name="checkmark-done-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t('search_placeholder')} placeholderTextColor={colors.textDim}
            value={searchQuery} onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f.key}
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border },
              activeFilter === f.key && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => { haptic.light(); setActiveFilter(f.key); }}>
            <Text style={[styles.chipText, { color: colors.textMuted }, activeFilter === f.key && { color: '#fff' }]}>
              {t(f.key)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && conversations.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          {[1, 2, 3, 4].map((k) => (
            <View key={k} style={[styles.convCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.skeletonLine, { width: '40%', backgroundColor: colors.skeleton }]} />
              <View style={[styles.skeletonLine, { width: '80%', backgroundColor: colors.skeleton, marginTop: 8 }]} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadConversations(); }}
              tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {searchQuery ? t('no_matches', { q: searchQuery }) : t('nothing_here')}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.convCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.convBody}
                onPress={() => openConversation(item)}
                onLongPress={() => {
                  haptic.medium();
                  if (activeTab === 'trash') confirmPermanentDelete(item.id);
                  else confirmDelete(item.id);
                }}
                delayLongPress={500}
              >
                <View style={styles.convHeader}>
                  <Text style={[styles.convContact, { color: colors.text }]} numberOfLines={1}>
                    {item.contact || t('unknown')}
                    {!item.is_read && <Text style={{ color: colors.primary }}>{'  ●'}</Text>}
                  </Text>
                  <Text style={[styles.convDate, { color: colors.textDim }]}>
                    {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : ''}
                  </Text>
                </View>
                <Text style={[styles.convSubject, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.subject}
                </Text>
                <Text style={[styles.convPreview, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.preview}
                </Text>
              </TouchableOpacity>
              {activeTab === 'trash' ? (
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={styles.rowDeleteBtn}
                    onPress={() => { haptic.light(); restoreConversation(item.id); }}>
                    <Ionicons name="arrow-undo-outline" size={20} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rowDeleteBtn}
                    onPress={() => { haptic.light(); confirmPermanentDelete(item.id); }}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.rowDeleteBtn}
                  onPress={() => { haptic.light(); confirmDelete(item.id); }}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => {
          haptic.medium();
          setComposeTo(''); setComposeSubject(''); setComposeBody(''); setAttachQueue([]);
          setScreen('compose');
        }}
      >
        <Ionicons name="create-outline" size={26} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.tabBar, { backgroundColor: colors.tabBar, borderTopColor: colors.border }]}>
        {FOLDERS.map((f) => (
          <TouchableOpacity key={f.key} style={styles.tabItem}
            onPress={() => { haptic.light(); setActiveTab(f.key); setSearchQuery(''); setActiveFilter('all'); }}>
            <Ionicons name={f.icon} size={22} color={activeTab === f.key ? colors.primary : colors.tabInactive} />
            <Text style={[styles.tabLabel, { color: activeTab === f.key ? colors.primary : colors.tabInactive }]}>
              {t(f.key)}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.tabItem} onPress={() => { haptic.light(); setActiveTab('profile'); }}>
          <Ionicons name="person-outline" size={22} color={colors.tabInactive} />
          <Text style={[styles.tabLabel, { color: colors.tabInactive }]}>{t('profile')}</Text>
        </TouchableOpacity>
      </View>

      <ToastLayer />
    </SafeAreaView>
  );
}

function createStyles(c) {
  return StyleSheet.create({
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    authScroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
    langBtnTop: { position: 'absolute', top: 16, right: 16, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primarySoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
    langBtnText: { fontWeight: '700', fontSize: 13 },
    logoContainer: { alignItems: 'center', marginBottom: 30 },
    logoCircleOuter: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    logoCircleInner: { width: 90, height: 90, borderRadius: 45, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    logoBox: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    logoPhoneIcon: { position: 'absolute', bottom: 8, right: 8 },
    logoText: { fontSize: 28, fontWeight: '800' },
    title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
    card: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 24 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    cardHeaderText: { fontSize: 13, fontWeight: '600', flex: 1 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 12 },
    countryCode: { fontSize: 16, fontWeight: '600' },
    inputDivider: { width: 1, height: 24, marginHorizontal: 12 },
    phoneInput: { flex: 1, fontSize: 16, letterSpacing: 1 },
    otpInput: { flex: 1, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
    cardHelper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardHelperText: { fontSize: 12, flex: 1 },
    devOtpBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 8, marginTop: 8 },
    devOtpText: { fontWeight: '700', fontSize: 16 },
    primaryButton: { borderRadius: 14, height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    buttonIcon: { marginLeft: 8 },
    linkText: { textAlign: 'center', fontSize: 14, fontWeight: '600', marginTop: 8 },
    secondaryButton: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    secondaryButtonText: { fontSize: 15, fontWeight: '600' },
    errorBox: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 8, marginBottom: 16, gap: 8 },
    errorText: { fontSize: 14, flex: 1 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 30, gap: 8, paddingHorizontal: 20 },
    footerText: { fontSize: 12, textAlign: 'center', flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
    headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderWidth: 1, borderRadius: 12 },
    searchInput: { flex: 1, fontSize: 15 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, height: 36, alignSelf: 'flex-start', justifyContent: 'center' },
    chipText: { fontSize: 13, fontWeight: '600' },
    convCard: { borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    convBody: { flex: 1 },
    rowDeleteBtn: { padding: 8 },
    convHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    convContact: { fontWeight: '700', fontSize: 15, flex: 1 },
    convDate: { fontSize: 12 },
    convSubject: { fontWeight: '600', marginBottom: 4 },
    convPreview: { fontSize: 13 },
    emptyText: { textAlign: 'center', padding: 40, fontSize: 14 },
    messageCard: { padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
    messageMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    messageFrom: { fontWeight: '700' },
    messageTime: { fontSize: 12 },
    messageBody: { lineHeight: 22 },
    replyContainer: { flexDirection: 'row', padding: 12, borderTopWidth: 1, alignItems: 'center', gap: 8 },
    replyInput: { flex: 1, borderRadius: 22, paddingHorizontal: 16, height: 44 },
    replyButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    attachIconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12 },
    fab: { position: 'absolute', right: 20, bottom: 90, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    tabBar: { flexDirection: 'row', paddingVertical: 8, paddingBottom: 24, borderTopWidth: 1, position: 'absolute', bottom: 0, left: 0, right: 0 },
    tabItem: { flex: 1, alignItems: 'center', gap: 2 },
    tabLabel: { fontSize: 10, fontWeight: '600' },
    avatarLarge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    avatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
    fieldLabel: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
    fieldValue: { fontSize: 15 },
    dangerButton: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center' },
    dangerButtonText: { fontWeight: '700' },
    skeletonLine: { height: 12, borderRadius: 6 },
    toastContainer: { position: 'absolute', top: 60, left: 20, right: 20, gap: 8, zIndex: 100 },
    toast: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    attachChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', maxWidth: '100%' },
    attachChipName: { fontSize: 13, fontWeight: '600', maxWidth: 180 },
    attachChipSize: { fontSize: 11 },
  });
}
