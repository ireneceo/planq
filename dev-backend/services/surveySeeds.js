// 설문 «시작 질문 세트» — 새 설문을 만들 때 시드하는 문항(칸). 설계 docs/SURVEY_V2_DESIGN.md §8.1
//   ko/en 문구는 여기 한 곳(서버가 만드는 칸 이름 — 만든 사람의 언어로 저장된다. 표 시드 posts.js 와 같은 방식).
//   필수 = 별점·척도·예/아니오(점수 문항) · 글 문항은 선택.
const crypto = require('crypto');

const SETS = {
  project_review: [
    ['이번 프로젝트 전체 만족도', 'Overall satisfaction with this project', 'rating', '1 = 매우 불만 · 5 = 매우 만족', '1 = very dissatisfied · 5 = very satisfied'],
    ['저희를 지인에게 추천할 의향', 'How likely are you to recommend us', 'scale'],
    ['가장 좋았던 점', 'What went well', 'longtext'],
    ['아쉬웠던 점', 'What could be better', 'longtext'],
    ['다음에도 함께할 의향', 'Would you work with us again', 'yesno'],
  ],
  new_client: [
    ['시작 과정이 매끄러웠나요', 'Was onboarding smooth', 'rating'],
    ['기대와 다른 점', 'Anything different from what you expected', 'longtext'],
    ['가장 먼저 해결되길 바라는 것', 'What should we address first', 'text'],
    ['추천 의향', 'Likelihood to recommend', 'scale'],
  ],
  periodic: [
    ['최근 3개월 서비스 만족도', 'Satisfaction over the last 3 months', 'rating', '1 = 매우 불만 · 5 = 매우 만족', '1 = very dissatisfied · 5 = very satisfied'],
    ['소통 속도', 'Responsiveness', 'rating'],
    ['결과물 품질', 'Quality of deliverables', 'rating'],
    ['추천 의향', 'Likelihood to recommend', 'scale'],
    ['하고 싶은 말', 'Anything else', 'longtext'],
  ],
};
const SCORED = new Set(['rating', 'scale', 'yesno']);
const QUESTION_SETS = ['blank', ...Object.keys(SETS)];

/** @returns {{ columns: object[], required: string[], help: Record<string,string> }} */
function seedQuestions(setKey, lang = 'ko') {
  const list = SETS[setKey] || [];
  const columns = []; const required = []; const help = {};
  list.forEach(([ko, en, type, helpKo, helpEn], i) => {
    const id = 'c' + crypto.randomBytes(4).toString('hex');
    columns.push({ id, name: lang === 'en' ? en : ko, type, order: i });
    if (SCORED.has(type)) required.push(id);
    const h = lang === 'en' ? helpEn : helpKo;
    if (h) help[id] = h;
  });
  return { columns, required, help };
}

module.exports = { seedQuestions, QUESTION_SETS };
