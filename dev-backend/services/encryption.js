// services/encryption.js — AES-256-GCM 암호화 헬퍼 (Q Mail M1)
//
// 사용처: EmailAccount.imap_password / smtp_password 같은 워크스페이스 외부 자격증명.
// master key — env EMAIL_ENCRYPTION_KEY (32 bytes / 64 hex chars).
//   미설정 시 자동 생성 + warn 로그 (개발 편의, 운영은 명시 설정 필수).
//
// 형식: base64( iv(12) || ciphertext || authTag(16) )
//   GCM 은 authenticity 검증 — 다른 키로 복호화 시 throw.
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const hex = process.env.EMAIL_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    // 개발 fallback — process.env.JWT_SECRET 의 SHA-256 으로 derive
    // 운영에서는 EMAIL_ENCRYPTION_KEY 명시 설정 필수
    const seed = process.env.JWT_SECRET || 'planq-dev-fallback';
    return crypto.createHash('sha256').update(seed).digest();
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

function decrypt(blob) {
  if (!blob) return null;
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) throw new Error('invalid_blob');
    const iv = buf.slice(0, IV_LEN);
    const tag = buf.slice(buf.length - TAG_LEN);
    const ciphertext = buf.slice(IV_LEN, buf.length - TAG_LEN);
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch (e) {
    // 키 mismatch 또는 손상 — null 반환 + 로그 (운영에서 알림 발생)
    console.error('[encryption] decrypt failed:', e.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
