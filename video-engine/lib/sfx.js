// 효과음 합성 — 클릭·휙(전환)·톡(자막 등장)·띵(강조). 외부 소재 없이 ffmpeg 수식으로 만든다(저작권 0).
//   node lib/sfx.js → assets/sfx/*.wav
const path = require('path');
const { ff } = require('./ffmpeg');
const OUT = path.join(__dirname, '..', 'assets', 'sfx');
const SFX = {
  // 마우스 클릭 — 아주 짧은 고역 잡음 + 낮은 톡
  click: ['-f', 'lavfi', '-i', "aevalsrc='(random(0)*2-1)*exp(-t*900)*0.6+sin(2*PI*1800*t)*exp(-t*400)*0.25':s=48000:d=0.06", '-af', 'highpass=f=900,volume=0.9'],
  // 전환 휙 — 잡음이 커졌다 작아지며 대역이 위로 쓸려 올라간다
  whoosh: ['-f', 'lavfi', '-i', "aevalsrc='(random(0)*2-1)*sin(PI*t/0.45)^2':s=48000:d=0.45", '-af', 'bandpass=f=1200:w=1.6,highpass=f=300,lowpass=f=6000,volume=0.55,afade=t=out:st=0.3:d=0.15'],
  // 자막·카드 등장 톡 — 짧은 사인 하강
  pop: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(900-2400*t)*t)*exp(-t*38)*0.5':s=48000:d=0.12"],
  // 숫자·핵심 강조 띵 — 두 음 화음, 길게 감쇠
  ding: ['-f', 'lavfi', '-i', "aevalsrc='(sin(2*PI*1318.5*t)+0.6*sin(2*PI*1975.5*t)+0.3*sin(2*PI*2637*t))*exp(-t*5)*0.22':s=48000:d=0.9"],
  // 로고 등장 — 낮은 붐 + 잔향
  boom: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(70-30*t)*t)*exp(-t*3.2)*0.7+(random(0)*2-1)*exp(-t*14)*0.12':s=48000:d=1.4", '-af', 'lowpass=f=900,aecho=0.6:0.5:60:0.3'],
};
if (require.main === module) {
  for (const [k, args] of Object.entries(SFX)) {
    ff([...args, '-ac', '2', '-c:a', 'pcm_s16le', path.join(OUT, `${k}.wav`)]);
    console.log('sfx', k);
  }
}
module.exports = { SFX };
