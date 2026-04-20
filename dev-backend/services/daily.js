/**
 * Daily.co 화상 미팅 API 래퍼
 * 환경변수 DAILY_API_KEY 필요. 미설정 시 createRoom() 은 null 반환 → 수동 링크 flow 로 fallback.
 *
 * API 문서: https://docs.daily.co/reference/rest-api
 */

const BASE = 'https://api.daily.co/v1';

const apiKey = () => process.env.DAILY_API_KEY || null;

const isConfigured = () => !!apiKey();

/**
 * 회의실 생성.
 * @param {Object} opts
 * @param {string} opts.namePrefix - 방 이름 prefix (영숫자·하이픈, 50자 이하). 타임스탬프 자동 추가.
 * @param {Date} opts.expiresAt - exp 에 사용될 만료시각 (seconds epoch 로 변환).
 * @returns {Promise<{ url:string, name:string } | null>} 설정 안됐거나 실패 시 null.
 */
async function createRoom({ namePrefix = 'planq', expiresAt } = {}) {
  if (!isConfigured()) return null;
  const safePrefix = String(namePrefix)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 30);
  const name = `${safePrefix}-${Date.now().toString(36)}`;

  const properties = {
    enable_chat: true,
    enable_screenshare: true,
    enable_knocking: true,
    start_video_off: false,
    start_audio_off: false,
  };
  if (expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())) {
    properties.exp = Math.floor(expiresAt.getTime() / 1000);
  }

  try {
    const res = await fetch(`${BASE}/rooms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, privacy: 'public', properties }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Daily.co createRoom failed', res.status, text.slice(0, 200));
      return null;
    }
    const json = await res.json();
    return { url: json.url, name: json.name };
  } catch (err) {
    console.error('Daily.co createRoom error', err.message);
    return null;
  }
}

module.exports = { createRoom, isConfigured };
