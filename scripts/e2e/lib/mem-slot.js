// scripts/e2e/lib/mem-slot.js — 크롬 시험을 서버 «메모리 자리표» 안에서 돌린다 (2026-11-03)
//   왜: 11-03 PlanQ 빌드 둘이 겹쳐 서버가 멈췄다 → 서버 공용 자리표 ~/dev-server/bin/mem-slot (README §2).
//     크롬 시험도 무거운 일이라 같은 줄에 선다 — 먼저 선 순서대로 메모리 몫을 받고, 상자를 넘으면 이 시험만 죽는다(137).
//   하는 일: 이 파일을 **맨 처음** require 하면, 자리표 밖에서 돌고 있을 때 같은 명령(node + 인자)을
//     `mem-slot run planq-chrome <몫> -- …` 로 다시 띄우고 그 종료 코드로 끝낸다(지금 프로세스는 아무 일도 안 함).
//     자리표 안(PLANQ_MEM_SLOT=1)에서는 아무것도 안 한다 — run.js 가 잡은 자리를 카나리가 다시 잡지 않는다.
//   부르는 곳: run.js · lib/browser.js · puppeteer 를 직접 여는 카나리들(첫 줄).
//   몫: 1500MB — 실측 2026-11-03 collapsed+mobilechrome 상자 정점 1140MB(+15% ≈ 1310) + 더 무거운 스위트 여유.
//     몫 1000(상자 1300)은 정점이 상자 한도에 붙어 눌린 채 돌았다. 끝날 때 찍는 정점이 늘면 고친다.
//   PLANQ_CHROME_MB 로 한 번만 더 크게 받을 수 있다 — 밤 순찰(--suite patrol, 7환경 한 번에)은 몫 1500(상자 1950)을 넘어
//     11-03 밤 137 로 죽었다(결과 0) → nightly-patrol.sh 가 3000 을 준다. 끝에 찍히는 정점을 보고 줄인다.
//   75 = 차례가 60분 안에 안 옴(시험 안 함 — 우회하지 말 것).
const fs = require('fs');
const { spawnSync } = require('child_process');

const MEM_SLOT = '/home/irene/dev-server/bin/mem-slot';
const NEED_MB = Number(process.env.PLANQ_CHROME_MB) > 0 ? Number(process.env.PLANQ_CHROME_MB) : 1500;

if (!process.env.PLANQ_MEM_SLOT && fs.existsSync(MEM_SLOT)) {
  // 운영 배포가 도는 중이면 자리를 잡기 **전에** 기다린다 — 자리를 쥔 채 기다리면 다른 방의 줄을 막는다.
  //   (run.js 는 스위트마다 다시 본다 — 도중에 시작한 배포용. 판정은 scripts/deploy-busy.sh 한 곳)
  spawnSync('/opt/planq/scripts/deploy-busy.sh', ['--wait', '5400', 'e2e:mem-slot'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const r = spawnSync(MEM_SLOT, ['run', 'planq-chrome', String(NEED_MB), '--', process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, PLANQ_MEM_SLOT: '1' },
  });
  if (r.error) { console.error('[mem-slot] 자리표 실행 실패:', r.error.message); process.exit(1); }
  if (r.status === 75) console.error('[mem-slot] planq-chrome — 메모리 자리표 차례가 안 와서 시험하지 않았다(우회하지 말 것). mem-slot status 로 확인');
  process.exit(r.status === null ? 1 : r.status);
}

// 자리표 상자 안이면 끝날 때 상자 정점을 찍는다 — 몫(NEED_MB)을 실측 정점+15% 로 고칠 때 이 숫자를 본다.
if (process.env.PLANQ_MEM_SLOT && !global.__pqMemSlotPeak) {
  global.__pqMemSlotPeak = true;
  process.on('exit', () => {
    try {
      const cg = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').pop();
      if (!cg.includes('memslot-')) return; // 상자 없이 들어갔으면 남의 cgroup 이다
      const peak = Number(fs.readFileSync(`/sys/fs/cgroup${cg}/memory.peak`, 'utf8'));
      console.error(`[mem-slot] planq-chrome 상자 정점 ${Math.round(peak / 1048576)}MB (몫 ${NEED_MB}MB)`);
    } catch { /* 정점을 못 읽어도 시험 결과와 무관 */ }
  });
}
