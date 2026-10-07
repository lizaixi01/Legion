export function createUiTools(deps) {
  const {
    app,
    toastRoot,
    ASSET,
    state,
    PROBLEM_TEMPLATE_OPTIONS,
    normalizeProblemMetaValue,
    problemMetaLabel,
    resolveProblemTemplateValue,
    resolveProblemBaselineEnabled,
    renderProblemMetaSelectOptions,
    renderProblemMetaTags,
    renderProblemListMetaTags,
    renderProblemListTitle,
    DEFAULT_CODE_FILE_TABS,
    camelToSnake,
    extractOpNameFromCodeFiles,
    buildMsopgenCodeFileTabs,
    normalizeDateInputValue,
    bindFixedDateInputs,
    assetPath,
    normalizePath,
    compact,
    normToken,
    rawToken,
    strictTokenCandidates,
    tokenCandidates,
    tokenMatchesEntity,
    tokenMatchesEntityStrict,
    strictSearchNormalize,
    strictSearchMatch,
    strictSearchMatchAny,
    problemSortLabel,
    sortProblemsLexicographically,
    preferredToken,
    contestObjectIdOf,
    preferredProblemToken,
    pathSeg,
    groupFromId,
    clearGroupCache,
    contestFromId,
    contestGroupId,
    isPublicGroupRef,
    groupPath,
    contestPath,
    contestPathWithTab,
    problemPath,
    problemSubmissionPath,
    groupContestScopedPath,
    groupProblemScopedPath,
    groupProblemSubmissionScopedPath,
    groupAdminPath,
    groupAdminContestPath,
    adminOpenProblemsPath,
    adminOpenContestsPath,
    adminOpenContestPath,
    hashPath,
    isReservedTopSegment,
    escapeHtml,
    fmtDate,
    normalizeScore,
    fmtScore,
    toLocalDateInput,
    saveUser,
    loadUser,
    clearUser,
    topActive,
    toDateTimeLocalInput,
    parseDateTimeLocal,
    fmtPercent,
    fmtOutputErrorRatio,
    groupMembership,
    groupPrivilegeLabel,
    isGroupManagerLocal,
    isWebsiteAdminLocal,
    isGroupAdminLocal,
    boolText,
    normalizeObjectIdToken,
    ensureCurrentUserObjectId,
    contestCreatorId,
    contestCreatorLabel,
    slugify,
    normalizeLinkPrefix,
    normalizeLinkTokenInput,
    isValidUrlToken,
    isValidGroupUrlToken,
    pickFile,
    configureRoutingRuntime,
    rerenderApp,
    matchRoute,
    navToHref,
    navTo,
    bindFrontPagerControls,
    convertLegacyHashHref,
    resolveAppHref,
    rewriteProjectLinks,
    listGroupContests,
    listGroupProblems,
    api,
    parseDownloadFilename,
    triggerBlobDownload,
    downloadApiFile,
    extractApiErrorMessage,
    isTimeoutLikeError,
    getGroup,
    getContest,
    uniqueGroupsFromCache,
    uniqueContestsFromCache,
    resolveGroupByToken,
    resolveContestByToken,
    resolveProblemByToken,
    getUserByObjectId,
    getUsersByObjectId,
    getPublicGroupCached,
    listPublicGroupContests,
    listAllContests,
    detectContestStatus,
    contestProblemMetricLabel
  } = deps;

function shellDefault(contentHtml, opts = {}) {
  const isLogin = Boolean(state.user);
  const top = opts.top || 'problems';
  const adminEntry =
    isLogin && isWebsiteAdminLocal()
      ? '<a class="header-admin-entry" href="#/admin/groups" title="进入超级后台">超级后台</a>'
      : '';
  const rightPart = isLogin
    ? `${adminEntry}
       <button class="icon-btn icon-bell" data-action="open-msg" title="消息" aria-label="消息"></button>
       <img class="user-avatar" src="${escapeHtml(profileAvatar(state.user))}" alt="avatar" />
       <a href="#/me">${escapeHtml(state.user.nickname || `用户${state.user.ID}`)}</a>
       <a href="#" data-action="logout">退出</a>`
    : '<a href="#/auth/register">注册</a><a href="#/auth/login">登录</a>';

  return `<div class="page">
    <header class="site-header">
      <a class="brand" href="#/home"><span class="brand-mark" aria-hidden="true"><img src="${assetPath('/data/design_brand_icon_64.png')}" alt="" /></span><span>CANNJudge</span></a>
      <nav class="top-nav">
        <a class="${top === 'problems' ? 'active' : ''}" href="#/home">开放题库</a>
        <a class="${top === 'contests' ? 'active' : ''}" href="#/contests">开放赛事</a>
        <a class="${top === 'groups' ? 'active' : ''}" href="#/groups">小组空间</a>
      </nav>
      <div class="header-right">
        ${rightPart}
      </div>
    </header>
    ${contentHtml}
    ${renderMessagePopover()}
  </div>`;
}

function renderMessagePopover() {
  return '<div id="msg-popover"></div>';
}

function profileAvatar(user) {
  if (!user) return ASSET.avatarA;
  return Number(user.ID) % 2 === 0 ? ASSET.avatarA : ASSET.avatarB;
}

function shellAdmin(contentHtml, active, opts = {}) {
  const publicGroup = opts.publicGroup || state.publicGroup || null;
  const openProblemEntry = publicGroup
    ? `<a href="${hashPath(adminOpenProblemsPath())}" class="${active === 'open-problems' ? 'active' : ''}">开放题库管理</a>`
    : '<a href="#/admin/groups">开放题库管理（未配置公共小组）</a>';
  const openContestEntry = publicGroup
    ? `<a href="${hashPath(adminOpenContestsPath())}" class="${active === 'open-contests' ? 'active' : ''}">开放赛事管理</a>`
    : '<a href="#/admin/groups">开放赛事管理（未配置公共小组）</a>';
  return `<div class="page">
    <header class="site-header super-admin-header">
      <a class="brand" href="#/home"><span class="brand-mark" aria-hidden="true"><img src="${assetPath('/data/design_brand_icon_64.png')}" alt="" /></span><span>CANNJudge</span></a>
      <div class="header-right">
        <button class="icon-btn icon-search" title="搜索" aria-label="搜索"></button>
        <button class="icon-btn icon-bell" data-action="open-msg" title="消息" aria-label="消息"></button>
        <a class="icon-user-link" href="#/me" aria-label="个人中心"><span class="icon-user"></span></a>
      </div>
    </header>
    <div class="admin-layout super-admin-layout">
      <aside class="admin-side super-admin-side">
        <h3 class="admin-title super-admin-title">管理员后台</h3>
        <a href="#/admin/groups" class="${active === 'groups' ? 'active' : ''}">小组管理</a>
        <a href="#/admin/groups?review=pending" class="${active === 'review' ? 'active' : ''}">审核管理</a>
        <a href="#/admin/submissions" class="${active === 'submissions' ? 'active' : ''}">提交记录</a>
        <a href="#/admin/judge-machines" class="${active === 'judge-machines' ? 'active' : ''}">评测机管理</a>
        <a href="#/admin/problem-bank" class="${active === 'problem-bank' ? 'active' : ''}">理论题管理</a>
        ${openProblemEntry}
        ${openContestEntry}
      </aside>
      <main class="admin-content super-admin-content">${contentHtml}</main>
    </div>
    ${renderMessagePopover()}
  </div>`;
}

function shellGroupAdmin(contentHtml, active, groupId, groupTitle = 'Group_name', opts = {}) {
  if (!opts.group) console.warn('shellGroupAdmin called without group opts');
  const customModuleNav = (opts.group?.custom_module_enabled === true || active === 'custom-module')
    ? `<a href="${hashPath(groupAdminPath(groupId, 'custom-module'))}" class="${active === 'custom-module' ? 'active' : ''}">模块管理</a>`
    : '';
  return `<div class="page">
    <header class="site-header">
      <a class="brand" href="#/home"><span class="brand-mark" aria-hidden="true"><img src="${assetPath('/data/design_brand_icon_64.png')}" alt="" /></span><span>CANNJudge</span></a>
      <div class="header-right">
         <button class="icon-btn icon-search" title="搜索" aria-label="搜索"></button>
         <button class="icon-btn icon-bell" data-action="open-msg" title="消息" aria-label="消息"></button>
        <a href="#/me">${escapeHtml(state.user?.nickname || '我的')}</a>
      </div>
    </header>
    <div class="admin-layout">
      <aside class="admin-side">
        <div class="admin-title is-admin-title-flex">
          <img class="small-avatar" src="${escapeHtml(profileAvatar({ ID: groupId }))}" alt="group" />
          <span>${escapeHtml(groupTitle)}</span>
          <span class="muted">⌄</span>
        </div>
        <a href="${hashPath(groupAdminPath(groupId, 'contests'))}" class="${active === 'contests' ? 'active' : ''}">赛事管理</a>
        <a href="${hashPath(groupAdminPath(groupId, 'ongoing'))}" class="${active === 'ongoing' ? 'active' : ''}">长期题单</a>
        <a href="${hashPath(groupAdminPath(groupId, 'problem-bank'))}" class="${active === 'problem-bank' ? 'active' : ''}">理论题库</a>
        <a href="${hashPath(groupAdminPath(groupId, 'members'))}" class="${active === 'members' ? 'active' : ''}">成员管理</a>
        ${customModuleNav}
        <a href="${hashPath(groupAdminPath(groupId, 'settings'))}" class="${active === 'settings' ? 'active' : ''}">小组设置</a>
      </aside>
      <main class="admin-content">${contentHtml}</main>
    </div>
    ${renderMessagePopover()}
  </div>`;
}

function pagination(list, page, pageSize) {
  const safePage = Math.max(1, Number(page || 1));
  const size = Math.max(1, Number(pageSize || 20));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(safePage, pages);
  const start = (current - 1) * size;
  const end = start + size;
  return {
    total,
    pages,
    current,
    size,
    rows: list.slice(start, end)
  };
}

function loginPromptHtml(message = '需要先登录才能访问这个页面') {
  return shellDefault(
    `<main class="page-main"><section class="card section"><h3 class="section-title">访问受限</h3><p class="section-sub">${escapeHtml(
      message
    )}</p><div class="form-actions is-mt-12"><a class="btn primary" href="#/auth/login">前往登录</a><a class="btn" href="#/auth/register">注册账号</a></div></section></main>`,
    { top: 'problems' }
  );
}

function noPermissionHtml(message = '当前账号没有权限访问该页面') {
  return `<section class="card section"><h3 class="section-title">无权限</h3><p class="section-sub">${escapeHtml(message)}</p></section>`;
}

function ensureAuthedUserPage() {
  if (!state.user) {
    return {
      html: loginPromptHtml(),
      bind() {}
    };
  }
  return null;
}

function groupFrontShell(group, active, contentHtml, opts = {}) {
  const groupId = String(group?._id || group?.id || '').trim();
  const baseGroupPath = groupPath(group || groupId);
  const breadcrumbMap = {
    home: '总览',
    problems: '题单',
    contests: '赛事'
  };
  const breadcrumb = opts?.breadcrumb || breadcrumbMap[active] || '总览';
  return shellDefault(
    `<main class="page-main fluid group-front-page">
      <div class="group-front-layout">
        <aside class="group-front-side">
          <a class="group-front-avatar-link" href="${hashPath(baseGroupPath)}">
            <img class="group-front-avatar" src="${escapeHtml(profileAvatar({ ID: group?.ID || groupId }))}" alt="avatar" />
          </a>
          <nav class="group-front-nav">
            <a href="${hashPath(baseGroupPath)}" class="${active === 'home' ? 'active' : ''}">
              <span class="group-front-icon-wrap"><i class="group-front-icon i-overview" aria-hidden="true"></i></span>
              <span>总览</span>
            </a>
            <a href="${hashPath(`${baseGroupPath}/problems`)}" class="${active === 'problems' ? 'active' : ''}">
              <span class="group-front-icon-wrap"><i class="group-front-icon i-problems" aria-hidden="true"></i></span>
              <span>题单</span>
            </a>
            <a href="${hashPath(`${baseGroupPath}/contests`)}" class="${active === 'contests' ? 'active' : ''}">
              <span class="group-front-icon-wrap"><i class="group-front-icon i-contests" aria-hidden="true"></i></span>
              <span>赛事</span>
            </a>
            ${group?.custom_module_enabled === true ? `<a href="${hashPath(`${baseGroupPath}/custom-module`)}" class="${active === 'custom-module' ? 'active' : ''}">
              <span class="group-front-icon-wrap"><i class="group-front-icon i-custom-module" aria-hidden="true"></i></span>
              <span>${escapeHtml(group.custom_module_name || '自定')}</span>
            </a>` : ''}
          </nav>
        </aside>
        <section class="group-front-main">
          <div class="group-front-breadcrumb"><a class="breadcrumb-link" href="${hashPath('/groups')}">小组列表</a> / <strong>${escapeHtml(
            breadcrumb
          )}</strong></div>
          ${contentHtml}
        </section>
      </div>
    </main>`,
    { top: 'groups' }
  );
}

function buildFrontPagerTokens(current, pages) {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, idx) => idx + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, 6, '...', pages];
  }
  if (current >= pages - 3) {
    return [1, '...', pages - 5, pages - 4, pages - 3, pages - 2, pages - 1, pages];
  }
  return [1, '...', current - 1, current, current + 1, '...', pages];
}

function renderFrontPager({ total, pages, current, size }, routePath, query = {}) {
  const safePages = Math.max(1, Number(pages || 1));
  const safeCurrent = Math.min(safePages, Math.max(1, Number(current || 1)));
  const safeSize = Math.max(1, Number(size || 20));
  const baseQuery = compact({ ...query });
  delete baseQuery.page;
  delete baseQuery.size;

  const sizes = [10, 20, 50];
  if (!sizes.includes(safeSize)) {
    sizes.push(safeSize);
  }
  sizes.sort((a, b) => a - b);

  const toHref = (pageNo, pageSize = safeSize) => {
    const q = new URLSearchParams(compact({ ...baseQuery, page: pageNo, size: pageSize })).toString();
    const rawHref = `#${routePath}${q ? `?${q}` : ''}`;
    return convertLegacyHashHref(rawHref) || rawHref;
  };

  const prevNode =
    safeCurrent > 1
      ? `<a class="front-pager-arrow" href="${toHref(safeCurrent - 1)}" aria-label="上一页">‹</a>`
      : '<span class="front-pager-arrow disabled" aria-hidden="true">‹</span>';
  const nextNode =
    safeCurrent < safePages
      ? `<a class="front-pager-arrow" href="${toHref(safeCurrent + 1)}" aria-label="下一页">›</a>`
      : '<span class="front-pager-arrow disabled" aria-hidden="true">›</span>';

  const nums = buildFrontPagerTokens(safeCurrent, safePages)
    .map((item) => {
      if (item === '...') {
        return '<span class="front-pager-ellipsis">...</span>';
      }
      if (item === safeCurrent) {
        return `<span class="front-pager-num active">${item}</span>`;
      }
      return `<a class="front-pager-num" href="${toHref(item)}">${item}</a>`;
    })
    .join('');

  return `<div class="front-pager" data-route="${escapeHtml(routePath)}" data-pages="${safePages}" data-size="${safeSize}" data-current="${safeCurrent}" data-base-query="${escapeHtml(
    encodeURIComponent(JSON.stringify(baseQuery))
  )}">
    <span class="front-pager-total">共 ${total} 条</span>
    <label class="front-pager-size-wrap">
      <select class="front-pager-size" data-action="front-pager-size" aria-label="每页条数">
        ${sizes.map((value) => `<option value="${value}" ${value === safeSize ? 'selected' : ''}>${value}条/页</option>`).join('')}
      </select>
    </label>
    ${prevNode}
    <div class="front-pager-nums">${nums}</div>
    ${nextNode}
    <span class="front-pager-go-text">前往</span>
    <input class="front-pager-go-input" data-action="front-pager-go" inputmode="numeric" aria-label="前往页码" value="${safeCurrent}" />
  </div>`;
}

function buildPagerTokens(current, pages) {
  if (pages <= 8) {
    return Array.from({ length: pages }, (_, idx) => idx + 1);
  }
  const tokens = new Set();
  tokens.add(1);
  tokens.add(pages);
  for (let i = current - 2; i <= current + 2; i += 1) {
    if (i >= 1 && i <= pages) tokens.add(i);
  }
  const sorted = Array.from(tokens).sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push('...');
    }
    result.push(sorted[i]);
  }
  return result;
}

function renderPager({ total, pages, current, size }, routePath, query = {}) {
  const safePages = Math.max(1, Number(pages || 1));
  const safeCurrent = Math.min(safePages, Math.max(1, Number(current || 1)));
  const safeSize = Math.max(1, Number(size || 20));

  const toHref = (pageNo) => {
    const q = new URLSearchParams(compact({ ...query, page: pageNo, size: safeSize })).toString();
    const rawHref = `#${routePath}${q ? `?${q}` : ''}`;
    return convertLegacyHashHref(rawHref) || rawHref;
  };

  const prevBtn = safeCurrent > 1
    ? `<a class="page-btn" href="${toHref(safeCurrent - 1)}" aria-label="上一页">‹</a>`
    : '<span class="page-btn disabled" aria-hidden="true">‹</span>';
  const nextBtn = safeCurrent < safePages
    ? `<a class="page-btn" href="${toHref(safeCurrent + 1)}" aria-label="下一页">›</a>`
    : '<span class="page-btn disabled" aria-hidden="true">›</span>';

  const pageBtn = buildPagerTokens(safeCurrent, safePages)
    .map((item) => {
      if (item === '...') {
        return '<span class="page-ellipsis">...</span>';
      }
      return `<a class="page-btn ${item === safeCurrent ? 'active' : ''}" href="${toHref(item)}">${item}</a>`;
    })
    .join('');

  return `<div class="pagination"><span>共 ${total} 条</span><span>${safeSize}条/页</span>${prevBtn}${pageBtn}${nextBtn}<span>第 ${safeCurrent}/${safePages} 页</span></div>`;
}

function statusPill(status) {
  const key = String(status || '').toLowerCase();
  const text = displayStatusText(status);
  if (key.includes('pass') || key.includes('accepted') || key === 'ac') {
    return `<span class="pill success">${escapeHtml(text)}</span>`;
  }
  if (key.includes('skip')) {
    return `<span class="pill ghost">${escapeHtml(text)}</span>`;
  }
  if (key.includes('wrong')) {
    return `<span class="pill warning">${escapeHtml(text)}</span>`;
  }
  if (
    key.includes('fail') ||
    key.includes('runtime') ||
    key.includes('compile') ||
    key.includes('time limit')
  ) {
    return `<span class="pill danger">${escapeHtml(text)}</span>`;
  }
  return `<span class="pill primary">${escapeHtml(text)}</span>`;
}

function statusKey(status) {
  const key = String(status || '').toLowerCase();
  if (key.includes('pass') || key.includes('accepted') || key === 'ac') return 'pass';
  if (key.includes('skip')) return 'skipped';
  if (key.includes('wrong')) return 'wrong';
  if (
    key.includes('fail') ||
    key.includes('runtime') ||
    key.includes('compile') ||
    key.includes('time limit')
  ) return 'fail';
  return 'waiting';
}

function isPassStatus(status) {
  return statusKey(status) === 'pass';
}

function backendStatusText(status) {
  const text = String(status ?? '').trim();
  return text || '-';
}

function displayStatusText(status) {
  const key = String(status || '').toLowerCase();
  if (key.includes('compile')) return 'Compile Error';
  if (key.includes('runtime')) return 'Runtime Error';
  if (key === 'time limit exceeded' || key.includes('time limit')) return 'Time Limit Exceeded';
  if (key.includes('wrong')) return 'Wrong Answer';
  if (key.includes('skip')) return 'Skipped';
  if (key.includes('pass') || key.includes('accepted') || key === 'ac') return 'Pass';
  if (key.includes('fail')) return 'Fail';
  if (key.includes('wait')) return 'Waiting';
  return backendStatusText(status);
}

function openStatusChip(status, useBackendText = false) {
  const key = statusKey(status);
  const text = useBackendText ? backendStatusText(status) : displayStatusText(status);
  if (key === 'pass') return `<span class="open-status-chip pass">${escapeHtml(text)}</span>`;
  if (key === 'skipped') return `<span class="open-status-chip skip">${escapeHtml(text)}</span>`;
  if (key === 'wrong') return `<span class="open-status-chip fail">${escapeHtml(text)}</span>`;
  if (key === 'fail') return `<span class="open-status-chip fail">${escapeHtml(text)}</span>`;
  return `<span class="open-status-chip wait">${escapeHtml(text)}</span>`;
}

function cleanOpenDesc(text) {
  const raw = String(text || '');
  return raw.replaceAll('面向基础强化的练习题集，供同学们熟悉环境使用，不计分', '').trim();
}

function plainBlockText(value, fallback = '-') {
  const raw = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  return raw || fallback;
}

function normalizeProblemMathTextCommands(expression) {
  const source = String(expression || '');
  const textCommands = ['\\text', '\\mathrm', '\\operatorname', '\\mathtt'];
  let index = 0;
  let output = '';

  while (index < source.length) {
    let matchedCommand = '';
    for (const command of textCommands) {
      if (source.startsWith(command, index)) {
        matchedCommand = command;
        break;
      }
    }

    if (!matchedCommand) {
      output += source[index];
      index += 1;
      continue;
    }

    output += matchedCommand;
    index += matchedCommand.length;

    while (index < source.length && /\s/.test(source[index])) {
      output += source[index];
      index += 1;
    }

    if (source[index] !== '{') {
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === '\\') {
        cursor += 1;
        continue;
      }
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    if (end === -1) {
      output += source.slice(index);
      break;
    }

    const content = source.slice(index + 1, end).replace(/\\_/g, '_');
    output += `{${content}}`;
    index = end + 1;
  }

  return output;
}

function normalizeProblemMathExpression(expression) {
  return normalizeProblemMathTextCommands(String(expression || '').trim());
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fallback to execCommand
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(textarea);
    return Boolean(copied);
  } catch {
    return false;
  }
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function sanitizeMarkdownUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

function renderInlineProblemMarkdown(value) {
  const inlineMathTokens = [];
  let textWithMathTokens = String(value || '');
  textWithMathTokens = textWithMathTokens.replace(/\\\(((?:\\.|[^\\\n])+?)\\\)/g, (_match, expression) => {
    const token = `@@INLINE_MATH_${inlineMathTokens.length}@@`;
    inlineMathTokens.push(`<span class="md-math-inline">\\(${escapeHtml(normalizeProblemMathExpression(expression))}\\)</span>`);
    return token;
  });
  textWithMathTokens = textWithMathTokens.replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_match, prefix, expression) => {
    const token = `@@INLINE_MATH_${inlineMathTokens.length}@@`;
    inlineMathTokens.push(`<span class="md-math-inline">\\(${escapeHtml(normalizeProblemMathExpression(expression))}\\)</span>`);
    return `${prefix}${token}`;
  });

  let html = escapeHtml(textWithMathTokens);
  const codeTokens = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `@@INLINE_CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code class="md-inline-code">${code}</code>`);
    return token;
  });
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_match, label, url) => {
    const safe = sanitizeMarkdownUrl(url);
    if (!safe) return label;
    return `<a class="md-link" href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  });
  codeTokens.forEach((fragment, index) => {
    html = html.split(`@@INLINE_CODE_${index}@@`).join(fragment);
  });
  inlineMathTokens.forEach((fragment, index) => {
    html = html.split(`@@INLINE_MATH_${index}@@`).join(fragment);
  });
  return html;
}

function mdIsOrderedListItem(line) {
  return /^\d+\.\s*\S+/.test(line);
}

function mdIsUnorderedListItem(line) {
  return /^[-*+]\s+/.test(line);
}

function mdIsQuoteItem(line) {
  return /^>\s?/.test(line);
}

function mdIsMathBlockStart(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('$$') || trimmed.startsWith('\\[');
}

function mdParseTableCells(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function mdIsTableSeparatorLine(line) {
  const cells = mdParseTableCells(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s+/g, '')));
}

function mdResolveTableAlign(separatorCell) {
  const normalized = String(separatorCell || '').replace(/\s+/g, '');
  if (/^:-+:$/.test(normalized)) return 'center';
  if (/^:-+$/.test(normalized)) return 'left';
  if (/^-+:$/.test(normalized)) return 'right';
  return '';
}

function mdFindTableSeparatorLineIndex(lines, headerIndex) {
  let separatorIndex = headerIndex + 1;
  while (separatorIndex < lines.length && !String(lines[separatorIndex] || '').trim()) {
    separatorIndex += 1;
  }
  if (separatorIndex >= lines.length) return -1;
  if (!mdIsTableSeparatorLine(lines[separatorIndex])) return -1;
  return separatorIndex;
}

function renderProblemDescriptionMarkdown(raw, emptyText = '暂无题目描述') {
  const source = String(raw || '');
  if (!source.trim()) {
    return `<p class="md-empty">${escapeHtml(emptyText)}</p>`;
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = String(line || '').trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const language = trimmed.replace(/^```/, '').trim();
      index += 1;
      const codeLines = [];
      while (index < lines.length && !/^```/.test(String(lines[index] || '').trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        `<pre class="md-pre"><code class="md-code${language ? ` language-${escapeAttr(language)}` : ''}">${escapeHtml(
          codeLines.join('\n')
        )}</code></pre>`
      );
      continue;
    }

    if (mdIsMathBlockStart(trimmed)) {
      const isBracketMath = trimmed.startsWith('\\[');
      const openMarker = isBracketMath ? '\\[' : '$$';
      const closeMarker = isBracketMath ? '\\]' : '$$';
      const first = trimmed.slice(openMarker.length);
      const sameLineCloseIndex = first.indexOf(closeMarker);
      if (sameLineCloseIndex !== -1) {
        const mathContent = normalizeProblemMathExpression(first.slice(0, sameLineCloseIndex));
        const trailingText = first.slice(sameLineCloseIndex + closeMarker.length).trim();
        blocks.push(`<div class="md-math-block">\\[${escapeHtml(mathContent)}\\]</div>`);
        if (trailingText) {
          blocks.push(`<p class="md-paragraph">${renderInlineProblemMarkdown(trailingText)}</p>`);
        }
        index += 1;
        continue;
      }

      const mathLines = [];
      let trailingText = '';
      if (first.trim()) {
        mathLines.push(first);
      }
      index += 1;
      while (index < lines.length) {
        const current = String(lines[index] || '');
        const closeIndex = current.indexOf(closeMarker);
        if (closeIndex !== -1) {
          const beforeClose = current.slice(0, closeIndex).trim();
          if (beforeClose) {
            mathLines.push(beforeClose);
          }
          trailingText = current.slice(closeIndex + closeMarker.length).trim();
          index += 1;
          break;
        }
        mathLines.push(current);
        index += 1;
      }

      blocks.push(`<div class="md-math-block">\\[${escapeHtml(normalizeProblemMathExpression(mathLines.join('\n')))}\\]</div>`);
      if (trailingText) {
        blocks.push(`<p class="md-paragraph">${renderInlineProblemMarkdown(trailingText)}</p>`);
      }
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInlineProblemMarkdown(headingMatch[2]);
      blocks.push(`<h${level} class="md-heading md-h${level}">${content}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push('<hr class="md-hr" />');
      index += 1;
      continue;
    }

    const tableSeparatorIndex = String(line || '').includes('|') ? mdFindTableSeparatorLineIndex(lines, index) : -1;
    if (tableSeparatorIndex !== -1) {
      const headerCells = mdParseTableCells(line);
      const separatorCells = mdParseTableCells(lines[tableSeparatorIndex]);
      const columnCount = Math.max(headerCells.length, separatorCells.length);
      const aligns = Array.from({ length: columnCount }, (_item, cellIndex) =>
        mdResolveTableAlign(separatorCells[cellIndex] || '')
      );

      const renderCell = (cell, cellIndex, tag) => {
        const content = renderInlineProblemMarkdown(cell || '');
        const align = aligns[cellIndex];
        const alignClass = align ? ` md-align-${align}` : '';
        return `<${tag} class="md-${tag}${alignClass}">${content}</${tag}>`;
      };

      const headerRow = Array.from({ length: columnCount }, (_item, cellIndex) =>
        renderCell(headerCells[cellIndex], cellIndex, 'th')
      ).join('');

      index = tableSeparatorIndex + 1;
      const bodyRows = [];
      while (index < lines.length) {
        const bodyRaw = lines[index];
        const bodyTrimmed = String(bodyRaw || '').trim();
        if (!bodyTrimmed) {
          index += 1;
          continue;
        }
        if (!String(bodyRaw || '').includes('|')) break;
        const cells = mdParseTableCells(bodyRaw);
        const row = Array.from({ length: columnCount }, (_item, cellIndex) =>
          renderCell(cells[cellIndex], cellIndex, 'td')
        ).join('');
        bodyRows.push(`<tr class="md-tr">${row}</tr>`);
        index += 1;
      }

      blocks.push(
        `<div class="md-table-wrap"><table class="md-table"><thead><tr class="md-tr">${headerRow}</tr></thead><tbody>${bodyRows.join(
          ''
        )}</tbody></table></div>`
      );
      continue;
    }

    if (mdIsQuoteItem(trimmed)) {
      const quoteLines = [];
      while (index < lines.length) {
        const current = String(lines[index] || '').trim();
        if (!current || !mdIsQuoteItem(current)) break;
        quoteLines.push(renderInlineProblemMarkdown(current.replace(/^>\s?/, '')));
        index += 1;
      }
      blocks.push(`<blockquote class="md-quote">${quoteLines.join('<br />')}</blockquote>`);
      continue;
    }

    if (mdIsUnorderedListItem(trimmed)) {
      const items = [];
      while (index < lines.length) {
        const current = String(lines[index] || '').trim();
        if (!current || !mdIsUnorderedListItem(current)) break;
        items.push(`<li>${renderInlineProblemMarkdown(current.replace(/^[-*+]\s+/, ''))}</li>`);
        index += 1;
      }
      blocks.push(`<ul class="md-list md-ul">${items.join('')}</ul>`);
      continue;
    }

    if (mdIsOrderedListItem(trimmed)) {
      const items = [];
      while (index < lines.length) {
        const current = String(lines[index] || '').trim();
        if (!current || !mdIsOrderedListItem(current)) break;
        items.push(`<li>${renderInlineProblemMarkdown(current.replace(/^\d+\.\s*/, ''))}</li>`);
        index += 1;
      }
      blocks.push(`<ol class="md-list md-ol">${items.join('')}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const currentRaw = lines[index];
      const current = String(currentRaw || '').trim();
      const tableBreakIndex = String(currentRaw || '').includes('|')
        ? mdFindTableSeparatorLineIndex(lines, index)
        : -1;
      if (
        !current ||
        /^```/.test(current) ||
        mdIsMathBlockStart(current) ||
        /^(#{1,6})\s+/.test(current) ||
        /^---+$/.test(current) ||
        /^\*\*\*+$/.test(current) ||
        mdIsQuoteItem(current) ||
        mdIsUnorderedListItem(current) ||
        mdIsOrderedListItem(current) ||
        tableBreakIndex !== -1
      ) {
        break;
      }
      paragraphLines.push(renderInlineProblemMarkdown(currentRaw));
      index += 1;
    }
    blocks.push(`<p class="md-paragraph">${paragraphLines.join('<br />')}</p>`);
  }

  return blocks.join('');
}

const _mathJaxBasePath = String(window.__CANNJUDGE_BASE_PATH || '').replace(/\/+$/, '');
const MATHJAX_SOURCES = [
  `${_mathJaxBasePath}/mathjax/tex-svg.js`
];

const LOCAL_MATHJAX_TIMEOUT_MS = 60000;

function hasMathJaxKernel() {
  const mathJax = window.MathJax;
  if (!mathJax) return false;
  return Boolean(mathJax.startup || mathJax.version);
}

function hasMathJaxRuntime() {
  return Boolean(window.MathJax && typeof window.MathJax.typesetPromise === 'function');
}

function installMathJaxTypesetFallback() {
  const mathJax = window.MathJax;
  if (!mathJax || typeof mathJax.typesetPromise === 'function') return;
  const startup = mathJax.startup;
  const doc = startup && startup.document;
  if (!doc) return;

  mathJax.typesetClear = (elements) => {
    if (doc.options) {
      doc.options.elements = elements;
    }
    if (typeof doc.clear === 'function') {
      doc.clear();
    }
  };

  mathJax.typesetPromise = async (elements) => {
    if (startup && startup.promise) {
      await startup.promise;
    }
    if (doc.options) {
      doc.options.elements = elements;
    }
    if (typeof doc.reset === 'function') {
      doc.reset();
    }
    if (typeof doc.renderPromise === 'function') {
      await doc.renderPromise();
      return;
    }
    if (typeof doc.updateDocument === 'function') {
      doc.updateDocument();
      return;
    }
    if (typeof doc.render === 'function') {
      doc.render();
    }
  };
}

function configureMathJaxRuntime() {
  if (hasMathJaxRuntime() || (window.MathJax && window.MathJax.startup)) return;
  const current = window.MathJax || {};
  const currentTex = current.tex && typeof current.tex === 'object' ? current.tex : {};
  const currentOptions = current.options && typeof current.options === 'object' ? current.options : {};
  const existingSkipTags = Array.isArray(currentOptions.skipHtmlTags) ? currentOptions.skipHtmlTags : [];
  const defaultSkipTags = ['script', 'noscript', 'style', 'textarea', 'pre', 'code'];

  if (!window.MathJax) {
    window.MathJax = {};
  }
  window.MathJax.tex = {
    ...currentTex,
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)']
    ],
    displayMath: [
      ['$$', '$$'],
      ['\\[', '\\]']
    ],
    processEscapes: true
  };
  window.MathJax.options = {
    ...currentOptions,
    enableAssistiveMml: false,
    skipHtmlTags: Array.from(new Set([...existingSkipTags, ...defaultSkipTags]))
  };
  window.MathJax.svg = {
    ...((current.svg && typeof current.svg === 'object') ? current.svg : {}),
    fontCache: 'global'
  };
}

function waitForMathJaxKernel(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (hasMathJaxKernel()) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('mathjax runtime not detected after script load'));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function loadMathJaxScriptFromSource(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeoutMs = LOCAL_MATHJAX_TIMEOUT_MS;
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error(`load mathjax timeout: ${src}`));
    }, timeoutMs);
    const cleanup = () => window.clearTimeout(timeout);

    script.src = src;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-mathjax-loader', 'true');
    script.onload = async () => {
      cleanup();
      try {
        await waitForMathJaxKernel();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    script.onerror = () => {
      cleanup();
      script.remove();
      reject(new Error(`load mathjax failed: ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function ensureMathJaxReady() {
  if (hasMathJaxRuntime()) {
    installMathJaxTypesetFallback();
    return true;
  }
  if (!window.__mathJaxReadyPromise) {
    configureMathJaxRuntime();
    window.__mathJaxReadyPromise = (async () => {
      for (const src of MATHJAX_SOURCES) {
        const oldScripts = document.querySelectorAll('script[data-mathjax-loader="true"]');
        oldScripts.forEach((item) => item.remove());
        try {
          await loadMathJaxScriptFromSource(src);
          if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
            await window.MathJax.startup.promise;
          }
          installMathJaxTypesetFallback();
          return true;
        } catch (error) {
          console.warn('mathjax source failed', src, error);
        }
      }
      throw new Error('load mathjax failed from all sources');
    })();
  }
  try {
    await window.__mathJaxReadyPromise;
    installMathJaxTypesetFallback();
    return hasMathJaxRuntime();
  } catch (error) {
    console.warn('mathjax init failed', error);
    window.__mathJaxReadyPromise = null;
    showToast('数学公式渲染组件加载失败，公式可能无法正常显示', 'error', 6000);
    return false;
  }
}

async function typesetMathInRoot(root) {
  if (!root) return;
  const ready = await ensureMathJaxReady();
  if (!ready || !window.MathJax || typeof window.MathJax.typesetPromise !== 'function') return;
  try {
    if (typeof window.MathJax.typesetClear === 'function') {
      window.MathJax.typesetClear([root]);
    }
    await window.MathJax.typesetPromise([root]);
  } catch (error) {
    console.warn('mathjax typeset failed', error);
  }
}

function bindMathTypeset(root = app) {
  if (!root) return;
  const markdownNodes = [...root.querySelectorAll('.open-problem-markdown')];
  if (!markdownNodes.length) return;
  markdownNodes.forEach((node) => {
    const content = String(node.textContent || '');
    if (!/\\\(|\\\[|\$/.test(content)) return;
    void typesetMathInRoot(node);
  });
}

function parseProblemSections(descText) {
  const source = String(descText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  const sections = {
    description: [],
    input: [],
    output: [],
    sampleInput: [],
    sampleOutput: []
  };
  if (!source) return sections;

  const normalizeLabel = (line) => {
    const key = String(line || '')
      .replace(/[:：]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
    if (!key) return '';
    if (['描述', '题目描述', 'description'].includes(key)) return 'description';
    if (['输入', 'input'].includes(key)) return 'input';
    if (['输出', 'output'].includes(key)) return 'output';
    if (['样例输入', '输入样例', 'sampleinput'].includes(key)) return 'sampleInput';
    if (['样例输出', '输出样例', 'sampleoutput'].includes(key)) return 'sampleOutput';
    return '';
  };

  let current = 'description';
  source.split('\n').forEach((line) => {
    const trimmed = line.trim();
    const heading = normalizeLabel(trimmed);
    if (heading) {
      current = heading;
      return;
    }
    const inline = trimmed.match(/^(描述|题目描述|输入|输出|样例输入|输入样例|样例输出|输出样例|description|input|output|sample input|sample output)\s*[:：]\s*(.*)$/i);
    if (inline) {
      const nextKey = normalizeLabel(inline[1]);
      if (nextKey) current = nextKey;
      if (inline[2]) sections[current].push(inline[2]);
      return;
    }
    sections[current].push(line);
  });

  return sections;
}

function pickProblemSampleTexts(testcases) {
  const first = Array.isArray(testcases) ? testcases[0] : null;
  if (!first || typeof first !== 'object') return { input: '', output: '' };
  const source = typeof first.content === 'object' && first.content ? first.content : {};
  const hintSource = typeof first.hint === 'object' && first.hint ? first.hint : {};

  const readAny = (obj, keys) => {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
        return String(obj[key]).trim();
      }
    }
    return '';
  };

  const input = readAny(source, ['input', 'in', 'stdin', 'args']) || readAny(hintSource, ['input', 'in', 'stdin']);
  const output = readAny(source, ['output', 'out', 'stdout', 'answer', 'target']) || readAny(hintSource, ['output', 'out', 'stdout']);
  return { input, output };
}

function testcaseTimeLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '-';
  if (num >= 1000) {
    const ms = num / 1000;
    if (ms >= 100) return `${Math.round(ms)}ms`;
    if (ms >= 10) return `${ms.toFixed(1)}ms`;
    return `${ms.toFixed(2)}ms`;
  }
  return `${num.toFixed(2)}μs`;
}

function compareAgainstBaselineTone(status, time, baseline) {
  if (!isPassStatus(status)) return 'neutral';
  const timeNum = Number(time);
  const baselineNum = Number(baseline);
  if (!Number.isFinite(timeNum) || timeNum <= 0 || !Number.isFinite(baselineNum) || baselineNum <= 0) {
    return 'neutral';
  }
  return timeNum <= baselineNum ? 'better' : 'worse';
}

function renderProblemRankTimeChip(label, tone = 'neutral') {
  const normalizedTone = ['better', 'worse', 'baseline'].includes(tone) ? tone : 'neutral';
  return `<span class="open-problem-rank-time-chip is-${normalizedTone}">${escapeHtml(label || '-')}</span>`;
}

let blockingErrorModal = null;
let blockingErrorModalMsg = null;
let blockingErrorModalOkBtn = null;
const activeBodyModalLocks = new Set();
let bodyModalScrollbarGap = null;

function applyBodyModalLockState() {
  if (activeBodyModalLocks.size > 0) {
    if (bodyModalScrollbarGap == null) {
      bodyModalScrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    }
    document.body.style.setProperty('--modal-scrollbar-gap', `${bodyModalScrollbarGap}px`);
    document.body.classList.add('global-error-modal-open');
    return;
  }
  bodyModalScrollbarGap = null;
  document.body.classList.remove('global-error-modal-open');
  document.body.style.removeProperty('--modal-scrollbar-gap');
}

function lockBodyForModal(reason = 'default') {
  activeBodyModalLocks.add(String(reason || 'default'));
  applyBodyModalLockState();
}

function unlockBodyForModal(reason = 'default') {
  activeBodyModalLocks.delete(String(reason || 'default'));
  applyBodyModalLockState();
}

function clearAllBodyModalLocks() {
  activeBodyModalLocks.clear();
  applyBodyModalLockState();
}

function openOverlayModal(node, reason = 'default') {
  if (!node) return;
  node.style.display = 'grid';
  lockBodyForModal(reason);
}

function closeOverlayModal(node, reason = 'default') {
  if (!node) return;
  node.style.display = 'none';
  unlockBodyForModal(reason);
}

function focusWithoutScroll(node) {
  if (!node || typeof node.focus !== 'function') return;
  try {
    node.focus({ preventScroll: true });
  } catch {
    node.focus();
  }
}

function ensureBlockingErrorModal() {
  if (blockingErrorModal && document.body.contains(blockingErrorModal)) return;
  const mask = document.createElement('div');
  mask.className = 'global-error-modal-mask';
  mask.style.display = 'none';
  mask.innerHTML = `
    <section class="global-error-modal-card" role="dialog" aria-modal="true" aria-label="错误信息">
      <h4>错误信息</h4>
      <div class="global-error-modal-message"></div>
      <div class="global-error-modal-actions">
        <button type="button" class="btn primary small" data-action="confirm-global-error">确定</button>
      </div>
    </section>`;
  const msgNode = mask.querySelector('.global-error-modal-message');
  const okBtn = mask.querySelector('[data-action="confirm-global-error"]');
  if (okBtn) {
    okBtn.addEventListener('click', () => {
      mask.style.display = 'none';
      unlockBodyForModal('global-error-modal');
    });
  }
  mask.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (okBtn) okBtn.click();
      return;
    }
    if (event.key === 'Enter' && okBtn) {
      event.preventDefault();
      okBtn.click();
      return;
    }
    if (event.key === 'Tab') {
      const card = mask.querySelector('.global-error-modal-card');
      if (!card) return;
      const focusables = Array.from(card.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !card.contains(document.activeElement)) {
          event.preventDefault();
          focusWithoutScroll(last);
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        focusWithoutScroll(first);
      }
    }
  });
  document.body.appendChild(mask);
  blockingErrorModal = mask;
  blockingErrorModalMsg = msgNode;
  blockingErrorModalOkBtn = okBtn;
}

function showBlockingErrorModal(message, title = '错误信息') {
  ensureBlockingErrorModal();
  if (!blockingErrorModal) return;
  const titleNode = blockingErrorModal.querySelector('h4');
  if (titleNode) {
    titleNode.textContent = String(title || '错误信息');
  }
  if (blockingErrorModalMsg) {
    blockingErrorModalMsg.textContent = String(message || '请求失败');
  }
  blockingErrorModal.style.display = 'grid';
  lockBodyForModal('global-error-modal');
  setTimeout(() => {
    if (blockingErrorModalOkBtn) {
      blockingErrorModalOkBtn.focus();
    }
  }, 0);
}

function showToast(message, type = '', durationOrOptions = 3200, maybeOptions = undefined) {
  let durationMs = 3200;
  let options = {};
  if (typeof durationOrOptions === 'number' || durationOrOptions === undefined || durationOrOptions === null) {
    durationMs = Number(durationOrOptions) || 3200;
    if (maybeOptions && typeof maybeOptions === 'object') {
      options = maybeOptions;
    }
  } else if (typeof durationOrOptions === 'object') {
    options = durationOrOptions || {};
  }
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  const textNode = document.createElement('div');
  textNode.className = 'toast-message';
  textNode.textContent = message;
  node.appendChild(textNode);
  const isError = String(type || '')
    .split(/\s+/)
    .includes('error');
  node.setAttribute('role', isError ? 'alert' : 'status');
  if (isError) {
    showBlockingErrorModal(message);
    return;
  }
  toastRoot.appendChild(node);
  if (options && options.manualCloseOnly) {
    return;
  }
  const timeoutMs = isError
    ? 5000
    : Math.max(1200, durationMs || 3200);
  setTimeout(() => {
    node.remove();
  }, timeoutMs);
}

function mustLogin() {
  if (!state.user) {
    showToast('请先登录', 'error');
    navTo('/auth/login');
    return false;
  }
  return true;
}

function messageActionLabel(action) {
  const key = String(action || '').toLowerCase();
  if (key === 'accept' || key === 'approve') return '同意';
  if (key === 'reject') return '拒绝';
  if (key === 'read') return '标记已读';
  return action;
}

function messageStatusMeta(msg) {
  const status = String(msg?.status || '').toLowerCase();
  const hasActions = Array.isArray(msg?.actions) && msg.actions.length > 0;
  if ((status === 'unread' || status === 'read') && hasActions) {
    return { text: '待审核', pill: 'warning' };
  }
  if (status === 'accepted') return { text: '已同意', pill: 'success' };
  if (status === 'rejected') return { text: '已拒绝', pill: 'danger' };
  if (status === 'expired') return { text: '已过期', pill: 'ghost' };
  if (status === 'read') return { text: '已读', pill: 'ghost' };
  if (status === 'unread') return { text: '未读', pill: 'warning' };
  return { text: status || '-', pill: 'ghost' };
}

function pendingMessageActions(msg) {
  const status = String(msg?.status || '').toLowerCase();
  if (['accepted', 'rejected', 'expired'].includes(status)) return [];
  return Array.isArray(msg?.actions) ? msg.actions : [];
}

function canHandleMessage(msg) {
  return pendingMessageActions(msg).length > 0;
}

function adminGuard(active, message) {
  return {
    html: shellAdmin(noPermissionHtml(message), active),
    bind() {}
  };
}

async function ensureGroupAdminPage(groupId, active, options = {}) {
  const auth = ensureAuthedUserPage();
  if (auth) return { blocked: true, response: auth };
  const group = await getGroup(groupId);
  const requireAdmin = Boolean(options.requireAdmin);
  if (group?.is_public) {
    return {
      blocked: true,
      response: {
        html: shellDefault(
          `<main class="page-main">${noPermissionHtml('公共小组管理界面已关闭，请在超级后台编辑开放题库与开放赛事')}</main>`,
          { top: 'groups' }
        ),
        bind() {}
      }
    };
  }
  const isAdmin = isGroupAdminLocal(group);
  const isManager = isGroupManagerLocal(group);
  const canAccess = requireAdmin ? isAdmin : isManager;
  if (!canAccess) {
    const message = requireAdmin && isManager && !isAdmin ? '助教无权编辑赛事和题单' : '你不是该小组管理成员';
    return {
      blocked: true,
      response: {
        html: shellGroupAdmin(noPermissionHtml(message), active, groupId, group.title || group.name, { group }),
        bind() {}
      }
    };
  }
  return { blocked: false, group, isAdmin, isManager };
}

function contestStatusPill(status) {
  if (status === 'active') return '<span class="pill warning">进行中</span>';
  if (status === 'upcoming') return '<span class="pill primary">即将开始</span>';
  if (status === 'ended') return '<span class="pill ghost">已结束</span>';
  if (status === 'ongoing') return '<span class="pill success">长期题单</span>';
  return '<span class="pill ghost">未知</span>';
}

function bindCommonHeader() {
  const logout = app.querySelector('[data-action="logout"]');
  if (logout) {
    logout.addEventListener('click', async (event) => {
      event.preventDefault();
      try { await api('/api/users/logout', { method: 'POST' }); } catch {}
      clearUser();
      showToast('已退出登录');
      navTo('/home');
    });
  }

  const openMsg = app.querySelectorAll('[data-action="open-msg"]');
  openMsg.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!state.user) {
        showToast('请先登录', 'error');
        navTo('/auth/login');
        return;
      }
      const pop = document.getElementById('msg-popover');
      if (!pop) return;
      const shown = pop.style.display === 'block';
      if (shown) {
        pop.style.display = 'none';
        return;
      }
      if (!pop.dataset.outsideBound) {
        document.addEventListener('click', (docEvent) => {
          const target = docEvent.target;
          if (!(target instanceof Element)) return;
          if (target.closest('#msg-popover')) return;
          if (target.closest('[data-action="open-msg"]')) return;
          pop.style.display = 'none';
        });
        pop.dataset.outsideBound = '1';
      }

      const response = await api('/api/messages', {
        query: { limit: 50 }
      }).catch(() => []);
      const list = Array.isArray(response) ? response : response?.list || [];

      pop.innerHTML = `<div class="msg-pop-card">
        <div class="msg-pop-pointer" aria-hidden="true"></div>
        <div class="msg-pop-head">
          <div class="msg-pop-title">消息</div>
          <button class="msg-pop-close" type="button" data-action="close-msg-pop" aria-label="关闭">×</button>
        </div>
        <div class="msg-pop-body">
          ${
            list.length
              ? list
                  .map((item) => {
                    const content = escapeHtml(item.content || item.title || '系统消息');
                    const meta = messageStatusMeta(item);
                    const actionable = canHandleMessage(item);
                    const terminal = ['accepted', 'rejected', 'expired'].includes(String(item?.status || '').toLowerCase());
                    const actions = pendingMessageActions(item).slice(0, 2);
                    return `<article class="msg-pop-item">
                      <div class="is-flex-between-start-gap8">
                        <div class="msg-pop-text">${content}</div>
                        <span class="pill ${meta.pill}">${escapeHtml(meta.text)}</span>
                      </div>
                      ${
                        actionable
                          ? `<div class="msg-pop-actions">
                        ${actions
                          .map((action) => {
                            const key = String(action || '').toLowerCase();
                            return `<button class="msg-pop-btn ${key === 'accept' || key === 'approve' ? 'primary' : ''}" type="button" data-msg-action="${escapeHtml(
                              action
                            )}" data-msg-id="${item._id}">${escapeHtml(messageActionLabel(action))}</button>`;
                          })
                          .join('')}
                        <button class="msg-pop-btn danger" type="button" data-msg-delete="${item._id}">删除</button>
                      </div>`
                          : terminal
                            ? `<div class="msg-pop-actions"><span class="muted is-mt-2">处理结果：${escapeHtml(meta.text)}</span><button class="msg-pop-btn danger" type="button" data-msg-delete="${item._id}">删除</button></div>`
                            : `<div class="msg-pop-actions"><button class="msg-pop-btn danger" type="button" data-msg-delete="${item._id}">删除</button></div>`
                      }
                    </article>`;
                  })
                  .join('')
              : '<div class="msg-pop-empty">暂无消息</div>'
          }
        </div>
        <div class="msg-pop-foot"><a href="#/me/messages">查看全部消息</a></div>
      </div>`;

      const closeBtn = pop.querySelector('[data-action="close-msg-pop"]');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          pop.style.display = 'none';
        });
      }

      pop.querySelectorAll('[data-msg-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/messages/${btn.dataset.msgId}/action`, {
              method: 'POST',
              data: { action: btn.dataset.msgAction }
            });
            showToast('消息已处理');
            pop.style.display = 'none';
            rerenderApp();
          } catch (error) {
            showToast(error.message, 'error');
          }
        });
      });

      pop.querySelectorAll('[data-msg-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('确认删除该消息？')) return;
          try {
            await api(`/api/messages/${btn.dataset.msgDelete}`, {
              method: 'DELETE',
              query: { userId: state.user._id }
            });
            showToast('消息已删除');
            pop.style.display = 'none';
            rerenderApp();
          } catch (error) {
            showToast(error.message || '删除失败', 'error');
          }
        });
      });

      pop.style.display = 'block';
    });
  });
}

  return {
    shellDefault,
    renderMessagePopover,
    profileAvatar,
    shellAdmin,
    shellGroupAdmin,
    pagination,
    loginPromptHtml,
    noPermissionHtml,
    ensureAuthedUserPage,
    groupFrontShell,
    buildFrontPagerTokens,
    renderFrontPager,
    renderPager,
    statusPill,
    statusKey,
    isPassStatus,
    backendStatusText,
    openStatusChip,
    cleanOpenDesc,
    plainBlockText,
    normalizeProblemMathTextCommands,
    normalizeProblemMathExpression,
    copyTextToClipboard,
    escapeAttr,
    sanitizeMarkdownUrl,
    renderInlineProblemMarkdown,
    mdIsOrderedListItem,
    mdIsUnorderedListItem,
    mdIsQuoteItem,
    mdIsMathBlockStart,
    mdParseTableCells,
    mdIsTableSeparatorLine,
    mdResolveTableAlign,
    mdFindTableSeparatorLineIndex,
    renderProblemDescriptionMarkdown,
    MATHJAX_SOURCES,
    LOCAL_MATHJAX_TIMEOUT_MS,
    hasMathJaxKernel,
    hasMathJaxRuntime,
    installMathJaxTypesetFallback,
    configureMathJaxRuntime,
    waitForMathJaxKernel,
    loadMathJaxScriptFromSource,
    ensureMathJaxReady,
    typesetMathInRoot,
    bindMathTypeset,
    parseProblemSections,
    pickProblemSampleTexts,
    testcaseTimeLabel,
    compareAgainstBaselineTone,
    renderProblemRankTimeChip,
    blockingErrorModal,
    blockingErrorModalMsg,
    blockingErrorModalOkBtn,
    activeBodyModalLocks,
    bodyModalScrollbarGap,
    applyBodyModalLockState,
    lockBodyForModal,
    unlockBodyForModal,
    clearAllBodyModalLocks,
    openOverlayModal,
    closeOverlayModal,
    focusWithoutScroll,
    ensureBlockingErrorModal,
    showBlockingErrorModal,
    showToast,
    mustLogin,
    messageActionLabel,
    messageStatusMeta,
    pendingMessageActions,
    canHandleMessage,
    adminGuard,
    ensureGroupAdminPage,
    contestStatusPill,
    bindCommonHeader
  };
}
