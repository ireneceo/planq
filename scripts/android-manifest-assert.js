// Android 매니페스트 «백업 잠금» 단언 — 소스와 **병합본** 양쪽에 같은 술어를 쓴다.
//
// ★ 왜 별도 모듈인가 (Fable 25·26차) — 이 검사를 두 번 문자열로 썼고 두 번 다 뚫렸다.
//   25차: `allowBackup="true"` 를 **찾는** 방식 → 속성을 지우면 통과(기본값이 true 인데!) ·
//         홑따옴표 통과 · 규칙 파일이 비어도 통과(존재만 봤다).
//   26차: 「있어야 할 것을 요구」로 바꿨는데 **문자열 수준에서 멈춰** 또 6가지가 뚫렸다 —
//         주석 안의 가짜 `false` · 규칙 exclude 를 주석 처리 · `<exclude path="...">` 부분 제외 ·
//         `<activity>` 나 `<manifest>` 에 false 를 달기 · **`src/release/` 소스셋의 tools:replace**.
//   → 교훈 둘.
//     ① **문자열이 아니라 트리로 본다.** 파서는 주석을 노드로 분리하므로 주석 위장이 통하지 않고,
//        "어느 요소의 속성인가" 를 문자열로는 가릴 수 없다.
//     ② **읽는 파일이 곧 제품이 아니다.** 소스 매니페스트가 맞아도 다른 소스셋이 `tools:replace`
//        로 덮으면 최종 산출물은 반대가 된다. 그래서 같은 술어를 **병합 매니페스트**에도 건다.
//        소스 검사는 빠른 사전 검사, **병합본이 정본**이다.
const fs = require('fs');
const path = require('path');
// ★ **절대경로로 require 하지 않는다** (Fable 27차) — Codemagic 은 `/Users/builder/clone` 에
//   클론하므로 `/opt/planq/...` 는 없다. 그러면 이 모듈을 부르는 **두 곳**(사전 검사·병합 검사)이
//   모두 MODULE_NOT_FOUND 로 죽어 **Android CI 빌드가 전부 2단계에서 멈춘다.**
//   memory `feedback_guard_scripts_hardcode_root` 와 같은 계열.
//   그리고 `@xmldom/xmldom` 은 전이 의존이었다(@capacitor/cli → plist) — capacitor 를 올리면
//   조용히 사라질 수 있어 dev-frontend/package.json devDependencies 에 **명시**했다.
const { DOMParser } = require(path.join(__dirname, '../dev-frontend/node_modules/@xmldom/xmldom'));

const NEED_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const SECTIONS = ['cloud-backup', 'device-transfer'];

function parse(file) {
  const errs = [];
  const doc = new DOMParser({
    onError: () => {},           // 경고는 삼키되 파싱 실패는 아래에서 잡는다
  }).parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml');
  if (!doc || !doc.documentElement) errs.push(`${path.basename(file)} 을 XML 로 읽지 못했습니다`);
  return { doc, errs };
}
const els = (node, tag) => Array.from(node.getElementsByTagName(tag));

/** 규칙 파일 — 두 섹션이 정확히 하나씩, 각 섹션에 5도메인 exclude 만. */
function assertRulesFile(file) {
  const out = [];
  if (!fs.existsSync(file)) return [`규칙 파일이 없습니다: ${file}`];
  const { doc, errs } = parse(file);
  if (errs.length) return errs;
  const name = path.basename(file);

  // ★ `<include>` 가 있으면 의도가 뒤집힐 수 있다 — 한 개도 허용하지 않는다.
  if (els(doc, 'include').length) out.push(`${name} 에 <include> 가 있습니다 — 제외 의도가 뒤집힙니다.`);

  for (const sec of SECTIONS) {
    const found = els(doc, sec);
    if (found.length !== 1) {
      out.push(`${name} 에 <${sec}> 가 ${found.length}개입니다 (정확히 1개여야 합니다).`);
      continue;
    }
    const excludes = els(found[0], 'exclude');
    const seen = new Set();
    for (const e of excludes) {
      // ★ 네임스페이스 붙은 `x:domain` 은 Android 가 못 읽고 그 줄을 버린다(Fable 29차 X1).
      //   xmldom 의 getAttribute('domain') 은 접두사 붙은 것을 안 주므로 자연히 걸리지만,
      //   **왜 실패했는지**를 사람이 알 수 있게 잉여 속성을 함께 짚는다.
      const domain = e.getAttribute('domain');
      // ★ `path` 가 붙으면 **그 파일 하나만** 제외된다(부분 제외). 나머지는 그대로 백업된다.
      const extra = Array.from(e.attributes || []).map((a) => a.name).filter((n) => n !== 'domain');
      if (extra.length) out.push(`${name} <${sec}> 의 exclude(domain=${domain}) 에 ${extra.join(',')} 속성이 있습니다 — 부분 제외가 됩니다.`);
      if (domain) seen.add(domain);
    }
    const missing = NEED_DOMAINS.filter((d) => !seen.has(d));
    if (missing.length) out.push(`${name} <${sec}> 에 제외되지 않은 도메인: ${missing.join(', ')}`);
  }
  return out;
}

/**
 * 매니페스트 하나를 단언한다.
 *   opts.resolveRules — @xml/<이름> 을 찾을 res 디렉터리(소스 검사에서만). 없으면 속성 존재만 본다.
 */
function assertManifest(file, opts = {}) {
  const out = [];
  if (!fs.existsSync(file)) return [`매니페스트가 없습니다: ${file}`];
  const { doc, errs } = parse(file);
  if (errs.length) return errs;
  const label = opts.label || path.basename(file);

  const apps = els(doc, 'application');
  if (apps.length !== 1) return [`${label} 의 <application> 이 ${apps.length}개입니다 (정확히 1개여야 합니다).`];
  const app = apps[0];

  // ① allowBackup — **<application> 의 속성**이어야 하고 값이 false 여야 한다.
  //    다른 요소(<manifest>·<activity>)에 달아도 Gradle 은 받아들이지만 효력이 없다.
  const backup = app.getAttribute('android:allowBackup');
  if (backup !== 'false') {
    out.push(`${label} <application> 의 android:allowBackup 이 ${backup === '' || backup == null ? '없습니다(기본값 true)' : `"${backup}" 입니다`}`
      + ' — 로그인 세션이 백업·복원으로 다른 기기에 옮겨집니다.');
  }

  // ② dataExtractionRules — Android 12+ 의 기기이전(D2D) 방어선
  const rules = app.getAttribute('android:dataExtractionRules');
  if (!rules) {
    out.push(`${label} <application> 에 android:dataExtractionRules 가 없습니다 — Android 12+ 에서 기기이전으로 세션이 넘어갑니다.`);
  } else if (opts.resolveRules) {
    const m = /^@xml\/([A-Za-z0-9_]+)$/.exec(rules);
    if (!m) out.push(`${label} 의 dataExtractionRules 값이 @xml/<이름> 형식이 아닙니다: ${rules}`);
    else out.push(...assertRulesFile(path.join(opts.resolveRules, 'xml', `${m[1]}.xml`)));
  }
  return out;
}

/**
 * main 외 소스셋이 <application> 을 건드리거나 tools:replace/tools:node 를 쓰면
 * **병합 결과가 소스와 반대가 된다.** 사전 검사 단계에서 막는다.
 */
function assertNoSourceSetOverride(srcDir) {
  const out = [];
  if (!fs.existsSync(srcDir)) return out;
  for (const set of fs.readdirSync(srcDir)) {
    if (set === 'main') continue;
    const f = path.join(srcDir, set, 'AndroidManifest.xml');
    if (!fs.existsSync(f)) continue;
    const { doc, errs } = parse(f);
    if (errs.length) { out.push(...errs); continue; }
    if (els(doc, 'application').length) {
      out.push(`소스셋 src/${set}/AndroidManifest.xml 이 <application> 을 선언합니다 — 병합에서 main 을 덮을 수 있습니다.`);
    }
    if (/tools:(replace|node)\s*=/.test(fs.readFileSync(f, 'utf8'))) {
      out.push(`소스셋 src/${set}/AndroidManifest.xml 이 tools:replace/tools:node 를 씁니다 — 병합 결과가 소스와 달라집니다.`);
    }
  }
  return out;
}

/**
 * ★ 규칙 파일은 **한 자리에만** 있어야 한다 (Fable 27차 P1·P2).
 *   `dataExtractionRules` 는 **API 31+ 에서만 읽힌다.** 그래서 `res/xml-v31/` 에 같은 이름을 두면
 *   그쪽이 **모든 대상 기기의 유효 규칙**이 되고 `res/xml/` 의 정본은 한 기기에서도 안 쓰인다.
 *   `src/release/res/xml/` 도 마찬가지로 main 을 덮는다. 둘 다 매니페스트는 멀쩡해서
 *   앞의 검사들이 전부 초록이었다 — **읽는 파일이 곧 제품이 아니다**(같은 교훈, 이번엔 리소스 쪽).
 */
function assertSingleRulesLocation(appSrcDir, rulesName) {
  const out = [];
  if (!fs.existsSync(appSrcDir)) return out;
  // ★ 이름을 **리터럴로 박지 않는다** (Fable 29차 X1b) — 매니페스트가 `@xml/backup_rules` 를
  //   가리키는데 여기서 `data_extraction_rules` 를 찾으면 **미끼 파일**을 검사하고 통과한다.
  if (!rulesName) return ['규칙 리소스 이름을 매니페스트에서 읽지 못했습니다 — 검사 대상이 없습니다.'];
  const allowed = path.join(appSrcDir, 'main', 'res', 'xml', `${rulesName}.xml`);
  for (const set of fs.readdirSync(appSrcDir)) {
    const resDir = path.join(appSrcDir, set, 'res');
    if (!fs.existsSync(resDir)) continue;
    for (const d of fs.readdirSync(resDir)) {
      if (!/^xml(-|$)/.test(d)) continue;              // xml, xml-v31, xml-sw600dp …
      const f = path.join(resDir, d, `${rulesName}.xml`);
      if (!fs.existsSync(f)) continue;
      if (path.resolve(f) !== path.resolve(allowed)) {
        out.push(`규칙 파일이 src/main/res/xml/ 밖에도 있습니다: src/${set}/res/${d}/${rulesName}.xml`
          + ' — 한정자·소스셋 파일이 정본을 덮어 제품에서는 다른 규칙이 쓰입니다.');
      }
    }
  }
  return out;
}

/** 매니페스트가 가리키는 규칙 리소스 이름(@xml/<이름>)을 돌려준다. 없으면 null. */
function rulesNameOf(manifestFile) {
  if (!fs.existsSync(manifestFile)) return null;
  const { doc, errs } = parse(manifestFile);
  if (errs.length) return null;
  const apps = els(doc, 'application');
  if (apps.length !== 1) return null;
  const m = /^@xml\/([A-Za-z0-9_]+)$/.exec(apps[0].getAttribute('android:dataExtractionRules') || '');
  return m ? m[1] : null;
}

module.exports = {
  assertManifest, assertRulesFile, assertNoSourceSetOverride,
  assertSingleRulesLocation, rulesNameOf, NEED_DOMAINS,
};
