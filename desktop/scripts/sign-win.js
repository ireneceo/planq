// 윈도우 설치본 코드 서명 — electron-builder signtoolOptions.sign 사용자 서명 함수 (2026-11-26, Irene «권고대로» ②)
// 정본 docs/DESKTOP_APP_PHASE2.md §6-3. 빌드는 이 리눅스 서버(wine)라 USB 토큰형은 못 쓴다 → 클라우드 서명
// SSL.com eSigner 의 CodeSignTool(자바, 리눅스 동작)로 서명한다. 값은 env 로만 받는다(저장소에 비밀 없음):
//   PLANQ_WIN_SIGN_TOOL     CodeSignTool 을 푼 폴더(CodeSignTool.sh 가 있는 곳)
//   ESIGNER_USERNAME · ESIGNER_PASSWORD · ESIGNER_CREDENTIAL_ID · ESIGNER_TOTP_SECRET
// build.js 가 이 값이 다 있을 때만 이 함수를 붙인다 — 없으면 예전처럼 무서명.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KEYS = ['PLANQ_WIN_SIGN_TOOL', 'ESIGNER_USERNAME', 'ESIGNER_PASSWORD', 'ESIGNER_CREDENTIAL_ID', 'ESIGNER_TOTP_SECRET'];

function missingKeys(env = process.env) { return KEYS.filter((k) => !String(env[k] || '').trim()); }

// PE 파일에 서명(보안 디렉터리)이 실제로 붙었는가 — 도구가 0 으로 끝나도 안 붙은 경우를 잡는다
function hasAuthenticode(file) {
  const b = fs.readFileSync(file);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return false;   // 'MZ'
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) return false;                     // 'PE\0\0'
  const opt = pe + 24;
  const magic = b.readUInt16LE(opt);
  const dirBase = opt + (magic === 0x20b ? 112 : 96);                  // PE32+ / PE32 데이터 디렉터리 시작
  const secRva = b.readUInt32LE(dirBase + 4 * 8);                      // 4번 = 보안(인증서) 디렉터리
  const secSize = b.readUInt32LE(dirBase + 4 * 8 + 4);
  return secRva > 0 && secSize > 0;
}

module.exports = async function sign(configuration) {
  const file = configuration.path;
  // electron-builder 는 sha1·sha256 두 번 부른다 — eSigner 는 sha256 한 번이면 된다
  if (configuration.hash && configuration.hash !== 'sha256') return;
  const miss = missingKeys();
  if (miss.length) throw new Error(`[sign-win] 서명 값이 없다: ${miss.join(', ')}`);
  const dir = process.env.PLANQ_WIN_SIGN_TOOL;
  const sh = path.join(dir, 'CodeSignTool.sh');
  const args = ['sign',
    `-username=${process.env.ESIGNER_USERNAME}`, `-password=${process.env.ESIGNER_PASSWORD}`,
    `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`, `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
    `-input_file_path=${file}`, '-override=true'];
  // 비밀값이 로그에 찍히지 않게 출력은 받아서 결과 줄만 본다
  let out = '';
  try {
    out = execFileSync('bash', [sh, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`[sign-win] CodeSignTool 실패: ${path.basename(file)} — ${String(e.stdout || e.message).split('\n').filter((l) => /error|fail/i.test(l)).slice(0, 3).join(' / ')}`);
  }
  if (/error/i.test(out) && !/signed successfully/i.test(out)) throw new Error(`[sign-win] 서명 결과가 이상하다: ${path.basename(file)}`);
  if (!hasAuthenticode(file)) throw new Error(`[sign-win] 서명이 붙지 않았다: ${path.basename(file)}`);
  console.log(`[sign-win] 서명됨: ${path.basename(file)}`);
};
module.exports.missingKeys = missingKeys;
module.exports.hasAuthenticode = hasAuthenticode;
module.exports.KEYS = KEYS;
