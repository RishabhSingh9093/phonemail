const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY;
const TEXTBEE_ENDPOINT = 'https://api.textbee.dev/api/v1/gateway/send-sms';
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MESSAGE_KEY_HEX = process.env.MESSAGE_KEY || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ---------- Encryption at rest ----------
let ENC_KEY = null;
if (MESSAGE_KEY_HEX && MESSAGE_KEY_HEX.length === 64) {
  ENC_KEY = Buffer.from(MESSAGE_KEY_HEX, 'hex');
  console.log('Message encryption at rest: ENABLED (AES-256-GCM)');
} else {
  console.log('Message encryption at rest: DISABLED');
}

function encryptBody(plaintext) {
  if (!ENC_KEY) return plaintext;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
  } catch (e) { return plaintext; }
}

function decryptBody(stored) {
  if (!ENC_KEY) return stored;
  if (!stored || !stored.startsWith('v1:')) return stored;
  try {
    const buf = Buffer.from(stored.slice(3), 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) { return stored; }
}

const preview = (text) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
};

// ---------- Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').slice(0, 10);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- Mail transport ----------
const gmailTransport = (GMAIL_USER && GMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    })
  : null;
if (gmailTransport) console.log('Gmail SMTP configured for', GMAIL_USER);
else console.log('Gmail SMTP not configured');

// ---------- Schema auto-migration ----------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      message_id INT REFERENCES messages(id) ON DELETE CASCADE,
      uploader_id INT REFERENCES users(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INT,
      storage_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploader_id);
  `);
  console.log('Attachments schema ready');
}
ensureSchema().catch((e) => console.error('Schema init failed:', e.message));

// ---------- Rate limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

// ---------- Helpers ----------
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');
const signToken = (user) =>
  jwt.sign({ sub: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });

const normalizePhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+91${digits.slice(-10)}`;
};

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); }
    catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
    const { rows } = await pool.query(
      'SELECT id, phone, phonemail_address, name, language FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: 'User not found' });
    req.user = rows[0];
    next();
  } catch { return res.status(401).json({ error: 'Authentication failed' }); }
}

// ---------- 1. OTP ----------
app.post('/auth/request-otp', authLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  const normalized = normalizePhone(phone);
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60000);
  try {
    await pool.query(
      'INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)',
      [normalized, hashOtp(otp), expiresAt]
    );
    if (process.env.OTP_MODE === 'development' || !TEXTBEE_API_KEY) {
      console.log(`[DEV] OTP for ${normalized}: ${otp}`);
      return res.json({ message: 'OTP generated (dev mode)', otp });
    }
    const response = await fetch(TEXTBEE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEXTBEE_API_KEY },
      body: JSON.stringify({ recipients: [normalized], message: `Your PhoneMail OTP is ${otp}. Valid for 10 minutes.` }),
    });
    const data = await response.json();
    if (!response.ok) { console.error('Textbee error:', data); return res.status(500).json({ error: 'Failed to send OTP via SMS' }); }
    res.json({ message: 'OTP sent successfully' });
  } catch (e) {
    console.error('request-otp error:', e.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ---------- 2. Register / Login ----------
const handleAuth = async (req, res, isRegister) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });
  const normalized = normalizePhone(phone);
  const userRes = await pool.query('SELECT * FROM users WHERE phone = $1', [normalized]);
  const existingUser = userRes.rows[0];
  if (isRegister && existingUser) return res.status(400).json({ error: 'User already exists' });
  if (!isRegister && !existingUser) return res.status(404).json({ error: 'User not found, please register' });
  const { rows } = await pool.query(
    'SELECT * FROM otp_codes WHERE phone = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [normalized]
  );
  if (!rows[0] || rows[0].code_hash !== hashOtp(otp) || rows[0].attempts >= 5) {
    if (rows[0]) await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [rows[0].id]);
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  await pool.query('DELETE FROM otp_codes WHERE id = $1', [rows[0].id]);
  let user = existingUser;
  if (!user) {
    const phonemail = `${normalized.replace(/[^\d]/g, '')}@phonemail.com`;
    const newUser = await pool.query(
      'INSERT INTO users (phone, phonemail_address) VALUES ($1, $2) RETURNING *',
      [normalized, phonemail]
    );
    user = newUser.rows[0];
  }
  res.json({ token: signToken(user), user });
};
app.post('/auth/register', authLimiter, (req, res) => handleAuth(req, res, true));
app.post('/auth/login', authLimiter, (req, res) => handleAuth(req, res, false));

// ---------- 3. Profile ----------
app.get('/me', requireAuth, (req, res) => res.json(req.user));
app.patch('/me', requireAuth, async (req, res) => {
  const { name, language } = req.body;
  await pool.query(
    'UPDATE users SET name = COALESCE($1, name), language = COALESCE($2, language) WHERE id = $3',
    [name, language, req.user.id]
  );
  res.json({ message: 'Profile updated' });
});
app.get('/me/address', requireAuth, (req, res) => res.json({ address: req.user.phonemail_address }));

// ---------- 4. Attachments ----------
app.post('/attachments', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO attachments (message_id, uploader_id, filename, mime_type, size, storage_name)
       VALUES (NULL, $1, $2, $3, $4, $5) RETURNING id, filename, mime_type, size`,
      [req.user.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename]
    );
    res.json({ attachment: rows[0] });
  } catch (e) {
    console.error('attachment insert failed:', e.message);
    res.status(500).json({ error: 'Failed to save attachment' });
  }
});

app.get('/attachments/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });

  if (a.message_id) {
    const check = await pool.query(
      `SELECT 1 FROM messages m
       JOIN participants p ON p.conversation_id = m.conversation_id
       WHERE m.id = $1 AND p.user_id = $2`,
      [a.message_id, req.user.id]
    );
    if (!check.rows[0]) return res.status(403).json({ error: 'Forbidden' });
  } else {
    if (a.uploader_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  }

  const filePath = path.join(UPLOAD_DIR, a.storage_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Type', a.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ---------- 5. Conversations ----------
app.get('/conversations', requireAuth, async (req, res) => {
  const { folder, q } = req.query;

  if (!q || !q.trim()) {
    const { rows } = await pool.query(
      `SELECT c.id, c.subject, c.updated_at,
              m.body as stored_body,
              m.is_favorite,
              u.phone as contact,
              NOT EXISTS (
                SELECT 1 FROM messages m2
                WHERE m2.conversation_id = c.id
                  AND m2.recipient_id = $1
                  AND m2.is_read = FALSE
              ) AS is_read
       FROM conversations c
       JOIN participants p ON c.id = p.conversation_id
       LEFT JOIN messages m ON m.id = (
         SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
       )
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE p.user_id = $1 AND m.folder = COALESCE($2, 'inbox')
       ORDER BY c.updated_at DESC`,
      [req.user.id, folder]
    );
    const conversations = rows.map((r) => ({
      id: r.id, subject: r.subject, updated_at: r.updated_at,
      is_read: r.is_read, is_favorite: r.is_favorite, contact: r.contact,
      preview: preview(decryptBody(r.stored_body)),
    }));
    return res.json({ conversations });
  }

  const term = q.trim().toLowerCase();
  const sqlMatches = await pool.query(
    `SELECT DISTINCT c.id
     FROM conversations c
     JOIN participants p ON c.id = p.conversation_id
     LEFT JOIN messages m ON m.conversation_id = c.id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE p.user_id = $1
       AND (LOWER(c.subject) LIKE $2 OR LOWER(COALESCE(u.phone, '')) LIKE $2)`,
    [req.user.id, `%${term}%`]
  );
  const bodyMatches = await pool.query(
    `SELECT DISTINCT m.conversation_id AS id
     FROM messages m
     JOIN participants p ON m.conversation_id = p.conversation_id
     WHERE p.user_id = $1`,
    [req.user.id]
  );
  const matchingIds = new Set(sqlMatches.rows.map((r) => r.id));
  for (const { id } of bodyMatches.rows) {
    if (matchingIds.has(id)) continue;
    const msgs = await pool.query('SELECT body FROM messages WHERE conversation_id = $1', [id]);
    for (const m of msgs.rows) {
      if (decryptBody(m.body).toLowerCase().includes(term)) { matchingIds.add(id); break; }
    }
  }
  if (matchingIds.size === 0) return res.json({ conversations: [] });
  const ids = Array.from(matchingIds);
  const { rows } = await pool.query(
    `SELECT c.id, c.subject, c.updated_at,
            m.body as stored_body, m.is_favorite, u.phone as contact,
            NOT EXISTS (
              SELECT 1 FROM messages m2
              WHERE m2.conversation_id = c.id AND m2.recipient_id = $1 AND m2.is_read = FALSE
            ) AS is_read
     FROM conversations c
     LEFT JOIN messages m ON m.id = (
       SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
     )
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE c.id = ANY($1::int[])
     ORDER BY c.updated_at DESC`,
    [ids, req.user.id]
  );
  const conversations = rows.map((r) => ({
    id: r.id, subject: r.subject, updated_at: r.updated_at,
    is_read: r.is_read, is_favorite: r.is_favorite, contact: r.contact,
    preview: preview(decryptBody(r.stored_body)),
  }));
  res.json({ conversations });
});

app.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  const messageIds = rows.map((r) => r.id);
  let attachByMsg = {};
  if (messageIds.length) {
    const att = await pool.query(
      `SELECT id, message_id, filename, mime_type, size FROM attachments WHERE message_id = ANY($1::int[])`,
      [messageIds]
    );
    for (const a of att.rows) {
      if (!attachByMsg[a.message_id]) attachByMsg[a.message_id] = [];
      attachByMsg[a.message_id].push({
        id: a.id, filename: a.filename, mime_type: a.mime_type, size: a.size,
        url: `/attachments/${a.id}`,
      });
    }
  }
  const messages = rows.map((m) => ({
    ...m,
    body: decryptBody(m.body),
    attachments: attachByMsg[m.id] || [],
  }));
  res.json({ messages });
});

app.patch('/conversations/:id/folder', requireAuth, async (req, res) => {
  const convId = req.params.id;
  const { folder } = req.body;
  if (!['inbox', 'drafts', 'spam', 'trash'].includes(folder)) return res.status(400).json({ error: 'Invalid folder' });
  const check = await pool.query('SELECT 1 FROM participants WHERE conversation_id = $1 AND user_id = $2', [convId, req.user.id]);
  if (!check.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
  await pool.query('UPDATE messages SET folder = $1 WHERE conversation_id = $2', [folder, convId]);
  res.json({ success: true, folder });
});

app.delete('/conversations/:id', requireAuth, async (req, res) => {
  const convId = req.params.id;
  const target = req.query.folder || 'trash';
  if (!['inbox', 'trash', 'spam', 'drafts'].includes(target)) return res.status(400).json({ error: 'Invalid target folder' });
  const check = await pool.query('SELECT 1 FROM participants WHERE conversation_id = $1 AND user_id = $2', [convId, req.user.id]);
  if (!check.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
  await pool.query('UPDATE messages SET folder = $1 WHERE conversation_id = $2', [target, convId]);
  res.json({ success: true, folder: target });
});

app.delete('/conversations/:id/permanent', requireAuth, async (req, res) => {
  const convId = req.params.id;
  const check = await pool.query('SELECT 1 FROM participants WHERE conversation_id = $1 AND user_id = $2', [convId, req.user.id]);
  if (!check.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
  // delete files from disk
  const att = await pool.query(
    `SELECT a.storage_name FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = $1`,
    [convId]
  );
  for (const a of att.rows) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, a.storage_name)); } catch (_) {}
  }
  await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
  res.json({ success: true, permanent: true });
});

app.patch('/conversations/mark-all-read', requireAuth, async (req, res) => {
  await pool.query(
    `UPDATE messages SET is_read = TRUE
     WHERE is_read = FALSE
       AND conversation_id IN (SELECT conversation_id FROM participants WHERE user_id = $1)`,
    [req.user.id]
  );
  res.json({ success: true });
});

// ---------- 6. Send message ----------
app.post('/messages', requireAuth, async (req, res) => {
  try {
    const { to, subject, body, attachmentIds } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'Missing fields' });

    const senderRes = await pool.query('SELECT phonemail_address FROM users WHERE id = $1', [req.user.id]);
    const senderAddress = senderRes.rows[0]?.phonemail_address || 'noreply@phonemail.local';
    const recipientRes = await pool.query(
      'SELECT id, phonemail_address, phone FROM users WHERE phonemail_address = $1 OR phone = $2',
      [to, to]
    );
    const localRecipient = recipientRes.rows[0];
    const encryptedBody = encryptBody(body);
    const ids = Array.isArray(attachmentIds) ? attachmentIds.filter(Number.isFinite) : [];

    // External
    if (!localRecipient) {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      if (!isEmail) return res.status(400).json({ error: 'Recipient not found and not a valid email address' });
      if (!gmailTransport) return res.status(503).json({ error: 'External email not configured' });

      let externalDelivered = false;
      let deliveryNote = null;
      try {
        const attachmentsForMail = [];
        for (const id of ids) {
          const a = await pool.query('SELECT * FROM attachments WHERE id = $1 AND uploader_id = $2', [id, req.user.id]);
          if (a.rows[0]) {
            attachmentsForMail.push({ filename: a.rows[0].filename, path: path.join(UPLOAD_DIR, a.rows[0].storage_name) });
          }
        }
        await gmailTransport.sendMail({
          from: `"PhoneMail" <${GMAIL_USER}>`, replyTo: GMAIL_USER,
          to, subject, text: body,
          html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.5">
            <p>${body.replace(/\n/g, '<br>')}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
            <p style="color:#64748b;font-size:12px">Sent via <strong>PhoneMail</strong> from <code>${senderAddress}</code></p>
          </div>`,
          attachments: attachmentsForMail,
        });
        externalDelivered = true;
        console.log(`[EMAIL SENT] to=${to} attachments=${attachmentsForMail.length}`);
      } catch (e) {
        console.error('Gmail SMTP send failed:', e.message);
        deliveryNote = 'SMTP blocked by network. Message saved locally.';
      }

      const convRes = await pool.query('INSERT INTO conversations (subject) VALUES ($1) RETURNING id', [subject]);
      const convId = convRes.rows[0].id;
      await pool.query(`INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [convId, req.user.id]);
      const msgRes = await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, recipient_id, subject, body) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [convId, req.user.id, null, subject, encryptedBody]
      );
      if (ids.length) {
        await pool.query('UPDATE attachments SET message_id = $1 WHERE id = ANY($2::int[]) AND uploader_id = $3', [msgRes.rows[0].id, ids, req.user.id]);
      }
      return res.json({
        message: { ...msgRes.rows[0], body },
        delivery: { channel: 'external', delivered: externalDelivered, note: deliveryNote },
      });
    }

    // Internal
    const convRes = await pool.query('INSERT INTO conversations (subject) VALUES ($1) RETURNING id', [subject]);
    const convId = convRes.rows[0].id;
    await pool.query(
      `INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [convId, req.user.id, localRecipient.id]
    );
    const msgRes = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, recipient_id, subject, body) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [convId, req.user.id, localRecipient.id, subject, encryptedBody]
    );
    if (ids.length) {
      await pool.query('UPDATE attachments SET message_id = $1 WHERE id = ANY($2::int[]) AND uploader_id = $3', [msgRes.rows[0].id, ids, req.user.id]);
    }
    try {
      await fetch('http://mail-service:8080/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: localRecipient.phonemail_address, subject, body }),
      });
    } catch (_) {}
    res.json({ message: { ...msgRes.rows[0], body }, delivery: { channel: 'internal' } });
  } catch (e) {
    console.error('[MESSAGES] unhandled:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to send message' });
  }
});

// ---------- 7. Reply ----------
app.post('/messages/:id/reply', requireAuth, async (req, res) => {
  const { body, attachmentIds } = req.body;
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
  const original = rows[0];
  const reply = await pool.query(
    'INSERT INTO messages (conversation_id, sender_id, recipient_id, subject, body) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [original.conversation_id, req.user.id, original.sender_id, `Re: ${original.subject}`, encryptBody(body)]
  );
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter(Number.isFinite) : [];
  if (ids.length) {
    await pool.query('UPDATE attachments SET message_id = $1 WHERE id = ANY($2::int[]) AND uploader_id = $3', [reply.rows[0].id, ids, req.user.id]);
  }
  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [original.conversation_id]);
  res.json({ message: { ...reply.rows[0], body } });
});

// ---------- 8. Message state ----------
app.patch('/messages/:id/read', requireAuth, async (req, res) => {
  await pool.query('UPDATE messages SET is_read = TRUE WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
app.patch('/messages/:id/favorite', requireAuth, async (req, res) => {
  await pool.query('UPDATE messages SET is_favorite = NOT is_favorite WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ---------- 9. Dev incoming ----------
app.post('/development/incoming', async (req, res) => {
  const { from, to, subject, body } = req.body;
  const userRes = await pool.query('SELECT id FROM users WHERE phonemail_address = $1', [to]);
  if (!userRes.rows[0]) return res.status(404).json({ error: 'User not found' });
  const convRes = await pool.query('INSERT INTO conversations (subject) VALUES ($1) RETURNING id', [subject]);
  const convId = convRes.rows[0].id;
  await pool.query('INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2)', [convId, userRes.rows[0].id]);
  await pool.query(
    'INSERT INTO messages (conversation_id, sender_id, recipient_id, subject, body) VALUES ($1, NULL, $2, $3, $4)',
    [convId, userRes.rows[0].id, subject, encryptBody(body)]
  );
  res.json({ success: true });
});

// ---------- 10. Inbound webhook ----------
app.post('/webhook/inbound', async (req, res) => {
  try {
    const from = req.body.sender || req.body.From || req.body.from || '';
    const to = req.body.recipient || req.body.To || req.body.to || '';
    const subject = req.body.subject || req.body.Subject || '(no subject)';
    const body = req.body['body-plain'] || req.body.TextBody || req.body.text || req.body.body || '';
    if (!to || !body) return res.status(400).json({ error: 'Recipient and body required' });
    const toAddr = String(to).match(/<([^>]+)>/)?.[1] || String(to).trim();
    const fromAddr = String(from).match(/<([^>]+)>/)?.[1] || String(from).trim() || 'unknown@external';
    const userRes = await pool.query('SELECT id, phonemail_address FROM users WHERE phonemail_address = $1', [toAddr]);
    if (!userRes.rows[0]) return res.status(202).json({ accepted: false, reason: 'No matching user' });
    const user = userRes.rows[0];
    const convRes = await pool.query('INSERT INTO conversations (subject) VALUES ($1) RETURNING id', [subject]);
    const convId = convRes.rows[0].id;
    await pool.query('INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2)', [convId, user.id]);
    const msgRes = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, recipient_id, subject, body) VALUES ($1, NULL, $2, $3, $4) RETURNING id',
      [convId, user.id, subject, encryptBody(`From: ${fromAddr}\n\n${body}`)]
    );
    try {
      await fetch('http://mail-service:8080/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: user.phonemail_address, subject: `[INBOUND] ${subject}`, body }),
      });
    } catch (_) {}
    console.log(`[INBOUND] from=${fromAddr} to=${toAddr}`);
    res.status(202).json({ accepted: true, messageId: msgRes.rows[0].id, conversationId: convId });
  } catch (e) {
    console.error('webhook/inbound error:', e.message);
    res.status(500).json({ error: 'Failed to process inbound email' });
  }
});

// ---------- Health ----------
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ message: 'PhoneMail API' }));

module.exports = app;
