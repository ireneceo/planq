// cronalive-exempt: 공개 회사 페이지 생성 — 술어(isPubliclyListed)가 지운 워크스페이스를 이미 뺀다
// 검색용 회사 페이지·회사 찾기 HTML (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §8)
//
// services/seoArtifacts.js 가 부른다 — 같은 틀(renderPage)·같은 원칙: **운영 서버에서 운영 DB 로** 만든다,
//   .gz 를 짝으로 쓴다, 자기가 만든 파일만 지운다(seoArtifacts 의 목록 파일이 이 페이지들도 담는다).
// ★ «공개인가» 는 services/workspacePage.isPubliclyListed **한 술어** — 공개 API·디렉터리와 같은 것.
// ★ 본문·JSON-LD 는 publicPageView 와 **같은 값**(화이트리스트) — 가린 항목은 HTML·JSON-LD 어디에도 없다.
//   사용자 글은 renderPage 가 전부 이스케이프한다(JSON-LD 안의 `<` 도 끊는다).
// ★ 끄기·내리기는 그 요청 안에서 removeWorkspacePageFiles 로 파일·.gz 를 바로 지운다(다음 0시까지 남으면 «껐는데 보인다»).
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const CAT_LABEL = {
  ko: { design: '디자인·브랜딩', marketing: '마케팅·광고', development: '개발·IT', media: '영상·사진', consulting: '경영·컨설팅',
    accounting: '세무·회계', legal: '법무·노무·특허', translation: '번역·통역', education: '교육·코칭', interior: '건축·인테리어',
    manufacturing: '제조·유통', events: '행사·기획', realestate: '부동산', healthcare: '의료·헬스케어', lifestyle: '생활·뷰티 서비스', other: '기타' },
  en: { design: 'Design & branding', marketing: 'Marketing & ads', development: 'Development & IT', media: 'Video & photo',
    consulting: 'Management consulting', accounting: 'Tax & accounting', legal: 'Legal, labor & patents', translation: 'Translation',
    education: 'Education & coaching', interior: 'Architecture & interior', manufacturing: 'Manufacturing & distribution',
    events: 'Events & planning', realestate: 'Real estate', healthcare: 'Healthcare', lifestyle: 'Lifestyle & beauty', other: 'Other' },
};
const REGION_LABEL = {
  ko: { seoul: '서울', busan: '부산', daegu: '대구', incheon: '인천', gwangju: '광주', daejeon: '대전', ulsan: '울산', sejong: '세종',
    gyeonggi: '경기', gangwon: '강원', chungbuk: '충북', chungnam: '충남', jeonbuk: '전북', jeonnam: '전남', gyeongbuk: '경북',
    gyeongnam: '경남', jeju: '제주', nationwide: '전국·온라인' },
  en: { seoul: 'Seoul', busan: 'Busan', daegu: 'Daegu', incheon: 'Incheon', gwangju: 'Gwangju', daejeon: 'Daejeon', ulsan: 'Ulsan',
    sejong: 'Sejong', gyeonggi: 'Gyeonggi', gangwon: 'Gangwon', chungbuk: 'Chungbuk', chungnam: 'Chungnam', jeonbuk: 'Jeonbuk',
    jeonnam: 'Jeonnam', gyeongbuk: 'Gyeongbuk', gyeongnam: 'Gyeongnam', jeju: 'Jeju', nationwide: 'Nationwide / online' },
};
const THIN_CATEGORY = 3;   // 공개 회사 3곳 미만 업종 목록은 noindex + 사이트맵 제외(얇은 페이지 — §8)

/** 지금 공개된 워크스페이스 — isPubliclyListed 한 술어로 거른다. */
async function listedBusinesses() {
  const { Business } = require('../models');
  const wp = require('./workspacePage');
  if (!(await wp.publicPagesOn())) return [];
  const rows = await Business.findAll({
    where: { public_page_status: 'public', deleted_at: null, slug: { [Op.ne]: null } },
    attributes: wp.PUBLIC_ATTRS,
  });
  const out = [];
  for (const b of rows) if (await wp.isPubliclyListed(b)) out.push(b);
  return out;
}

/** 회사 페이지 첫 문단 — 워크스페이스 값만으로 조립한 사실 한 문장(AI 가 인용하기 쉬운 모양 · §8 GEO). */
function geoSentence(v, lang) {
  const cat = v.category ? CAT_LABEL[lang][v.category] : null;
  const reg = v.region ? REGION_LABEL[lang][v.region] : null;
  const svcs = v.services.slice(0, 3).map((s) => s.name);
  if (lang === 'en') {
    return `${v.name} is a ${cat ? cat.toLowerCase() : 'professional services'} company${reg ? ` based in ${reg}` : ''}${svcs.length ? `, offering ${svcs.join(', ')}` : ''}.`;
  }
  return `${v.name}은(는) ${reg ? `${reg}의 ` : ''}${cat || '전문 서비스'} 회사${svcs.length ? `로, ${svcs.join('·')}를 제공합니다` : '입니다'}.`;
}

function companyLd(origin, v, url, lang) {
  const hasAddr = !!(v.contact && v.contact.address);
  const node = {
    '@type': hasAddr ? 'LocalBusiness' : 'Organization',
    '@id': `${url}#org`, name: v.name, url,
    ...(v.tagline ? { description: v.tagline } : {}),
    ...(v.logo_url ? { logo: `${origin}${v.logo_url}` } : {}),
    ...(v.contact && v.contact.website ? { sameAs: [v.contact.website] } : {}),
    ...(v.contact && v.contact.phone ? { telephone: v.contact.phone } : {}),
    ...(hasAddr ? { address: v.contact.address } : {}),
    ...(v.services.length ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog', name: lang === 'en' ? 'Services' : '서비스',
        // 가격은 숫자가 아니라(«300만원부터») 넣지 않는다 — 별점·후기 schema 도 없다(없는 평판을 만들지 않는다)
        itemListElement: v.services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name, ...(s.summary ? { description: s.summary } : {}) } })),
      },
    } : {}),
  };
  if (hasAddr && v.work_hours) {
    const D = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
    node.openingHoursSpecification = Object.entries(v.work_hours).filter(([, x]) => x)
      .map(([k, x]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: D[k], opens: hh(x[0]), closes: hh(x[1]) }));
  }
  return node;
}

/**
 * seoArtifacts 가 부른다 — { out: [{rel, html}], urls: [{loc, lastmod}] } 를 돌려준다(쓰기·목록·지우기는 seoArtifacts 몫).
 * @param {object} p { origin, template, renderPage, breadcrumb, esc }
 */
async function buildWorkspacePages({ origin, template, renderPage, breadcrumb }) {
  const wp = require('./workspacePage');
  const list = await listedBusinesses();
  const out = [];
  const urls = [];
  const mark = (html, lang) => html.replace(`<html lang="${lang}">`, `<html lang="${lang}" data-seo-generated="1">`);
  const noindex = (html) => html.replace('</head>', '    <meta name="robots" content="noindex,follow" />\n  </head>');

  for (const lang of ['ko', 'en']) {
    const pre = lang === 'en' ? '/en' : '';
    const T = lang === 'en'
      ? { dir: 'Find a company', dirTitle: 'Find a company | PlanQ', dirDesc: 'Find companies that work with PlanQ — browse by industry and send an inquiry or book a consultation directly.' }
      : { dir: '회사 찾기', dirTitle: '회사 찾기 | PlanQ', dirDesc: 'PlanQ 로 일하는 회사를 업종별로 찾아보고 바로 문의하거나 상담을 예약하세요.' };

    // ① 회사 페이지 — 영어 페이지는 영어 소개글이 있을 때만(hreflang 짝)
    const byCat = new Map();
    for (const b of list) {
      const e = wp.entryOf(b);
      if (lang === 'en' && !e.intro_en) continue;
      const v = wp.publicPageView(b, { lang });
      const loc = `${origin}${pre}/w/${encodeURIComponent(b.slug)}/`;
      const catL = v.category ? CAT_LABEL[lang][v.category] : null;
      const regL = v.region ? REGION_LABEL[lang][v.region] : null;
      const title = `${v.name}${catL ? ` — ${catL}` : ''}${regL ? ` · ${regL}` : ''} | PlanQ`;
      const desc = [v.tagline, v.intro].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 155);
      const info = [];
      if (v.contact.website) info.push(`${lang === 'en' ? 'Website' : '홈페이지'}: ${v.contact.website}`);
      if (v.contact.phone) info.push(`${lang === 'en' ? 'Phone' : '전화'}: ${v.contact.phone}`);
      if (v.contact.email) info.push(`${lang === 'en' ? 'Email' : '이메일'}: ${v.contact.email}`);
      if (v.contact.address) info.push(`${lang === 'en' ? 'Address' : '주소'}: ${v.contact.address}`);
      if (v.representative) info.push(`${lang === 'en' ? 'Representative' : '대표자'}: ${v.representative}`);
      for (const x of v.extras) info.push(`${x.label}: ${x.value}`);
      const blocks = [
        { tag: 'p', text: geoSentence(v, lang) },
        ...(v.tagline ? [{ tag: 'p', text: v.tagline }] : []),
        ...(v.intro ? [{ tag: 'h2', text: lang === 'en' ? 'About' : '소개' }, ...v.intro.split(/\n+/).filter(Boolean).map((t) => ({ tag: 'p', text: t }))] : []),
        ...(v.services.length ? [{ tag: 'h2', text: lang === 'en' ? 'Services' : '서비스' },
          ...v.services.map((s) => ({ tag: 'li', text: [s.name, s.summary, s.price_text].filter(Boolean).join(' — ') }))] : []),
        ...(info.length ? [{ tag: 'h2', text: lang === 'en' ? 'Company info' : '회사 정보' }, ...info.map((t) => ({ tag: 'li', text: t }))] : []),
        ...(v.category ? [{ tag: 'a', href: `${pre}/directory/${v.category}/`, text: lang === 'en' ? `More ${catL} companies` : `${catL} 회사 더 보기` }] : []),
      ];
      const crumbs = [{ name: 'PlanQ', path: `${pre}/` }, { name: T.dir, path: `${pre}/directory/` },
        ...(v.category ? [{ name: catL, path: `${pre}/directory/${v.category}/` }] : []),
        { name: v.name, path: `${pre}/w/${encodeURIComponent(b.slug)}/` }];
      const hasEnPair = !!e.intro_en;
      const html = renderPage(template, {
        lang, title, description: desc || T.dirDesc, url: loc, canonical: loc, h1: v.name, blocks,
        image: v.logo_url ? `${origin}${v.logo_url}` : undefined,
        alternates: hasEnPair ? { ko: `${origin}/w/${encodeURIComponent(b.slug)}/`, en: `${origin}/en/w/${encodeURIComponent(b.slug)}/` } : undefined,
        nav: [{ href: `${pre}/directory/`, label: T.dir }],
        jsonld: { '@context': 'https://schema.org', '@graph': [companyLd(origin, v, loc, lang), breadcrumb(origin, crumbs)] },
      });
      out.push({ rel: path.join(...(lang === 'en' ? ['en'] : []), 'w', b.slug, 'index.html'), html: mark(html, lang) });
      urls.push({ loc, lastmod: b.updated_at ? new Date(b.updated_at).toISOString().slice(0, 10) : undefined, changefreq: 'weekly', priority: '0.6' });
      if (v.category) {
        if (!byCat.has(v.category)) byCat.set(v.category, []);
        byCat.get(v.category).push(v);
      }
    }

    // ② 회사 찾기 — 전체 · 업종별(얇은 업종은 noindex + 사이트맵 제외)
    const listBlocks = (items) => items.map((v) => ({
      tag: 'a', href: `${pre}/w/${encodeURIComponent(v.slug)}/`, text: v.name,
      sub: [v.category ? CAT_LABEL[lang][v.category] : null, v.region ? REGION_LABEL[lang][v.region] : null, v.tagline].filter(Boolean).join(' · '),
    }));
    const all = [...byCat.values()].flat();
    const dirLoc = `${origin}${pre}/directory/`;
    out.push({
      rel: path.join(...(lang === 'en' ? ['en'] : []), 'directory', 'index.html'),
      html: mark(renderPage(template, {
        lang, title: T.dirTitle, description: T.dirDesc, url: dirLoc, canonical: dirLoc, h1: T.dir,
        alternates: { ko: `${origin}/directory/`, en: `${origin}/en/directory/` },
        blocks: [{ tag: 'p', text: T.dirDesc },
          ...[...byCat.keys()].map((c) => ({ tag: 'a', href: `${pre}/directory/${c}/`, text: CAT_LABEL[lang][c], sub: `${byCat.get(c).length}` })),
          ...listBlocks(all)],
        nav: [{ href: `${pre}/`, label: 'PlanQ' }],
        jsonld: { '@context': 'https://schema.org', '@graph': [
          { '@type': 'CollectionPage', name: T.dir, url: dirLoc, inLanguage: lang },
          { '@type': 'ItemList', itemListElement: all.map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}${pre}/w/${encodeURIComponent(v.slug)}/`, name: v.name })) },
        ] },
      }), lang),
    });
    urls.push({ loc: dirLoc, changefreq: 'daily', priority: '0.6' });
    for (const [c, items] of byCat) {
      const loc = `${origin}${pre}/directory/${c}/`;
      const label = CAT_LABEL[lang][c];
      const thin = items.length < THIN_CATEGORY;
      let html = renderPage(template, {
        lang, title: lang === 'en' ? `${label} companies | PlanQ` : `${label} 회사 | PlanQ`,
        description: lang === 'en' ? `${items.length} ${label.toLowerCase()} companies on PlanQ. Send an inquiry or book a consultation directly.`
          : `PlanQ 로 일하는 ${label} 회사 ${items.length}곳. 바로 문의하거나 상담을 예약하세요.`,
        url: loc, canonical: loc, h1: lang === 'en' ? `${label} companies` : `${label} 회사`,
        alternates: { ko: `${origin}/directory/${c}/`, en: `${origin}/en/directory/${c}/` },
        blocks: listBlocks(items), nav: [{ href: `${pre}/directory/`, label: T.dir }],
        jsonld: { '@context': 'https://schema.org', '@graph': [
          { '@type': 'CollectionPage', name: label, url: loc, inLanguage: lang },
          breadcrumb(origin, [{ name: 'PlanQ', path: `${pre}/` }, { name: T.dir, path: `${pre}/directory/` }, { name: label, path: `${pre}/directory/${c}/` }]),
        ] },
      });
      if (thin) html = noindex(html); else urls.push({ loc, changefreq: 'weekly', priority: '0.5' });
      out.push({ rel: path.join(...(lang === 'en' ? ['en'] : []), 'directory', c, 'index.html'), html: mark(html, lang) });
    }
  }
  return { out, urls, count: list.length };
}

/** 끄기·내리기·주소 바꾸기 — 그 요청 안에서 그 회사의 생성 파일(ko·en, .gz)을 바로 지운다. */
function removeWorkspacePageFiles(slug, { dir } = {}) {
  if (!slug || /[^a-z0-9-]/.test(slug)) return 0;
  const root = dir || require('./seoArtifacts').frontendDir();
  let n = 0;
  for (const rel of [['w', slug], ['en', 'w', slug]]) {
    const folder = path.join(root, ...rel);
    for (const f of ['index.html', 'index.html.gz']) {
      const abs = path.join(folder, f);
      try {
        if (f === 'index.html' && !fs.readFileSync(abs, 'utf8').includes('data-seo-generated')) continue;   // 우리가 만든 것만
        fs.unlinkSync(abs); n += 1;
      } catch { /* 없음 */ }
    }
    try { fs.rmdirSync(folder); } catch { /* 비어 있지 않거나 없음 */ }
  }
  return n;
}

/** 상태가 바뀐 뒤 — 사이트맵·회사 찾기 목록을 곧 다시 만든다(전체 생성, 실패해도 다음 0시에 다시). */
let _regen = null;
function regenerateSoon() {
  if (_regen) return;
  _regen = setTimeout(() => {
    _regen = null;
    require('./seoArtifacts').generateSeoArtifacts({ log: console })
      .catch((e) => console.warn('[seo-workspace] regenerate failed', e.message));
  }, 2000);
}

/**
 * 매일 — 노출 자격(유료 + 체험 중)을 잃은 공개 페이지를 내린다(off) + 대표에게 알림 1건(§3 «자동으로 내려가는 경우»).
 *   ★ 읽기 술어(isPubliclyListed)가 이미 자격을 보므로 화면·검색에는 그날부터 안 나온다 — 이 정리는 상태를 사실대로 맞추고 알리는 일이다.
 */
async function sweepIneligible({ ioApp } = {}) {
  const { Business, BusinessMember } = require('../models');
  const wp = require('./workspacePage');
  const rows = await Business.findAll({ where: { public_page_status: 'public', deleted_at: null }, attributes: ['id', 'slug', 'name', 'brand_name'] });
  let down = 0;
  for (const b of rows) {
    if (await wp.listingEligible(b.id)) continue;
    const [n] = await Business.update({ public_page_status: 'off' }, { where: { id: b.id, public_page_status: 'public' } });
    if (!n) continue;
    down += 1;
    removeWorkspacePageFiles(b.slug);
    try {
      const { notify } = require('../routes/notifications');
      const owners = await BusinessMember.findAll({ where: { business_id: b.id, role: 'owner', removed_at: null }, attributes: ['user_id'], raw: true });
      for (const o of owners) {
        if (o.user_id) {
          await notify({ userId: o.user_id, businessId: b.id, eventKind: 'system',
            titleSpec: { feature: 'system', action: 'public_page_ineligible' },
            link: '/business/settings/public-page', entityType: 'business', entityId: b.id, ioApp });
        }
      }
    } catch (e) { console.warn('[seo-workspace] ineligible notify 실패', e.message); }
  }
  return { checked: rows.length, down };
}

module.exports = { buildWorkspacePages, removeWorkspacePageFiles, regenerateSoon, sweepIneligible, listedBusinesses, CAT_LABEL, REGION_LABEL, THIN_CATEGORY };
