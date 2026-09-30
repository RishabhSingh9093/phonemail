import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import {
  LANGUAGES, getInitialLanguage, translate, detectLanguageFromCoords,
} from './i18n';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const FOLDERS = [
  { key: 'inbox', icon: '📥' },
  { key: 'drafts', icon: '📝' },
  { key: 'spam', icon: '⚠' },
  { key: 'trash', icon: '🗑' },
];

const FILTERS = [
  { key: 'all' },
  { key: 'unread' },
  { key: 'favorites' },
  { key: 'attachments' },
];

const isImageMime = (mime) => (mime || '').startsWith('image/');

const formatSize = (bytes) => {
  if (!bytes || bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
};

function Skeleton() {
  return (
    <div className="conversation skeleton">
      <div className="skeleton-body">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-preview" />
      </div>
    </div>
  );
}

function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type || 'info'}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-icon">
            {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [error, setError] = useState('');

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [lang, setLang] = useState(getInitialLanguage());
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedConv, setSelectedConv] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [activeFilter, setActiveFilter] = useState('all');

  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [attachQueue, setAttachQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const [me, setMe] = useState(null);
  const [profileName, setProfileName] = useState('');

  const [toasts, setToasts] = useState([]);
  const [previewAtt, setPreviewAtt] = useState(null);
  const fileInputRef = useRef(null);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('language', lang);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3000);
  }, []);

  const dismissToast = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const api = async (path, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    let res;
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        cache: 'no-store',
      });
    } catch {
      throw new Error(t('network_error'));
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  // ---------- Auth ----------
  const requestOtp = async () => {
    try {
      setError('');
      const data = await api('/auth/request-otp', {
        method: 'POST', body: JSON.stringify({ phone }),
      });
      if (data.otp) setDevOtp(data.otp);
      setStep('otp');
    } catch (e) { setError(e.message); }
  };

  const verifyOtp = async () => {
    try {
      setError('');
      let data;
      try {
        data = await api('/auth/login', {
          method: 'POST', body: JSON.stringify({ phone, otp }),
        });
      } catch (e) {
        if (e.message.toLowerCase().includes('not found')) {
          data = await api('/auth/register', {
            method: 'POST', body: JSON.stringify({ phone, otp }),
          });
        } else throw e;
      }
      localStorage.setItem('token', data.token);
      setToken(data.token);
      toast(t('welcome'), 'success');
    } catch (e) { setError(e.message); }
  };

  // ---------- Me ----------
  const loadMe = useCallback(async () => {
    try {
      const data = await api('/me');
      setMe(data);
      setProfileName(data.name || '');
    } catch {}
  }, [token, lang]);

  useEffect(() => { if (token) loadMe(); }, [token, loadMe]);

  // ---------- Conversations ----------
  const loadConversations = useCallback(async (query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      else params.set('folder', activeFolder);
      const qs = params.toString();
      const data = await api(`/conversations${qs ? `?${qs}` : ''}`);
      setConversations(data.conversations || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [token, activeFolder]);

  useEffect(() => {
    if (!token) return;
    loadConversations();
    const interval = setInterval(() => loadConversations(), 5000);
    return () => clearInterval(interval);
  }, [token, loadConversations]);

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => loadConversations(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, token, loadConversations]);

  const openConversation = async (conv) => {
    setSelectedConv(conv);
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
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, is_read: true } : c))
        );
      }
    } catch (e) { setError(e.message); }
    finally { setLoadingMessages(false); }
  };

  // ---------- Attachments ----------
  const handleFileSelect = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('File too large (max 10 MB)', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setAttachQueue((prev) => [...prev, data.attachment]);
      toast(`Attached ${data.attachment.filename}`, 'success');
    } catch (err) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id) => {
    setAttachQueue((prev) => prev.filter((a) => a.id !== id));
  };

  const downloadAttachment = async (att) => {
    try {
      const res = await fetch(`${API_URL}${att.url}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ---------- Send ----------
  const sendMessage = async () => {
    if (!composeTo || !composeSubject || !composeBody) {
      toast(t('fill_fields'), 'error');
      return;
    }
    try {
      await api('/messages', {
        method: 'POST',
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody,
          attachmentIds: attachQueue.map((a) => a.id),
        }),
      });
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setAttachQueue([]);
      setShowCompose(false);
      toast(t('message_sent'), 'success');
      loadConversations();
    } catch (e) { toast(e.message, 'error'); }
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
      setComposeBody('');
      setAttachQueue([]);
      toast(t('reply_sent'), 'success');
      openConversation(selectedConv);
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- Conversation actions ----------
  const markAllRead = async () => {
    try {
      await api('/conversations/mark-all-read', { method: 'PATCH' });
      toast(t('all_marked_read'), 'success');
      loadConversations(searchQuery);
    } catch (e) { toast(e.message, 'error'); }
  };

  const deleteMessage = async (convId) => {
    if (!window.confirm(`${t('delete_conversation')}\n\n${t('delete_confirm')}`)) return;
    try {
      await api(`/conversations/${convId}`, { method: 'DELETE' });
      toast(t('conversation_deleted'), 'success');
      loadConversations(searchQuery);
    } catch (e) { toast(e.message, 'error'); }
  };

  const restoreConversation = async (convId) => {
    try {
      await api(`/conversations/${convId}/folder`, {
        method: 'PATCH', body: JSON.stringify({ folder: 'inbox' }),
      });
      toast(t('conversation_restored') || 'Restored to Inbox', 'success');
      loadConversations(searchQuery);
    } catch (e) { toast(e.message, 'error'); }
  };

  const permanentDelete = async (convId) => {
    if (!window.confirm(`${t('delete_permanently') || 'Delete permanently?'}\n\n${t('delete_permanent_confirm') || 'This cannot be undone.'}`)) return;
    try {
      await api(`/conversations/${convId}/permanent`, { method: 'DELETE' });
      toast(t('conversation_deleted_permanently') || 'Deleted permanently', 'success');
      loadConversations(searchQuery);
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- Profile ----------
  const saveProfile = async () => {
    try {
      await api('/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: profileName, language: lang }),
      });
      toast(t('profile_saved'), 'success');
      loadMe();
    } catch (e) { toast(e.message, 'error'); }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setStep('phone');
    setPhone(''); setOtp(''); setDevOtp(''); setMe(null);
    toast(t('logged_out'), 'info');
  };

  const openProfile = () => {
    setShowProfile(true);
    setShowCompose(false);
    setSelectedConv(null);
  };

  const detectFromLocation = () => {
    if (!navigator.geolocation) {
      toast('Geolocation not supported', 'error');
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const detected = detectLanguageFromCoords(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
        if (detected) {
          setLang(detected);
          setShowLangPicker(false);
          toast(`Language set to ${LANGUAGES.find((l) => l.code === detected).label}`, 'success');
        } else {
          toast('Could not detect language from your location', 'error');
        }
      },
      () => { setDetecting(false); toast('Location access denied', 'error'); },
      { timeout: 10000 }
    );
  };

  const filtered = conversations.filter((c) => {
    if (activeFilter === 'unread') return !c.is_read;
    if (activeFilter === 'favorites') return c.is_favorite;
    if (activeFilter === 'attachments') return true;
    return true;
  });

  const currentLangLabel = useMemo(
    () => (LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0]).label,
    [lang]
  );

  // ---------------- AUTH ----------------
  if (!token) {
    return (
      <>
        <Toast toasts={toasts} onDismiss={dismissToast} />
        <div className="auth-container">
          <div className="auth-top-actions">
            <button className="lang-btn" onClick={() => setShowLangPicker(true)} title={t('language')}>
              🌐 {currentLangLabel}
            </button>
            <button className="theme-toggle-auth" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
          <h1>{t('app_name')}</h1>
          <p className="auth-tagline">{t('tagline')}</p>
          {error && <div className="error">{error}</div>}
          {step === 'phone' ? (
            <>
              <input placeholder={t('use_another_number_ph')} value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button onClick={requestOtp}>{t('continue')}</button>
              <p className="terms">{t('terms')}</p>
            </>
          ) : (
            <>
              <input placeholder={t('otp_placeholder')} value={otp} onChange={(e) => setOtp(e.target.value)} />
              {devOtp && <p className="dev-otp">{t('dev_otp')}: {devOtp}</p>}
              <button onClick={verifyOtp}>{t('verify_open')}</button>
              <button className="link" onClick={() => setStep('phone')}>{t('use_another')}</button>
            </>
          )}
        </div>
        <LanguagePicker
          visible={showLangPicker} current={lang} onClose={() => setShowLangPicker(false)}
          onSelect={(code) => { setLang(code); setShowLangPicker(false); }}
          onDetect={detectFromLocation} detecting={detecting} t={t}
        />
      </>
    );
  }

  // ---------------- APP ----------------
  return (
    <>
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <div className="app-container">
        <aside className="sidebar">
          <div className="brand-row">
            <h2 className="brand">{t('app_name')}</h2>
            <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>

          <button className="compose-btn" onClick={() => {
            setShowCompose(true); setSelectedConv(null); setShowProfile(false);
            setAttachQueue([]);
          }}>
            ✎ {t('compose_short')}
          </button>

          <nav>
            <div className="sidebar-section">
              {FOLDERS.map((f) => (
                <button key={f.key}
                  className={`nav-item ${activeFolder === f.key && !showCompose && !showProfile ? 'active' : ''}`}
                  onClick={() => {
                    setActiveFolder(f.key); setActiveFilter('all');
                    setSelectedConv(null); setShowCompose(false); setShowProfile(false);
                    setSearchQuery('');
                  }}>
                  <span className="nav-icon">{f.icon}</span>
                  <span>{t(f.key)}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              {FILTERS.map((f) => (
                <button key={f.key}
                  className={`nav-item ${activeFilter === f.key && !showProfile ? 'active' : ''}`}
                  onClick={() => {
                    setActiveFilter(f.key); setSelectedConv(null);
                    setShowCompose(false); setShowProfile(false);
                  }}>
                  <span className="nav-icon">•</span>
                  <span>{t(f.key)}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <button className={`nav-item ${showProfile ? 'active' : ''}`} onClick={openProfile}>
                <span className="nav-icon">👤</span>
                <span>{t('profile')}</span>
              </button>
            </div>
          </nav>
          <button className="logout-btn" onClick={logout}>{t('logout')}</button>
        </aside>

        <main className="main">
          {error && <div className="error">{error}</div>}

          {showProfile ? (
            <div className="profile-view">
              <h3>{t('profile_settings')}</h3>
              <div className="avatar-large">{(me?.phone || 'P').replace(/[^\d]/g, '').slice(-2)}</div>
              <div className="profile-field">
                <label>{t('phone_number')}</label>
                <input value={me?.phone || ''} readOnly />
              </div>
              <div className="profile-field">
                <label>{t('phonemail_address')}</label>
                <input value={me?.phonemail_address || ''} readOnly />
              </div>
              <div className="profile-field">
                <label>{t('display_name')}</label>
                <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t('your_name')} />
              </div>
              <div className="profile-field">
                <label>{t('language')}</label>
                <button className="lang-select-btn" onClick={() => setShowLangPicker(true)}>
                  {currentLangLabel}
                </button>
              </div>
              <div className="profile-actions">
                <button className="primary" onClick={saveProfile}>{t('save_changes')}</button>
              </div>
            </div>
          ) : showCompose ? (
            <div className="compose-view">
              <h3>{t('compose_title')}</h3>
              <input placeholder={t('to')} value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
              <input placeholder={t('subject')} value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              <textarea placeholder={t('message_placeholder')} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />

              {attachQueue.length > 0 && (
                <div className="attach-list">
                  {attachQueue.map((a) => (
                    <div key={a.id} className="attach-chip">
                      <span className="attach-name">📎 {a.filename}</span>
                      <span className="attach-size">{formatSize(a.size)}</span>
                      <button className="attach-remove" onClick={() => removeAttachment(a.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />

              <div className="compose-actions">
                <button className="primary" onClick={sendMessage}>{t('send')}</button>
                <button className="secondary" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : '📎 Attach file'}
                </button>
                <button className="secondary" onClick={() => { setShowCompose(false); setAttachQueue([]); }}>{t('cancel')}</button>
              </div>
            </div>
          ) : selectedConv ? (
            <div className="conversation-view">
              <button className="back-btn" onClick={() => setSelectedConv(null)}>← {t('back')}</button>
              <h3>{selectedConv.subject}</h3>
              {loadingMessages ? (
                <>
                  <div className="message skeleton"><div className="skeleton-line skeleton-title" /><div className="skeleton-line skeleton-preview" /></div>
                  <div className="message skeleton"><div className="skeleton-line skeleton-title" /><div className="skeleton-line skeleton-preview" /></div>
                </>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="message">
                    <div className="message-meta">
                      <strong>{m.sender_id ? t('you') : t('external')}</strong>
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="attach-list">
                        {m.attachments.map((a) => (
                          <div key={a.id} className="attach-chip attach-download">
                            <span
                              className="attach-name"
                              onClick={() => setPreviewAtt(a)}
                              style={{ cursor: 'pointer' }}
                            >
                              📎 {a.filename}
                            </span>
                            <span className="attach-size">{formatSize(a.size)}</span>
                            <button
                              className="attach-icon-btn"
                              title="Preview"
                              onClick={() => setPreviewAtt(a)}
                            >
                              👁
                            </button>
                            <button
                              className="attach-icon-btn"
                              title="Download"
                              onClick={() => downloadAttachment(a)}
                            >
                              ↓
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {attachQueue.length > 0 && (
                <div className="attach-list">
                  {attachQueue.map((a) => (
                    <div key={a.id} className="attach-chip">
                      <span className="attach-name">📎 {a.filename}</span>
                      <span className="attach-size">{formatSize(a.size)}</span>
                      <button className="attach-remove" onClick={() => removeAttachment(a.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />

              <div className="reply-box">
                <textarea placeholder={t('reply_placeholder')} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
                <div className="compose-actions">
                  <button className="primary" onClick={sendReply}>{t('send_reply')}</button>
                  <button className="secondary" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={uploading}>
                    {uploading ? 'Uploading…' : '📎 Attach'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mailbox">
              <div className="mailbox-header">
                <h3>{t(activeFolder)}</h3>
                <button className="text-btn" onClick={markAllRead}>{t('mark_all_read')}</button>
              </div>

              <input type="text" className="search-input"
                placeholder={t('search_placeholder')}
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

              {loading && conversations.length === 0 ? (
                <>
                  <Skeleton /><Skeleton /><Skeleton /><Skeleton />
                </>
              ) : (
                <>
                  {filtered.length === 0 && (
                    <p className="empty-state">
                      {searchQuery ? t('no_matches', { q: searchQuery }) : t('nothing_here')}
                    </p>
                  )}
                  {filtered.map((c) => (
                    <div key={c.id} className="conversation">
                      <div className="conv-body" onClick={() => openConversation(c)}>
                        <div className="conv-title">
                          <strong>{c.contact || t('unknown')}</strong>
                          {!c.is_read && <span className="unread-dot" />}
                          <span className="conv-sep">·</span>
                          <span>{c.subject}</span>
                        </div>
                        <div className="preview">{c.preview}</div>
                      </div>
                      <div className="conv-actions" onClick={(e) => e.stopPropagation()}>
                        {activeFolder === 'trash' ? (
                          <>
                            <button title={t('restore') || 'Restore'} onClick={() => restoreConversation(c.id)}>↶</button>
                            <button title={t('delete')} onClick={() => permanentDelete(c.id)}>✕</button>
                          </>
                        ) : (
                          <button title={t('delete')} onClick={() => deleteMessage(c.id)}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <LanguagePicker
        visible={showLangPicker} current={lang} onClose={() => setShowLangPicker(false)}
        onSelect={(code) => { setLang(code); setShowLangPicker(false); }}
        onDetect={detectFromLocation} detecting={detecting} t={t}
      />
      <PreviewModal
        visible={!!previewAtt}
        attachment={previewAtt}
        token={token}
        onClose={() => setPreviewAtt(null)}
        onDownload={(att) => { downloadAttachment(att); }}
      />
    </>
  );
}

function PreviewModal({ visible, attachment, token, onClose, onDownload }) {
  const [blobUrl, setBlobUrl] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!visible || !attachment) {
      setBlobUrl(null); setError(''); return;
    }

    // For images, load directly via blob (auth header needed)
    const mime = attachment.mime_type || '';
    const needsBlob = true; // always fetch with auth to keep it simple

    setLoading(true); setError('');
    let cancelled = false;

    fetch(`${API_URL}${attachment.url}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [visible, attachment, token]);

  if (!visible || !attachment) return null;

  const mime = attachment.mime_type || '';
  const isImg = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';
  const isText = mime.startsWith('text/');

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-header">
          <span className="preview-title">{attachment.filename}</span>
          <div className="preview-actions">
            <button onClick={() => onDownload(attachment)} title="Download">↓</button>
            <button onClick={onClose} title="Close">✕</button>
          </div>
        </div>
        <div className="preview-body">
          {loading && <div className="preview-loading">Loading…</div>}
          {error && <div className="preview-error">Could not load preview</div>}
          {!loading && !error && blobUrl && (
            <>
              {isImg && (
                <img src={blobUrl} alt={attachment.filename} />
              )}
              {isPdf && (
                <iframe
                  src={blobUrl}
                  title={attachment.filename}
                  className="preview-pdf"
                />
              )}
              {isText && (
                <iframe
                  src={blobUrl}
                  title={attachment.filename}
                  className="preview-pdf"
                />
              )}
              {!isImg && !isPdf && !isText && (
                <div className="preview-fallback">
                  <div className="preview-fallback-icon">📄</div>
                  <div className="preview-fallback-name">{attachment.filename}</div>
                  <div className="preview-fallback-size">{formatSize(attachment.size)}</div>
                  <button className="preview-open-btn" onClick={() => onDownload(attachment)}>
                    Download
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LanguagePicker({ visible, current, onClose, onSelect, onDetect, detecting, t }) {
  if (!visible) return null;
  return (
    <div className="lang-backdrop" onClick={onClose}>
      <div className="lang-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lang-modal-header">
          <h3>{t('language')}</h3>
          <button className="lang-close" onClick={onClose}>✕</button>
        </div>
        <button className="lang-detect-btn" onClick={onDetect} disabled={detecting}>
          {detecting ? '…' : `📍 ${t('detect_from_location')}`}
        </button>
        <p className="lang-reason">{t('location_reason')}</p>
        <div className="lang-list">
          {LANGUAGES.map((l) => (
            <button key={l.code} className={`lang-row ${current === l.code ? 'active' : ''}`}
              onClick={() => onSelect(l.code)}>
              <span>{l.label}</span>
              {current === l.code && <span className="lang-check">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
