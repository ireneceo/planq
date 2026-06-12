// S3 호환 워크스페이스 파일 저장 (운영 피드백 #29 — 독립 서버/MinIO/R2/Wasabi/AWS S3 등)
//   - 자격은 AES-256-GCM 암호화 저장(encryption.js), endpoint 는 https + SSRF 가드
//   - putObject / presignGet(단기 서명) / testConnection / deleteObject
const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { decrypt } = require('./encryption');

// SSRF 방어 — endpoint 는 https + 내부/사설 IP 차단 (운영 안정성 4번 패턴)
function assertSafeEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { throw new Error('invalid_endpoint'); }
  if (u.protocol !== 'https:') throw new Error('endpoint_must_be_https');
  const host = u.hostname;
  // 사설/내부 대역 차단
  if (/^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.)/.test(host)) throw new Error('endpoint_internal_blocked');
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) throw new Error('endpoint_internal_blocked');
  return true;
}

function clientFromConfig(cfg) {
  assertSafeEndpoint(cfg.endpoint);
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region || 'us-east-1',
    credentials: {
      accessKeyId: decrypt(cfg.access_key_enc),
      secretAccessKey: decrypt(cfg.secret_key_enc),
    },
    forcePathStyle: true, // MinIO/R2 등 path-style 호환
  });
}

async function testConnection(cfg) {
  const c = clientFromConfig(cfg);
  await c.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  return true;
}

async function putObject(cfg, key, buffer, contentType) {
  const c = clientFromConfig(cfg);
  await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream' }));
  return key;
}

// 단기 서명 GET URL (private 버킷 — 매 다운로드 요청 시 갱신)
async function presignGet(cfg, key, ttlSec = 300) {
  const c = clientFromConfig(cfg);
  return getSignedUrl(c, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: ttlSec });
}

async function deleteObject(cfg, key) {
  const c = clientFromConfig(cfg);
  await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

// key 생성 — 멀티테넌트 격리(business_id prefix 강제) + path_prefix
function buildKey(cfg, businessId, ext) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const uuid = require('crypto').randomBytes(16).toString('hex');
  const prefix = (cfg.path_prefix || '').replace(/^\/+|\/+$/g, '');
  const parts = [prefix, `biz-${businessId}`, ym, `${uuid}${ext || ''}`].filter(Boolean);
  return parts.join('/');
}

module.exports = { assertSafeEndpoint, clientFromConfig, testConnection, putObject, presignGet, deleteObject, buildKey };
