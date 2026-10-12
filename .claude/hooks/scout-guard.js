#!/usr/bin/env node
// PlanQ — 정찰 방 읽기 전용 가드의 판정부 (scout-guard.sh 가 **정찰 방일 때만** 부른다)
//   stdin: PreToolUse JSON. 막을 때만 deny JSON 을 stdout 에, 통과면 아무것도 쓰지 않는다.
//   허용 쓰기 자리: /opt/planq/.claude/plans/ (계획 파일) — 파일 도구는 여기만.
//   셸 명령의 «임시 출력» 자리(> 리다이렉트·rm 같은 파일 명령)는 /tmp · /dev/null · 방 작업 폴더(jobs/*/tmp)도 둔다.
'use strict';
const fs = require('fs');
const path = require('path');

const PLANS = '/opt/planq/.claude/plans';
let BASE = process.env.CLAUDE_PROJECT_DIR || '/opt/planq';
const SCRATCH = [PLANS, '/tmp', '/dev/null', '/dev/stdout', '/dev/stderr', path.join(process.env.HOME || '/home/irene', '.claude/jobs')];

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `정찰 방(읽기 전용): ${reason} — 정찰 방은 조사만 하고 ${PLANS}/q<번호>.md 만 쓴다. 고치는 일은 고치는 방이 한다.`,
    },
  }));
  process.exit(0);
}

function real(p) {
  // 있는 부분까지는 심볼릭 링크를 풀고, 없는 꼬리는 그대로 붙인다(realpath -m 과 같은 뜻)
  let abs = path.resolve(BASE, p);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(abs), ...tail.reverse()); } catch { /* 없는 꼬리 */ }
    const parent = path.dirname(abs);
    if (parent === abs) return path.join(abs, ...tail.reverse());
    tail.push(path.basename(abs));
    abs = parent;
  }
}
const under = (p, roots) => { const r = real(p); return roots.some((d) => r === d || r.startsWith(d + '/')); };

// 판정부가 예외로 죽으면 «조용히 통과» 가 된다 — 정찰 방에서는 막는 쪽으로 떨어진다(Fable 2026-10-12 지적)
try { main(); } catch (e) { deny(`판정 중 오류(${e && e.message ? e.message.slice(0, 80) : e})`); }
process.exit(0);

function main() {
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { deny('도구 입력을 읽지 못함'); }
if (input.cwd) BASE = String(input.cwd);
const tool = String(input.tool_name || '');
const ti = input.tool_input || {};

// ── 파일 도구: 계획 폴더 밖이면 막는다 ──────────────────────────────
if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const fp = ti.file_path || ti.notebook_path || '';
  if (typeof fp !== 'string' || !fp) deny(`${tool} 대상 경로가 없음`);
  if (!under(fp, [PLANS])) deny(`${tool} ${fp} — 계획 폴더 밖 쓰기`);
  return;
}

// ── MCP 도구: 실데이터를 바꾸는 것(읽기 이름이 아닌 것)은 막는다 ─────
if (tool.startsWith('mcp__')) {
  const name = tool.split('__').pop();
  if (!/^(get|list|search|read|query|guide|fetch)(_|$)/i.test(name)) deny(`${tool} — 데이터를 바꿀 수 있는 연결 도구`);
  return;
}

if (tool !== 'Bash') return;

// ── 셸 명령 ─────────────────────────────────────────────────────────
const raw = String(ti.command || '');
if (ti.run_in_background && /\b(npm|vite|tsc|pm2)\b/.test(raw)) deny('백그라운드 빌드·프로세스 명령');

// 히어독 본문은 명령이 아니라 데이터다 — 계획 파일(cat > plans/q.md <<'EOF')에는 «확인 방법: npm run build»·«a > 0» 같은
// 글이 반드시 들어간다. 본문을 명령으로 읽으면 유일하게 허용된 쓰기가 막힌다(Fable 2026-10-12 실방 4/7 deny).
// 본문을 «실행하는» 쪽(mysql/node/bash <<EOF)은 아래에서 원문(raw) 전체로 따로 본다.
function cutHeredocs(text) {
  const out = []; let tag = null; let dash = false;
  for (const line of text.split('\n')) {
    if (tag) { if ((dash ? line.replace(/^\t+/, '') : line).trim() === tag) { tag = null; } continue; }
    out.push(line);
    const m = line.match(/<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/);
    if (m && !/<<</.test(line)) { tag = m[3]; dash = m[1] === '-'; }
  }
  return out.join('\n');
}
const cmd = cutHeredocs(raw);
const unquote = (t) => t.replace(/\\./g, '__').replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
// 따옴표 안을 지운 사본으로 명령 구조를 본다 — grep "a > b" 같은 무늬를 쓰기로 오판하지 않게
const stripped = unquote(cmd);

const SQL_WRITE = /\b(INSERT\s+(IGNORE\s+)?INTO|UPDATE\s+[`\w.]+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER)|CREATE\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER|USER)|TRUNCATE(\s+TABLE)?\s+[`\w]|REPLACE\s+INTO|RENAME\s+TABLE|GRANT\s+\w|REVOKE\s+\w|LOAD\s+DATA)\b/i;
const CODE_WRITE = /(\.(create|bulkCreate|update|upsert|destroy|save|increment|decrement|restore|sync|truncate|drop)\s*\(|\b(writeFileSync|appendFileSync|writeFile|appendFile|unlinkSync|unlink|rmSync|rmdirSync|renameSync|copyFileSync|mkdirSync|createWriteStream|symlinkSync|chmodSync|truncateSync)\s*\(|\.(rm|rmdir|rename|mkdir|copyFile|cp|symlink|link|chmod|chown|unlink|writeFile|appendFile|writev?)\s*\(|\bfs\.(promises\.)?(truncate|open)\s*\(|\bopen\s*\([^)]*(,\s*|mode\s*=\s*)['"][wax+]|\bos\.(remove|unlink|rename|replace|makedirs|mkdir|rmdir)\s*\(|shutil\.|\.write_text\s*\(|\.write_bytes\s*\(|\.unlink\s*\(|child_process|execSync|spawnSync|\bsubprocess\b|os\.system\s*\()/;
const DEPLOY = /(deploy-planq|deploy-prod|make-deploy-snapshot|close-deployed-feedback|backup-planq-prod|\/배포|https?:\/\/(www\.)?planq\.kr[^ ]*\/api\/(?!health))/;
const EXECUTOR = /(^|[\s;&|(\/])(mysql|mariadb|node|nodejs|python3?|sqlite3)\b/;
// SQL 무늬는 «실행하는 명령» 이 있을 때만 — grep "DELETE FROM" 같은 코드 조사·계획 본문은 막지 않는다
if (SQL_WRITE.test(raw) && EXECUTOR.test(stripped)) deny('DB 쓰기 SQL');
if (/(^|[\s;&|(\/])(mysql|mariadb)\b/.test(stripped) && /(\bsource\s+\S|\\\.\s*\S)/i.test(raw)) deny('mysql source — 실행할 SQL 파일을 판정할 수 없음');
if (DEPLOY.test(cmd)) deny('배포·운영 관련 명령');

const HOME = process.env.HOME || '/home/irene';
function expandTarget(t) {
  const x = t.replace(/^\$\{?CLAUDE_JOB_DIR\}?/, path.join(HOME, '.claude/jobs/_job'))
    .replace(/^\$\{?HOME\}?/, HOME).replace(/^~(?=\/|$)/, HOME);
  return /\$|`/.test(x) ? null : x; // 그 밖의 변수는 값을 알 수 없다
}

// 명령 단위로 자른다 (; && || | & 줄바꿈 $( ` 괄호) — cd 는 순서대로 따라가 상대 경로를 그 자리 기준으로 푼다
const segments = stripped.split(/\|\||&&|[;|&\n`]|\$\(|[()]/).map((x) => x.trim()).filter(Boolean);

const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'nice', 'ionice', 'command', 'builtin', 'exec', 'stdbuf', 'xargs', 'unbuffer']);
const FILE_MUTATORS = new Set(['rm', 'rmdir', 'unlink', 'mv', 'cp', 'touch', 'mkdir', 'chmod', 'chown', 'chgrp', 'truncate', 'tee', 'install', 'dd', 'shred', 'patch', 'rsync', 'scp']);
const ALWAYS_DENY = new Set(['eval', 'ln', 'kill', 'pkill', 'killall', 'ssh', 'sftp', 'mysql_upgrade', 'mysqladmin', 'mysqldump', 'systemctl', 'service', 'crontab', 'at', 'reboot', 'shutdown', 'vite', 'tsc', 'webpack', 'yarn', 'pnpm', 'pip', 'pip3', 'apt', 'apt-get', 'docker', 'claude', 'codex']);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'cat-file', 'shortlog', 'describe', 'rev-list', 'merge-base', 'name-rev', 'for-each-ref', 'reflog', 'whatchanged', 'help', 'version', 'check-ignore', 'count-objects']);

// git branch 는 이름을 주면 «만들기» 다 — 이름 인자는 목록·조회 옵션(--list·--contains…)과 함께일 때만 읽기
function gitBranchIsRead(rest) {
  const opts = rest.filter((a) => a.startsWith('-'));
  const names = rest.filter((a) => !a.startsWith('-'));
  const READ_OPTS = /^(--show-current|--list|-l|-a|--all|-r|--remotes|-v|-vv|--verbose|--contains|--no-contains|--merged|--no-merged|--points-at|--sort=.*|--format=.*|--no-color|--color.*)$/;
  if (!opts.every((a) => READ_OPTS.test(a))) return false;
  return names.length === 0 || opts.some((a) => /^(--list|-l|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(a));
}

function words(seg) { return seg.split(/\s+/).filter(Boolean); }

function checkNodeOrPython(bin, args) {
  // 인라인 코드(-e/-c/-p)·히어독으로 먹이는 코드는 원문 전체, 실행 파일은 그 내용을 본다
  if (CODE_WRITE.test(raw)) deny(`${bin} — 파일·DB 쓰기 코드`);
  if (args.some((a) => /(^|\/)(tsc|vite|webpack)$|typescript\/bin|vite\/bin/.test(a))) deny(`${bin} — 빌드 도구 실행`);
  const file = args.find((a) => !a.startsWith('-') && /\.(c?js|mjs|ts|py)$/.test(a.replace(/['"]/g, '')));
  if (!file) return;
  const f = file.replace(/['"]/g, '');
  const base = path.basename(f);
  if (/(^|\/)e2e\/|canary-|health-check|sync-database|migrate|seed|backfill|setup-|fix-|cleanup|create-test|bump-|feedback-reply|test-/.test(f)) {
    deny(`${bin} ${f} — 데이터를 만들거나 고치는 스크립트(검사 픽스처·마이그레이션 포함)`);
  }
  if (base === 'guard-invariants.js') {
    if (/--update-baseline|--write|--fix/.test(cmd)) deny('guard-invariants 베이스라인 갱신');
    return; // 정적 검사(읽기) — 결과만 출력한다
  }
  let src = '';
  try { src = fs.readFileSync(real(f), 'utf8'); } catch { return; } // 없는 파일 — 실행해도 실패할 뿐
  if (SQL_WRITE.test(src) || CODE_WRITE.test(src)) deny(`${bin} ${f} — 스크립트 안에 파일·DB 쓰기 코드`);
}

for (const seg of segments) {
  // 리다이렉트로 파일에 쓰기 — 임시 자리만 허용 (2>&1 · >&2 는 쓰기 아님 · => -> 는 리다이렉트 아님)
  for (const m of seg.matchAll(/(?:^|[^<>&0-9=\-])(?:[0-9]*|&)>>?\|?\s*(?!&)([^\s;&|()<>]+)/g)) {
    const target = m[1];
    if (target === "''" || target === '""' || /^['"]/.test(target)) deny('따옴표로 감싼 리다이렉트 대상(판정 불가)');
    const t = expandTarget(target);
    if (!t) deny(`> ${target} — 변수가 든 리다이렉트 대상(판정 불가)`);
    if (!under(t, SCRATCH)) deny(`> ${target} — 계획 폴더·임시 자리 밖으로 리다이렉트 쓰기`);
  }

  let w = words(seg);
  // 앞의 VAR=값 · 감싸는 명령(sudo/env/timeout N/xargs…) 걷기
  for (;;) {
    if (!w.length) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w = w.slice(1); continue; }
    if (w[0] === 'timeout') { w = w.slice(1); while (w.length && /^-|^\d/.test(w[0])) w = w.slice(1); continue; }
    if (WRAPPERS.has(path.basename(w[0]))) { w = w.slice(1); while (w.length && w[0].startsWith('-')) w = w.slice(1); continue; }
    break;
  }
  if (!w.length) continue;
  const bin = path.basename(w[0]);
  const args = w.slice(1);

  if (bin === 'cd') {
    const d = args[0] ? expandTarget(args[0]) : HOME;
    if (d && d !== '-') BASE = real(d);
    continue;
  }
  if (ALWAYS_DENY.has(bin)) deny(`${bin} — 정찰 방에서 쓰지 않는 명령`);
  if (/^(bash|sh|zsh|dash)$/.test(bin)) {
    if (args.some((a) => a === '-c')) deny(`${bin} -c — 안쪽 명령을 판정할 수 없음`);
    if (!args.some((a) => !a.startsWith('-') && !a.startsWith('<'))) deny(`${bin} — 표준입력 셸(안쪽 명령을 판정할 수 없음)`);
  }
  if (/^(bash|sh|zsh|dash|source|\.)$/.test(bin) && args.some((a) => /\.sh$/.test(a))) deny(`${bin} 스크립트 실행 — 내용 판정 불가`);
  if (/\.sh$/.test(w[0]) && w[0].includes('/')) deny(`${w[0]} — 셸 스크립트 실행`);
  if (/(^|\/)(tsc|vite|webpack)$|typescript\/bin|vite\/bin/.test(w[0])) deny(`${w[0]} — 빌드 도구 실행`);

  if (FILE_MUTATORS.has(bin)) {
    let targets = args.filter((a) => !a.startsWith('-'));
    // 복사류는 «원본» 을 바꾸지 않는다 — 받는 쪽(마지막 인자)만 본다. mv·rm·tee 등은 전부 바뀐다.
    if (['cp', 'install', 'rsync', 'scp'].includes(bin)) targets = targets.slice(-1);
    if (targets.some((a) => a === "''" || a === '""')) deny(`${bin} — 따옴표로 감싼 대상(판정 불가)`);
    const ex = targets.map(expandTarget);
    if (!ex.length || ex.some((t) => !t || !under(t, SCRATCH))) deny(`${bin} — 계획 폴더·임시 자리 밖 파일 바꾸기`);
  }
  if (bin === 'sed' && args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) deny('sed -i — 제자리 고치기');
  if (bin === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) deny('perl -i — 제자리 고치기');
  if ((bin === 'awk' || bin === 'gawk') && /-i\s*inplace/.test(seg)) deny('awk -i inplace — 제자리 고치기');
  if (bin === 'find' && args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(a))) deny('find -delete/-exec — 파일 바꾸기 가능');

  if (bin === 'git') {
    let j = 0;
    while (j < args.length && args[j].startsWith('-')) { j += (/^-(C|c)$/.test(args[j]) || /^--(git-dir|work-tree)$/.test(args[j])) ? 2 : 1; }
    const sub = args[j];
    const rest = args.slice(j + 1);
    const readSub = GIT_READ.has(sub)
      || (sub === 'branch' && gitBranchIsRead(rest))
      || (sub === 'stash' && ['list', 'show'].includes(rest[0]))
      || (sub === 'remote' && (rest.length === 0 || ['-v', 'show', 'get-url'].includes(rest[0])))
      || (sub === 'config' && rest.some((a) => /^(--get|--get-all|--list|-l|--get-regexp)$/.test(a)));
    if (!sub || !readSub) deny(`git ${sub || ''} — 읽기 명령만 허용(status·diff·log·show…)`);
    if (args.some((a) => /^--output/.test(a))) deny('git --output — 파일 쓰기');
  }

  if (bin === 'npm' || bin === 'npx') {
    const sub = args.find((a) => !a.startsWith('-'));
    if (bin === 'npx' || !['ls', 'list', 'view', 'outdated', 'help', 'root', 'bin', 'prefix', 'explain', 'why'].includes(sub)) {
      deny(`${bin} ${sub || ''} — 빌드·설치·스크립트 실행`);
    }
  }

  if (bin === 'pm2') {
    const sub = args.find((a) => !a.startsWith('-'));
    if (!['list', 'ls', 'status', 'logs', 'log', 'describe', 'show', 'info', 'jlist', 'prettylist', 'env'].includes(sub)) deny(`pm2 ${sub || ''} — 프로세스 바꾸기`);
    if (sub === 'logs' && !args.includes('--nostream')) deny('pm2 logs 는 --nostream 으로(끝나지 않는 명령)');
  }

  if (bin === 'mysql' || bin === 'mariadb') {
    // SQL 쓰기 무늬는 원문 단계에서 막았다. 표준입력으로 파일을 먹이면 내용을 못 보므로 막는다(히어독 <<·<<< 는 원문으로 봤다).
    if (/(^|[^<])<(?!<)\s*\S/.test(seg)) deny('mysql < 파일 — 실행할 SQL 을 판정할 수 없음');
  }

  if (bin === 'curl' || bin === 'wget' || bin === 'http') {
    const dashboard = /(127\.0\.0\.1|localhost):8800\b/.test(seg + ' ' + cmd);
    // 대소문자를 가른다 — -sf(실패 시 조용히)·-D(머리말 덤프)는 본문 전송이 아니다(Fable 2026-10-12)
    const writes = args.some((a) => /^-(d|F|T)$|^-[a-zA-Z]*[dFT]$|^--(data|data-raw|data-binary|data-urlencode|form|upload-file|json)\b|^-X(POST|PUT|PATCH|DELETE)/.test(a))
      || /(\s-X\s*|--request[=\s]\s*)(POST|PUT|PATCH|DELETE)/i.test(cmd);
    if (writes && !dashboard) deny(`${bin} — API 쓰기 요청(POST/PUT/PATCH/DELETE·본문 전송)`);
    const outIdx = args.findIndex((a) => /^-(o|O)$|^--(output|remote-name)$/.test(a) || /^-[a-zA-Z]*O$/.test(a));
    if (outIdx >= 0) {
      const flag = args[outIdx];
      const t = /^-o$|^--output$/.test(flag) ? expandTarget(args[outIdx + 1] || '') : null;
      if (!t || !under(t, SCRATCH)) deny(`${bin} -o — 내려받아 파일 쓰기(임시 자리만)`);
    }
  }

  if (/^(node|nodejs|python|python3|ts-node|tsx|deno|bun)$/.test(bin)) checkNodeOrPython(bin, args);
}
}
