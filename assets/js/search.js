// 왼쪽 검색창의 글자와 사이드바에서 고른 태그로 글을 걸러 본문 자리에 보여 준다.
// - 태그는 여러 개 고를 수 있고, 고른 태그가 모두 달린 글만 나온다.
// - 분류 화면에서는 그 분류 안에서만, 태그 화면에서는 그 태그를 고른 채로 시작한다.
// - 조건은 주소(?q=바닐라&tags=셰리,버번&page=2)에 남아서 즐겨찾기·공유가 된다.
// - 검색은 Pagefind 가 한다. 색인은 배포할 때 만들어지므로 hugo server 미리보기에서는 검색이 되지 않는다.
//   색인에 넣는 값은 layouts/page.html 의 data-pagefind-* 속성에서 정한다.
(() => {
  const PAGE_SIZE = 10;
  const input = document.querySelector('.search-form input[name="q"]');
  const clear = document.querySelector('.search-form .search-clear');
  const main = document.querySelector('main.content');
  const page = document.getElementById('page-content');
  const panel = document.getElementById('search-panel');
  if (!input || !clear || !main || !page || !panel) return;
  const countEl = panel.querySelector('.list-title .count');
  const bar = panel.querySelector('.filter-bar');
  const status = panel.querySelector('.search-status');
  const results = panel.querySelector('.rows');
  const pager = panel.querySelector('.pager');
  const sidebarTags = [...document.querySelectorAll('.sidebar .tag[data-tag]')];
  const treeLinks = [...document.querySelectorAll('.tree a.tree-link')];
  treeLinks.forEach((a) => { a.dataset.base = a.getAttribute('href'); });

  const norm = (s) => s.normalize('NFC').trim().toLowerCase();
  const scope = main.dataset.scope || '';
  const pageTags = main.dataset.term ? [main.dataset.term] : [];

  const uniqueTags = (tags) => {
    const seen = new Set();
    return tags.map((t) => t.trim()).filter((t) => t && !seen.has(norm(t)) && seen.add(norm(t)));
  };
  const sameTags = (a, b) => a.length === b.length && a.every((t) => b.some((u) => norm(u) === norm(t)));

  const params = new URLSearchParams(window.location.search);
  const state = {
    q: params.get('q') || '',
    tags: params.has('tags') ? uniqueTags(params.get('tags').split(',')) : [...pageTags],
    page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1),
  };
  input.value = state.q;

  // 지금 화면이 보여 주는 것과 같은 조건이면 원래 화면을 그대로 둔다.
  const isPageItself = () => !state.q.trim() && sameTags(state.tags, pageTags);

  // ---------- 데이터 (Pagefind) ----------
  let pagefind = null;
  let pagefindLoading = null;
  const loadPagefind = () => {
    pagefindLoading ??= import(input.dataset.pagefind)
      .then(async (module) => {
        // 결과 주소 앞에 /whisky/ 를 붙인다. 웹 워커는 일부 환경에서 색인을 못 읽어서 쓰지 않는다.
        // 걸린 문장(excerpt)은 목록 줄 두 줄 안에 검색어가 보이도록 짧게 받는다.
        await module.options({ baseUrl: input.dataset.base, noWorker: true, excerptLength: 16 });
        await module.init();
        pagefind = module;
      })
      .catch((error) => { pagefindLoading = null; throw error; });
    return pagefindLoading;
  };
  // Pagefind 의 init() 은 색인을 못 받아도 실패로 끝나지 않고, 그 뒤 검색마다 같은 오류를 낸다.
  // 검색이 실패하면 인스턴스를 버려서 다음 동작 때 처음부터 다시 준비하게 한다.
  const resetPagefind = () => {
    const broken = pagefind;
    pagefind = null;
    pagefindLoading = null;
    if (broken) Promise.resolve(broken.destroy?.()).catch(() => {});
  };

  // 걸린 단어 앞은 네 단어만 남겨서, 좁은 화면 두 줄 안에서도 걸린 단어가 보이게 한다.
  // excerpt 는 Pagefind 가 이스케이프한 글자에 <mark> 만 붙인 것이라, 첫 <mark> 앞 부분에는 태그가 없다.
  const trimExcerpt = (html) => {
    const at = html.indexOf('<mark>');
    if (at < 0) return '';
    const head = html.slice(0, at);
    const words = head.trimEnd().split(' ');
    if (words.length <= 4) return html;
    const gap = /\s$/.test(head) ? ' ' : '';
    return `… ${words.slice(-4).join(' ')}${gap}${html.slice(at)}`;
  };

  // 한 쪽(10개)에 보여 줄 글의 목록 정보만 받아 온다.
  // 글자로 검색했고 본문에서 걸렸으면 "캐스크 · 도수" 대신 걸린 문장을 보여 준다.
  // (제목·태그·분류 이름에서만 걸렸으면 본문에 표시할 곳이 없으므로 "캐스크 · 도수"를 그대로 둔다)
  const toItem = (data, withExcerpt) => ({
    title: data.meta.title,
    url: data.url,
    meta: data.meta.line || '',
    excerpt: withExcerpt ? trimExcerpt(data.excerpt) : '',
    date: data.meta.date || '',
    thumb: data.meta.thumb ? `${data.url}${data.meta.thumb}` : '',
  });

  // ---------- 주소 ----------
  // 태그는 쉼표로 이어 붙여 ?tags=셰리,버번 처럼 읽기 쉽게 남긴다.
  const query = ({ withPage }) => {
    const parts = [];
    const q = state.q.trim();
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    if (!sameTags(state.tags, pageTags)) parts.push(`tags=${state.tags.map(encodeURIComponent).join(',')}`);
    if (withPage && state.page > 1) parts.push(`page=${state.page}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  // 주소는 바로 바꾸지 않고 입력이 잠깐 멈췄을 때 한 번만 바꾼다.
  // Safari(WebKit)는 10초에 100번 넘게 바꾸면 오류를 내고, 그러면 검색까지 멈추기 때문이다.
  let urlTimer = 0;
  const writeUrl = () => {
    clearTimeout(urlTimer);
    const next = `${window.location.pathname}${query({ withPage: true })}${window.location.hash}`;
    if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    try {
      window.history.replaceState(null, '', next);
    } catch {
      // 횟수 제한에 걸리면 이번 것은 건너뛴다. 다음 변경이나 페이지를 떠날 때 다시 쓴다.
    }
  };
  const syncUrl = () => {
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(writeUrl, 300);
  };
  // 결과를 눌러 바로 떠나도 뒤로 가기로 돌아왔을 때 조건이 남아 있도록 떠나기 직전에 쓴다.
  window.addEventListener('pagehide', writeUrl);

  // 분류 메뉴를 눌러도 고른 태그·검색어가 따라가게 한다. (분류를 바꾸면 그 분류 안에서 다시 거른다)
  const syncTreeLinks = () => {
    const parts = [];
    if (state.q.trim()) parts.push(`q=${encodeURIComponent(state.q.trim())}`);
    if (state.tags.length) parts.push(`tags=${state.tags.map(encodeURIComponent).join(',')}`);
    const carry = parts.length ? `?${parts.join('&')}` : '';
    treeLinks.forEach((a) => { a.setAttribute('href', `${a.dataset.base}${carry}`); });
  };

  // 사이드바 태그는 링크지만 이 화면에서는 눌러서 고르고 푸는 버튼으로 동작한다.
  // (자바스크립트가 꺼져 있거나 새 탭으로 열면 링크대로 태그 화면으로 간다)
  sidebarTags.forEach((a) => a.setAttribute('role', 'button'));
  const syncSidebarTags = () => {
    const selected = new Set(state.tags.map(norm));
    sidebarTags.forEach((a) => {
      const on = selected.has(norm(a.dataset.tag));
      a.classList.toggle('is-current', on);
      a.setAttribute('aria-pressed', String(on));
    });
  };

  // ---------- 그리기 ----------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // layouts/_partials/row.html 과 같은 구조
  const row = (item) => {
    const link = el('a', 'row');
    link.href = item.url;
    if (item.thumb) {
      const img = el('img', 'thumb');
      img.src = item.thumb;
      img.width = 80;
      img.height = 80;
      img.alt = '';
      img.loading = 'lazy';
      link.append(img);
    }
    const body = el('span', 'row-body');
    const meta = el('span', 'row-meta', item.excerpt ? '' : item.meta);
    // Pagefind 는 excerpt 의 특수문자를 먼저 이스케이프한 뒤 <mark> 만 붙여 주므로 innerHTML 로 넣어도 안전하다.
    if (item.excerpt) {
      meta.classList.add('row-excerpt');
      meta.innerHTML = item.excerpt;
    }
    body.append(el('span', 'row-title', item.title), meta);
    const date = el('time', 'row-date', item.date);
    date.dateTime = item.date;
    link.append(body, date);
    const li = el('li');
    li.append(link);
    return li;
  };

  const chip = (label, action, value) => {
    const button = el('button', 'filter-chip');
    button.type = 'button';
    button.dataset.action = action;
    if (value) button.dataset.value = value;
    const x = el('span', 'x', '×');
    x.setAttribute('aria-hidden', 'true');
    button.append(el('span', '', label), x);
    button.setAttribute('aria-label', `${label} 조건 빼기`);
    return button;
  };

  const renderBar = () => {
    const items = [];
    if (state.q.trim()) items.push(chip(`'${state.q.trim()}'`, 'clear-q'));
    state.tags.forEach((tag) => items.push(chip(`#${tag}`, 'remove-tag', tag)));
    if (state.q.trim() || state.tags.length) {
      const reset = el('button', 'filter-reset', '모두 해제');
      reset.type = 'button';
      reset.dataset.action = 'reset';
      items.push(reset);
    }
    bar.replaceChildren(...items);
  };

  // 첫 쪽, 마지막 쪽, 지금 쪽 앞뒤 2쪽만 보여 주고 사이는 … (layouts/_partials/pager.html 과 같은 규칙)
  const pageNumbers = (current, last) => {
    const out = [];
    let shown = 0;
    for (let n = 1; n <= last; n += 1) {
      if (n === 1 || n === last || Math.abs(n - current) <= 2) {
        if (n - shown > 1) out.push(null);
        out.push(n);
        shown = n;
      }
    }
    return out;
  };

  const renderPager = (last) => {
    if (last <= 1) { pager.replaceChildren(); return; }
    const link = (n, label, ariaLabel) => {
      if (n < 1 || n > last) {
        const span = el('span', 'pager-link is-disabled', label);
        span.setAttribute('aria-hidden', 'true');
        return span;
      }
      const a = el('a', `pager-link${n === state.page && !ariaLabel ? ' is-current' : ''}`, label);
      const saved = state.page;
      state.page = n;
      a.href = query({ withPage: true }) || window.location.pathname;
      state.page = saved;
      a.dataset.page = String(n);
      if (ariaLabel) a.setAttribute('aria-label', ariaLabel);
      if (n === state.page && !ariaLabel) a.setAttribute('aria-current', 'page');
      return a;
    };
    const items = [link(state.page - 1, '‹', '이전 페이지')];
    pageNumbers(state.page, last).forEach((n) => {
      if (n === null) {
        const gap = el('span', 'pager-gap', '…');
        gap.setAttribute('aria-hidden', 'true');
        items.push(gap);
      } else {
        items.push(link(n, String(n)));
      }
    });
    items.push(link(state.page + 1, '›', '다음 페이지'));
    pager.replaceChildren(...items);
  };

  const announcer = document.getElementById('search-announce');
  const announce = (message) => { if (announcer) announcer.textContent = message; };
  const showMessage = (message) => {
    status.hidden = !message;
    status.textContent = message;
    if (message) announce(message);
  };
  // 실패하면 이전 결과가 새 조건 밑에 남지 않게 비우고, Pagefind 를 버려 다음 동작 때 다시 준비한다.
  const fail = (message) => {
    countEl.textContent = '';
    results.replaceChildren();
    pager.replaceChildren();
    showMessage(message);
    resetPagefind();
  };

  // 입력이 빠르게 이어지면 앞선 검색 결과가 늦게 와서 덮어쓰지 않게 마지막 요청만 그린다.
  let renderSeq = 0;
  const render = async () => {
    const seq = ++renderSeq;
    const stale = () => seq !== renderSeq;
    clear.hidden = !input.value;
    syncSidebarTags();
    syncTreeLinks();

    if (isPageItself()) {
      panel.hidden = true;
      page.hidden = false;
      announce('');
      syncUrl();
      return;
    }
    page.hidden = true;
    panel.hidden = false;
    renderBar();
    syncUrl();

    if (!pagefind) {
      countEl.textContent = '';
      results.replaceChildren();
      pager.replaceChildren();
      showMessage('불러오는 중…');
      try {
        await loadPagefind();
      } catch {
        if (!stale()) fail('검색을 불러오지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      if (stale()) return;
    }

    const filters = {};
    if (scope) filters.section = scope;
    if (state.tags.length) filters.tag = state.tags.map(norm);
    // 검색어가 있으면 Pagefind 관련도순(제목에 든 글이 위), 태그·분류만 고를 때는 작성일 최신순.
    const q = state.q.trim();
    let total;
    let last;
    let items;
    try {
      const found = await pagefind.search(q || null, q ? { filters } : { filters, sort: { date: 'desc' } });
      if (stale()) return;
      total = found.results.length;
      last = Math.max(1, Math.ceil(total / PAGE_SIZE));
      state.page = Math.min(state.page, last);
      const pageResults = found.results.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      items = (await Promise.all(pageResults.map((result) => result.data()))).map((data) => toItem(data, Boolean(q)));
    } catch {
      // 검색 실패, 또는 탭을 열어 둔 사이 다시 배포되어 결과 조각 파일이 바뀐 경우
      if (!stale()) fail('검색하지 못했습니다. 다시 시도해 주세요.');
      return;
    }
    if (stale()) return;

    countEl.textContent = String(total);
    showMessage(total ? '' : '조건에 맞는 글이 없습니다.');
    if (total) announce(`검색 결과 ${total}건`);
    results.replaceChildren(...items.map(row));
    renderPager(last);
    syncUrl();
  };

  const update = (change) => {
    change();
    state.page = 1;
    return render();
  };

  // ---------- 이벤트 ----------
  input.form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => update(() => { state.q = input.value; }));
  input.addEventListener('focus', () => { loadPagefind().catch(() => {}); }, { once: true });
  const clearQuery = () => {
    input.value = '';
    update(() => { state.q = ''; });
    input.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      clearQuery();
    }
  });
  clear.addEventListener('click', clearQuery);

  // 사이드바 태그는 눌러서 고르고 다시 눌러서 푼다. (새 탭으로 열 때는 태그 화면으로 간다)
  sidebarTags.forEach((a) => {
    a.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const tag = a.dataset.tag;
      update(() => {
        state.tags = state.tags.some((t) => norm(t) === norm(tag))
          ? state.tags.filter((t) => norm(t) !== norm(tag))
          : [...state.tags, tag];
      });
    });
    // 버튼처럼 Space 로도 누를 수 있게 한다. (Enter 는 링크라서 원래 눌린다)
    a.addEventListener('keydown', (event) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      a.click();
    });
  });

  // 조건 칩을 키보드로 누르면 칩이 다시 그려지면서 포커스가 사라지므로, 남은 칩이나 검색창으로 옮긴다.
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, value } = button.dataset;
    if (action === 'clear-q') {
      clearQuery();
      return;
    }
    if (action === 'remove-tag') {
      update(() => { state.tags = state.tags.filter((t) => norm(t) !== norm(value)); });
    } else if (action === 'reset') {
      // 모두 해제는 지금 화면의 원래 상태로 돌아간다. (태그 화면이면 그 태그만 고른 상태)
      input.value = '';
      update(() => { state.q = ''; state.tags = [...pageTags]; });
    }
    // 원래 화면으로 돌아갔으면 패널이 숨겨져 있으므로 검색창으로 옮긴다.
    ((!panel.hidden && bar.querySelector('button')) || input).focus();
  });

  pager.addEventListener('click', async (event) => {
    const a = event.target.closest('a[data-page]');
    if (!a || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    state.page = Number(a.dataset.page);
    panel.scrollIntoView({ block: 'start' });
    await render();
    // 쪽 번호가 다시 그려지면서 포커스가 사라지므로 지금 쪽 번호로 옮긴다.
    pager.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  });

  render();
})();
