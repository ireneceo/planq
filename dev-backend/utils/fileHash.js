// 파일 SHA-256 — dedup 의 단일 원천.
//
// 같은 함수가 routes/files.js 와 services/gdriveIngest.js 에 **각각 복사돼** 있었다.
// 해시 규칙이 갈라지면 같은 파일이 경로에 따라 다른 해시를 갖고, dedup 이 조용히 안 걸린다
// (memory: 베낀 컴포넌트는 반드시 갈라진다 — 껍데기를 뽑아라).
const crypto = require('crypto');
const fs = require('fs');

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { sha256OfFile };
