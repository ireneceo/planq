#!/usr/bin/env node
// 빌드 산출물의 «백업 잠금» 단언 — **제품에 실제로 링크된 것**을 읽는다. 이것이 정본이다.
//
// ★ 왜 파일을 읽지 않는가 (Fable 26·27·28차) — 소스 파일을 읽는 검사를 세 번 만들었고 세 번 다 뚫렸다.
//   ① 소스 매니페스트가 맞아도 `src/release/` 의 `tools:replace` 가 병합에서 덮는다.
//   ② 규칙 파일이 맞아도 `res/xml-v31/` 한정자가 덮는다 — `dataExtractionRules` 는 **API 31+ 에서만
//      읽히므로** v31 파일이 곧 모든 대상 기기의 유효 규칙이고 `res/xml/` 정본은 한 기기에서도 안 쓰인다.
//   ③ 매니페스트가 **다른 이름**(`@xml/backup_rules`)을 가리키면 이름이 하드코딩된 검사는 **미끼 파일**을 본다.
//   ④ `values-v31/` 의 **리소스 별칭**(`<item type="xml" name="…">@xml/other</item>`)은 파일이 아니라 안 보인다.
//   ⑤ **라이브러리 모듈**의 res 는 앱 모듈 산출물(`packaged_res`)에 아예 나오지 않는다.
//   → 공통 원인은 하나다: **읽는 파일이 곧 제품이 아니다.** 그래서 «무엇이 링크됐는가» 를 직접 묻는다.
//     aapt2 로 ⓐ매니페스트의 allowBackup ⓑ dataExtractionRules 가 가리키는 리소스 id
//     ⓒ 그 id 의 config 가 기본(`()`) **하나뿐인 파일**인지(v31 변형·별칭 0) ⓓ 그 파일의 트리.
//   ⑥ 그리고 **중간 산출물도 제품이 아니다**(Fable 30차). 링크된 `.ap_` 를 읽었더니
//      ⒜빌드 때만 입력을 바꾸는 훅 ⒝링크 뒤 `.ap_` 교체 ⒞**패키징 뒤 AAB 안 매니페스트 교체**
//      셋이 전부 초록인데 AAB 는 `allowBackup=true` 였다. 게다가 검사기가 gradle 을 다시 부르는 바람에
//      **변조된 중간물이 재생성되며 스스로 세탁**됐다. → 대상은 **Play 에 올라가는 AAB 하나**다.
//
// 사용: node scripts/android-packaged-backup-check.js
//   ★ 인자 없음. **빌드하지 않는다** — 이미 만들어진 AAB 만 읽는다(재빌드는 검사가 아니라 세탁이다).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'dev-frontend/android');
const NEED = ['root', 'file', 'database', 'sharedpref', 'external'];
const SECTIONS = ['cloud-backup', 'device-transfer'];

const die = (m, extra) => { console.error(`✗ ${m}`); (extra || []).forEach((l) => console.error(`   ${l}`)); process.exit(1); };

// ── aapt2 찾기. 없으면 **실패**한다 — 못 쟀는데 초록인 것이 가장 나쁘다.
function findAapt2() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/android-sdk';
  const bt = path.join(home, 'build-tools');
  if (!fs.existsSync(bt)) return null;
  // 문자열 정렬이면 '9.0.0' 이 '35.0.0' 을 이긴다 — 숫자로 센다.
  const vers = fs.readdirSync(bt).sort((a, b) => {
    const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return 0;
  });
  for (const v of vers) {
    const p = path.join(bt, v, 'aapt2');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die(`명령 실패 (exit ${r.status}): ${path.basename(bin)} ${args.slice(0, 3).join(' ')}`,
    [String(r.stderr || '').split('\n').slice(0, 3).join(' / ')]);
  return r.stdout;
}

// ── aapt2 xmltree 출력(들여쓰기 트리)을 파싱한다.
//    E: <태그> (line=N)  /  A: <속성>="<값>" …
function parseTree(text) {
  const root = { tag: '#root', attrs: {}, children: [], indent: -1 };
  const stack = [root];
  for (const raw of text.split('\n')) {
    const mE = /^(\s*)E: ([^ ]+)/.exec(raw);
    if (mE) {
      const node = { tag: mE[2], attrs: {}, children: [], indent: mE[1].length };
      while (stack.length > 1 && stack[stack.length - 1].indent >= node.indent) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    // ★ aapt2 의 속성 줄은 두 모양이다. 한쪽만 맞추면 조용히 «속성 없음» 이 된다(실제로 겪었다):
    //     A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false   ← 네임스페이스가 URL(콜론 다수)·값에 따옴표 없음
    //     A: domain="root" (Raw: "root")                                                ← 따옴표 있고 뒤에 Raw 가 붙음
    const mA = /^\s*A: (.+?)(?:\(0x[0-9a-fA-F]+\))?=(.*)$/.exec(raw);
    if (mA && stack.length > 1) {
      // ★ **네임스페이스를 벗기지 않는다** (Fable 29차 X1). 벗겼더니 `<exclude x:domain="root">` 를
      //   유효한 제외로 셌는데, **Android 는 그것을 무시한다** — AOSP 는 `getAttributeValue(null,"domain")`
      //   로 **네임스페이스 없는** domain 만 찾고, 못 찾으면 "invalid; skipping" 으로 그 줄을 버린다.
      //   즉 화면상 제외 5개인데 실제 제외는 0개 = 전부 백업. 키를 **있는 그대로** 보관하고
      //   읽는 쪽이 어느 이름을 원하는지 명시한다.
      const v = mA[2].trim();
      const val = v.startsWith('"') ? (v.match(/^"([^"]*)"/) || [, ''])[1] : v.split(/\s/)[0];
      stack[stack.length - 1].attrs[mA[1]] = val;
    }
  }
  return root;
}
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
/** android:<name> 을 **정확한 네임스페이스로만** 읽는다(다른 접두사는 Android 가 안 읽는다). */
const androidAttr = (node, name) => node.attrs[`${ANDROID_NS}:${name}`];
/** 네임스페이스 **없는** 속성만 — 규칙 파일의 domain 은 이쪽이어야 한다. */
const plainAttr = (node, name) => node.attrs[name];

const findAll = (node, tag, out = []) => {
  for (const c of node.children) { if (c.tag === tag) out.push(c); findAll(c, tag, out); }
  return out;
};

// ── 산출물 하나를 판정한다.
function checkAp(aapt2, ap, label) {
  const errs = [];
  const manifest = parseTree(run(aapt2, ['dump', 'xmltree', ap, '--file', 'AndroidManifest.xml']));
  const apps = findAll(manifest, 'application');
  if (apps.length !== 1) return [`${label}: <application> 이 ${apps.length}개입니다.`];
  const app = apps[0];

  const backupVal = androidAttr(app, 'allowBackup');
  if (backupVal !== 'false') {
    errs.push(`${label}: allowBackup 이 ${backupVal === undefined ? '없습니다(기본값 true)' : `"${backupVal}" 입니다`}`
      + ' — 로그인 세션이 백업·복원으로 다른 기기에 옮겨집니다.');
  }
  const ref = androidAttr(app, 'dataExtractionRules');
  if (!ref) return errs.concat(`${label}: dataExtractionRules 가 없습니다 — Android 12+ 기기이전으로 세션이 넘어갑니다.`);

  // ★ 참조 표기가 산출물마다 다르다 — APK 쪽은 `@0x7f110001`, **번들(AAB) 쪽은 `@xml/이름`**.
  //   한쪽만 맞추면 다른 쪽에서 «리소스 참조가 아닙니다» 로 죽는다(실제로 겪었다).
  const byId = /^@?(0x[0-9a-fA-F]+)$/.exec(ref);
  const byName = /^@(?:[A-Za-z0-9_.]+:)?xml\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!byId && !byName) return errs.concat(`${label}: dataExtractionRules 가 리소스 참조가 아닙니다: ${ref}`);

  const table = run(aapt2, ['dump', 'resources', ap]).split('\n');
  const head = byId
    ? table.findIndex((l) => new RegExp(`^\\s*resource ${byId[1]}\\b`).test(l))
    : table.findIndex((l) => new RegExp(`^\\s*resource \\S+ xml/${byName[1]}$`).test(l.trimEnd()));
  if (head < 0) return errs.concat(`${label}: 리소스 테이블에서 ${ref} 를 찾지 못했습니다.`);
  const name = (/^\s*resource \S+ (\S+)/.exec(table[head]) || [])[1] || '(이름 불명)';

  const configs = [];
  for (let i = head + 1; i < table.length; i++) {
    if (/^\s*resource \S+/.test(table[i]) || /^\s*type \S+/.test(table[i])) break;
    if (/^\s*\(/.test(table[i])) configs.push(table[i].trim());
  }
  if (configs.length !== 1) {
    return errs.concat(`${label}: 규칙 리소스 ${name} 의 config 가 ${configs.length}개입니다 — 한정자(예: v31) 변형이나 별칭이 정본을 덮습니다. [${configs.join(' | ')}]`);
  }
  if (!/^\(\)\s/.test(configs[0])) return errs.concat(`${label}: ${name} 의 유일한 config 가 기본(())이 아닙니다: ${configs[0]}`);
  const fileM = /\(file\)\s+(\S+)/.exec(configs[0]);
  if (!fileM) return errs.concat(`${label}: ${name} 가 파일이 아닙니다(별칭일 수 있습니다): ${configs[0]}`);

  const rules = parseTree(run(aapt2, ['dump', 'xmltree', ap, '--file', fileM[1]]));
  if (findAll(rules, 'include').length) errs.push(`${label}: ${fileM[1]} 에 <include> 가 있습니다 — 제외 의도가 뒤집힙니다.`);
  for (const sec of SECTIONS) {
    const found = findAll(rules, sec);
    if (found.length !== 1) { errs.push(`${label}: <${sec}> 가 ${found.length}개입니다.`); continue; }
    const seen = new Set();
    for (const e of found[0].children.filter((c) => c.tag === 'exclude')) {
      const d = plainAttr(e, 'domain');
      const extra = Object.keys(e.attrs).filter((k) => k !== 'domain');
      if (extra.length) {
        errs.push(`${label}: <${sec}> 의 exclude 에 ${extra.join(', ')} 이 있습니다 — `
          + (extra.some((k) => k.endsWith(':domain'))
            ? 'Android 는 네임스페이스 없는 domain 만 읽습니다(이 줄은 무시됩니다).'
            : '부분 제외가 됩니다.'));
      }
      if (d) seen.add(d);
    }
    const missing = NEED.filter((d) => !seen.has(d));
    if (missing.length) errs.push(`${label}: <${sec}> 에 제외되지 않은 도메인: ${missing.join(', ')}`);
  }
  console.log(`  ${label}: ${name} · config 1개 · ${path.basename(ap)}`);
  return errs;
}

// ── AAB 를 aapt2 가 읽을 수 있는 모양으로 푼다.
//    AAB 는 `base/manifest/AndroidManifest.xml` · `base/resources.pb` · `base/res/…` 구조다.
//    그걸 APK 배치(`AndroidManifest.xml` · `resources.pb` · `res/…`)로 다시 싸면
//    `aapt2 dump` 가 protoXML 로 그대로 읽는다 — **bundletool 도 JDK 도 필요 없다.**
function unpackAab(aab) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'planq-aab-'));
  const out = path.join(work, 'repacked.zip');
  // ★ `zip` CLI 는 없는 머신이 있다(이 서버가 그렇다). python3 는 mac·linux 양쪽에 있고
  //   AAB 엔트리의 1970 타임스탬프 때문에 `strict_timestamps=False` 가 필요하다.
  const py = `
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
found = False
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, strict_timestamps=False) as zout:
    for n in zin.namelist():
        if not n.startswith('base/'):
            continue
        tail = n[len('base/'):]
        if tail == 'manifest/AndroidManifest.xml':
            tail = 'AndroidManifest.xml'; found = True
        elif not (tail.startswith('res/') or tail == 'resources.pb'):
            continue
        zout.writestr(tail, zin.read(n))
sys.exit(0 if found else 3)
`;
  const r = spawnSync('python3', ['-c', py, aab, out], { encoding: 'utf8' });
  if (r.status === 3) die('AAB 안에 base/manifest/AndroidManifest.xml 이 없습니다 — 형식이 예상과 다릅니다.');
  if (r.status !== 0) die(`AAB 재포장 실패 (python3 exit ${r.status})`, [String(r.stderr || '').split('\n').slice(0, 2).join(' / ')]);
  return { zip: out, work };
}

// ── ① **빌드하지 않는다.** (Fable 30차) 검사기가 gradle 을 다시 부르면 변조된 중간물이
//    재생성되면서 **검사가 변조를 스스로 세탁한다** — 실제로 빌드 때만 매니페스트를 바꾸는 훅에
//    검사기가 초록을 줬고 AAB 는 `allowBackup=true` 였다. **재빌드는 검사가 아니다.**
//    그래서 이 스크립트는 **이미 만들어진 산출물만** 읽는다. CI 는 `bundleRelease` 직후 부른다.
const aapt2 = findAapt2();
if (!aapt2) die('aapt2 를 찾지 못했습니다 (ANDROID_HOME/build-tools) — 산출물을 판정할 수 없습니다.');

// ── ② 정본은 **AAB** 다. Play 에 올라가는 파일이 이것이고, 중간 산출물은 그 뒤 단계에서
//    얼마든지 갈릴 수 있다(링크 뒤 .ap_ 교체 · 패키징 뒤 AAB 안 매니페스트 교체 — 둘 다 실증됐다).
const BUNDLE_DIR = path.join(ANDROID, 'app/build/outputs/bundle/release');
const aabs = fs.existsSync(BUNDLE_DIR) ? fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith('.aab')) : [];
if (!aabs.length) die('release AAB 가 없습니다 — `./gradlew bundleRelease` 를 먼저 실행하세요.', [`찾은 곳: ${path.relative(ROOT, BUNDLE_DIR)}`]);
if (aabs.length > 1) die(`release AAB 가 ${aabs.length}개입니다 — 어느 것이 올라가는지 알 수 없습니다.`, aabs);
const aab = path.join(BUNDLE_DIR, aabs[0]);

// ── ③ 무엇을 판정하는지 **사람이 보게 적는다.**
//    ★ mtime 으로 «소스가 더 새로우면 실패» 를 두 번 시도했고 두 번 다 **거짓 실패**했다:
//      Gradle 은 **내용 기반**으로 UP-TO-DATE 를 판정해 산출물을 다시 쓰지 않으므로,
//      파일을 원복(내용 동일·mtime 갱신)하기만 해도 산출물이 «낡음» 으로 보인다.
//      거짓말하는 가드는 무시당한다 — 그래서 뺐다.
//    신선도는 **호출 순서로 보장한다**: CI 는 같은 단계에서 `set -e` 아래
//    `bundleRelease` **직후** 이 검사를 부른다(codemagic.yaml 「AAB 빌드」). 손으로 부를 때는
//    아래 출력의 시각으로 무엇을 보고 있는지 확인한다.
console.log('  대상 AAB:', path.relative(ROOT, aab), '·', new Date(fs.statSync(aab).mtimeMs).toISOString());
const { zip, work } = unpackAab(aab);
let allErrs;
try {
  allErrs = checkAp(aapt2, zip, 'AAB');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

if (allErrs.length) {
  allErrs.forEach((e) => console.error(`✗  ${e}`));
  console.error('\n최종 AAB 가 백업 잠금 상태가 아닙니다 — 이 AAB 를 Play 에 올리지 마세요.');
  process.exit(1);
}
console.log('✓ AAB 자체 — allowBackup=false · 단일 config · 두 섹션 전 도메인 제외');
