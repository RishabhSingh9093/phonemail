CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    phonemail_address VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100),
    language VARCHAR(50) DEFAULT 'English',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE otp_codes (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    subject VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE participants (
    conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INT REFERENCES users(id) ON DELETE SET NULL,
    recipient_id INT REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(255),
    body TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    is_favorite BOOLEAN DEFAULT FALSE,
    folder VARCHAR(20) DEFAULT 'inbox',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_users_phone ON users(phone);
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
