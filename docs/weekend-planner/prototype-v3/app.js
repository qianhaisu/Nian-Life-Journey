(function () {
  "use strict";

  const RAW = window.WEEKEND_RAW;
  const VISITED = window.VISITED_HISTORY;
  const HOME = window.HOME_ARCHIVE;
  const LS_KEY = "nianlife.weekend.v3.excluded/1";

  const PHOTOS = {
    "2026-11-21-shanghai-jufuchang-senlan": {
      src: "./assets/shanghai-jufuchang.jpg",
      alt: "上海长乐路梧桐树荫与平路步行道实景",
      caption: "上海长乐路梧桐人行道与沿街小店"
    },
    "2026-11-21-hangzhou-yaao-mixc": {
      src: "./assets/yaao-mixc.jpg",
      alt: "杭州亚奥万象天地里巷开放街区与商业立面实景",
      caption: "杭州亚奥万象天地「里巷」开放街区"
    },
    "2026-11-21-deqing-xiazhuhu-yucun": {
      src: "./assets/deqing-xiazhuhu.jpg",
      alt: "浙江德清下渚湖湿地芦苇荡与水道实景",
      caption: "浙江德清下渚湖湿地水道与芦苇"
    }
  };

  const INSP_PHOTOS = {
    "insp-shanmo-farming": {
      src: "./assets/insp-shanmo-farming.jpg",
      alt: "萧山山末址村农田甘蔗采收实景"
    },
    "insp-qingshanhu-redwoods": {
      src: "./assets/insp-qingshanhu-redwoods.jpg",
      alt: "临安青山湖水上森林红水杉与湖面栈道俯拍"
    },
    "insp-jingwei-street": {
      src: "./assets/insp-jingwei-street.jpg",
      alt: "杭州经纬国际创意产业园梧桐树与红砖街道"
    },
    "insp-baita-train": {
      src: "./assets/insp-baita-train.jpg",
      alt: "杭州白塔公园复古绿皮火车车厢实景"
    }
  };

  const COPY = {
    "2026-11-21-shanghai-jufuchang-senlan": {
      shortName: "上海巨富长与森兰",
      rankBadge: "首选过夜",
      tagClass: "badge-accent",
      statusTag: "六晴日阴无雨 · 住金桥亚朵",
      driveShort: "约 2 小时 10 分 – 35 分",
      driveCompact: "2h10m–35m",
      weatherShort: "六晴 10–13℃ / 日阴 9–12℃",
      pitch: "把周六唯一晴天留给浦东森兰南草坪与 LaLaport，晚上步行 820m 住进金桥地铁站亚朵 1.8m 大床房；周日退房跨杨浦大桥/内环进静安巨富长和 PAC 假日市集，下午回杭不走回头路。",
      quote: "长乐、富民、巨鹿整体平缓梧桐遮阴、游人少于武康路；个别老洋房小店门前人行道偏窄或有 1–2 级门槛，带伞车遇到轻抬跨过即可。",
      stayBrief: "金桥地铁站亚朵 26㎡ 1.8m 大床 2 早 ¥560 · 周六 12:00 前可退 · 步行 820m 到 LaLaport"
    },
    "2026-11-21-hangzhou-yaao-mixc": {
      shortName: "杭州亚奥万象天地",
      rankBadge: "备选一 · 本地",
      tagClass: "badge-amber",
      statusTag: "常规周末客流待确认",
      driveShort: "约 35 – 45 分钟",
      driveCompact: "35–45 分钟",
      weatherShort: "六晴 11–15℃ / 日多云 12–16℃",
      pitch: "不跨省过夜的市内方案：半开放「里巷」街区连通室内 Mall，停车免费且人车分流；若起风或遇局部活动人多，可立刻转进室内层或 10 分钟车程外的奥体印象城。",
      quote: "前期植物快闪已于 11.17 结束，本周末常规周末各时段实际客流需现场再看，常日探访反馈整体通透好推车。",
      stayBrief: "当日往返免住宿 · 同区约 10 分钟备选奥体印象城"
    },
    "2026-11-21-deqing-xiazhuhu-yucun": {
      shortName: "德清下渚湖与庾村",
      rankBadge: "备选二 · 近郊",
      tagClass: "badge-emerald",
      statusTag: "13:15 最晚出发 · 17 时降至 7℃",
      driveShort: "约 50 – 65 分钟",
      driveCompact: "50–65 分钟",
      weatherShort: "六晴 13–17℃（17 时后 7℃）",
      pitch: "杭宁/杭长高速约 1 小时直达下渚湖湿地，推车可不折叠直接推上大画舫看芦苇，午后转去莫干山脚庾村广场喂白鸽；周六恰逢千人鱼汤饭渔祭活动，现场热闹度与 17 时前上岸时间要抓紧。",
      quote: "一线妈妈 11.16 实拍提到画舫可推车直上锁船头、芦苇正盛；周五前关注傍晚起风降温提醒。",
      stayBrief: "当日往返免住宿 · 最晚 13:15 从三墩出发"
    }
  };

  function icon(name, cls = "weather-ico") {
    const base = `class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    if (name === "sun") return `<svg ${base}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
    if (name === "cloudSun") return `<svg ${base}><path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/></svg>`;
    if (name === "cloud") return `<svg ${base}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
    if (name === "wind") return `<svg ${base}><path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/></svg>`;
    return "";
  }

  function loadExcluded() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr;
      }
    } catch (_) {}
    return JSON.parse(JSON.stringify(RAW.excludedExperienceTypes || []));
  }

  const appState = {
    view: "home",
    systemState: "published",
    travelTab: "plan",
    selectedProposalId: RAW.proposals[0].id,
    departureMode: "sat_morning",
    excludedTypes: loadExcluded(),
    sundayFeedback: null,
    inspFilter: "all",
    openInsp: {},
    showAllHotels: false,
    liveSlotIdx: 0,
    liveFallbackKey: null,
    selectedStampKey: "cn:310000",
    voiceStep: 0,
    hideHomeEntry: false,
    studioOpen: false
  };

  function getProposal(id) {
    return RAW.proposals.find((p) => p.id === id) || RAW.proposals[0];
  }

  function isExcluded(type) {
    return appState.excludedTypes.some((x) => x.experienceType === type);
  }

  function saveExcluded() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(appState.excludedTypes));
    } catch (_) {}
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2400);
  }

  function clearToast() {
    clearTimeout(toastTimer);
    document.getElementById("toast")?.classList.remove("is-visible");
  }

  function rateText(opt) {
    const r = opt.liveRatesCny || {};
    if (opt.name.includes("金桥地铁站亚朵")) return `¥${r.superiorKing2Breakfast} (2早)`;
    if (opt.name.includes("金桥国际商业广场")) return `¥${r.standardKing2Breakfast} 标准 / ¥${r.superiorKing2Breakfast} 高级`;
    if (opt.name.includes("华山路亚朵X")) return `¥${r.elegant151m2Breakfast} (1.51m) / ¥${r.exec18m2Breakfast} (1.8m超上限)`;
    if (opt.name.includes("美居")) return `¥${r.deluxeKing2Breakfast} (2早)`;
    if (opt.name.includes("静安假日")) return `¥${r.superiorKing2Breakfast} (2早)`;
    if (opt.name.includes("全季")) return `¥${r.businessDouble2Breakfast} (2早)`;
    return r.note || "";
  }

  /* Non-PII editorial illustrations preserving authentic Bento Home feel */
  function homeLeadSvg() {
    return `
      <svg class="tile-lead-art" viewBox="0 0 460 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="leadSky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#DCE8F8"/>
            <stop offset="55%" stop-color="#EFE4D7"/>
            <stop offset="100%" stop-color="#DCEADB"/>
          </linearGradient>
        </defs>
        <rect width="460" height="360" fill="url(#leadSky)"/>
        <circle cx="350" cy="78" r="46" fill="#FDE68A" opacity="0.68"/>
        <path d="M0 245 Q115 210 235 236 T460 222 L460 360 L0 360 Z" fill="#C4DBC5" opacity="0.78"/>
        <path d="M0 282 Q150 256 300 280 T460 268 L460 360 L0 360 Z" fill="#9FC0A3" opacity="0.65"/>
        <rect x="64" y="168" width="96" height="68" rx="8" fill="#FFFDF9" stroke="#CBD5E1" stroke-width="2" transform="rotate(-6 112 202)"/>
        <line x1="112" y1="168" x2="112" y2="236" stroke="#CBD5E1" stroke-width="1.5" transform="rotate(-6 112 202)"/>
        <rect x="275" y="218" width="58" height="24" rx="8" fill="#15803D"/>
        <circle cx="290" cy="244" r="7" fill="#1E293B"/>
        <circle cx="318" cy="244" r="7" fill="#1E293B"/>
      </svg>
    `;
  }

  function homeToneSvg(tone) {
    if (tone === "rail") {
      return `<svg class="capsule-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="240" height="320" fill="#B7CEBE"/><path d="M0 230 Q120 205 240 230 L240 320 L0 320 Z" fill="#6F907B"/><rect x="38" y="135" width="164" height="62" rx="10" fill="#22543D"/><rect x="54" y="150" width="28" height="22" rx="3" fill="#DCFCE7"/><rect x="94" y="150" width="28" height="22" rx="3" fill="#DCFCE7"/><rect x="134" y="150" width="28" height="22" rx="3" fill="#DCFCE7"/><line x1="20" y1="208" x2="220" y2="208" stroke="#334155" stroke-width="4"/></svg>`;
    }
    if (tone === "meadow") {
      return `<svg class="capsule-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="240" height="320" fill="#D4E4C8"/><path d="M0 190 Q95 140 240 180 L240 320 L0 320 Z" fill="#9BBF8A"/><path d="M0 245 Q130 220 240 250 L240 320 L0 320 Z" fill="#77A366"/><circle cx="72" cy="82" r="24" fill="#FEF3C7" opacity="0.85"/></svg>`;
    }
    if (tone === "water") {
      return `<svg class="capsule-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="240" height="320" fill="#BAE6FD"/><path d="M0 185 Q80 175 160 188 T240 182 L240 320 L0 320 Z" fill="#60A5FA"/><path d="M0 230 Q100 218 240 234 L240 320 L0 320 Z" fill="#3B82F6" opacity="0.55"/></svg>`;
    }
    if (tone === "car") {
      return `<svg class="capsule-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="240" height="320" fill="#FDE68A"/><rect x="44" y="148" width="152" height="52" rx="12" fill="#EF4444"/><circle cx="78" cy="204" r="14" fill="#1E293B"/><circle cx="162" cy="204" r="14" fill="#1E293B"/></svg>`;
    }
    const palettes = {
      sage: ["#E2ECE4", "#84A98C"],
      amber: ["#FEF3C7", "#F59E0B"],
      sky: ["#E0F2FE", "#38BDF8"]
    };
    const [bg, fg] = palettes[tone] || palettes.sage;
    return `<svg viewBox="0 0 320 240" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="240" fill="${bg}"/><circle cx="242" cy="68" r="34" fill="${fg}" opacity="0.32"/><path d="M0 175 Q95 140 200 165 T320 155 L320 240 L0 240 Z" fill="${fg}" opacity="0.45"/></svg>`;
  }

  function renderWeatherBar() {
    const isShift = appState.systemState === "weather_shift";
    const items = isShift
      ? [
          { ico: "sun", city: "上海 · 浦东/静安", line: "六晴 10–13℃ / 日阴微风 9–12℃（无雨维持）", warn: false },
          { ico: "wind", city: "杭州 · 萧山亚奥", line: "周六午后多云转阴 10–14℃ · 室内连廊不受影响", warn: false },
          { ico: "wind", city: "德清 · 下渚湖（微调）", line: "周六 17 时前起风降至 6–7℃ · 建议 16:00 前上岸", warn: true }
        ]
      : [
          { ico: "sun", city: "上海 · 浦东/静安", line: "六 晴 10–13℃  /  日 阴 9–12℃（微风无雨）", warn: false },
          { ico: "cloudSun", city: "杭州 · 萧山亚奥", line: "六 晴 11–15℃  /  日 晴转多云 12–16℃", warn: false },
          { ico: "sun", city: "德清 · 下渚湖", line: "六 晴 13–17℃  /  日 9–16℃ · 17时降至 7℃", warn: true }
        ];
    return `
      <section class="weather-bar" aria-label="周末三地天气">
        ${items.map((w) => `
          <div class="weather-item">
            ${icon(w.ico)}
            <div class="weather-text">
              <div class="weather-city-name">${w.city}</div>
              <div class="weather-temps num ${w.warn ? "weather-warn" : ""}">${w.line}</div>
            </div>
          </div>
        `).join("")}
      </section>
    `;
  }

  function renderHomeEntryStrip() {
    if (appState.hideHomeEntry) return "";
    const st = appState.systemState;
    if (st === "collecting") {
      return `
        <section class="weekend-entry-strip is-amber" aria-label="周末去哪入口">
          <div class="weekend-entry-main">
            <span class="weekend-entry-pill">这周末 11.21–22</span>
            <span class="weekend-entry-title">出行想法整理中（预计周三晚发布）</span>
            <span class="weekend-entry-meta">可先点进旅行页看 4 处季节灵感库。</span>
          </div>
          <div class="weekend-entry-actions">
            <button type="button" class="btn btn-secondary" data-go-travel="plan">去旅行页 →</button>
          </div>
        </section>
      `;
    }
    if (st === "expired_rest") {
      return `
        <section class="weekend-entry-strip is-muted" aria-label="周末去哪入口">
          <div class="weekend-entry-main">
            <span class="weekend-entry-pill">上期 11.21–22</span>
            <span class="weekend-entry-title">本周末已结束，可在旅行页记一下周日轻反馈</span>
            <span class="weekend-entry-meta">不计入正式足迹，只用来校准下周建议。</span>
          </div>
          <div class="weekend-entry-actions">
            <button type="button" class="btn btn-quiet" data-go-travel="plan">去记一下 →</button>
          </div>
        </section>
      `;
    }
    if (st === "weather_shift") {
      return `
        <section class="weekend-entry-strip is-amber" aria-label="周末去哪入口">
          <div class="weekend-entry-main">
            <span class="weekend-entry-pill">周五天气微调</span>
            <span class="weekend-entry-title">上海两日无雨照旧（金桥亚朵 ¥560），德清傍晚降温至 6–7℃</span>
            <span class="weekend-entry-meta">进旅行页查看 3 套方案最新时段。</span>
          </div>
          <div class="weekend-entry-actions">
            <button type="button" class="btn btn-primary" data-go-travel="plan">查看 3 套方案 →</button>
          </div>
        </section>
      `;
    }
    if (st === "unavailable") {
      return `
        <section class="weekend-entry-strip is-amber" aria-label="周末去哪入口">
          <div class="weekend-entry-main">
            <span class="weekend-entry-pill">示例演示状态</span>
            <span class="weekend-entry-title">模拟金桥地铁站亚朵满房时，可切金桥国际商业广场亚朵（¥543）</span>
            <span class="weekend-entry-meta">或改选杭州、德清当日往返方案。</span>
          </div>
          <div class="weekend-entry-actions">
            <button type="button" class="btn btn-primary" data-go-travel="plan">查看备选方案 →</button>
          </div>
        </section>
      `;
    }
    return `
      <section class="weekend-entry-strip" aria-label="周末去哪入口">
        <div class="weekend-entry-main">
          <span class="weekend-entry-pill">这周末 11.21–22</span>
          <span class="weekend-entry-title">上海森兰 &amp; 巨富长 · 金桥亚朵 2 早 ¥560</span>
          <span class="weekend-entry-meta num">另有杭州、德清当日备选 · 周六晴 10–13℃</span>
        </div>
        <div class="weekend-entry-actions">
          <button type="button" class="btn btn-primary" data-go-travel="plan">去看看 →</button>
        </div>
      </section>
    `;
  }

  function renderHome() {
    const pool = HOME.voicePool || [];
    const shownVoices = [];
    for (let i = 0; i < Math.min(3, pool.length); i++) {
      shownVoices.push(pool[(appState.voiceStep + i) % pool.length]);
    }

    return `
      <div class="home-canvas">
        <header class="canvas-greeting">
          <p class="greeting-kicker num">
            <span class="greeting-kicker-dot" aria-hidden="true"></span>
            <span>${HOME.clock.todayLabel}</span>
            <span>· ${HOME.clock.currentAgeLabel}</span>
          </p>
          <h1 class="home-greeting">最近怎么样，张年</h1>
          <p class="home-answer">
            <span class="home-answer-tag">${HOME.answer.monthLabel}</span>
            <span>${HOME.answer.line}</span>
            <button type="button" class="home-answer-cta" data-action="archive-toast">查看这一天 →</button>
          </p>
        </header>

        ${renderHomeEntryStrip()}

        <div class="bento-hero">
          <button type="button" class="bento-tile tile-lead-photo" data-action="archive-toast">
            ${homeLeadSvg()}
            <div class="lead-scrim">
              <div class="lead-kicker num">${HOME.leadMemory.kicker}</div>
              <h2 class="lead-title">${HOME.leadMemory.title}</h2>
              <div class="lead-privacy-note">${HOME.leadMemory.note}</div>
            </div>
          </button>

          <button type="button" class="bento-tile tile-latest-day" data-action="archive-toast">
            <span class="day-slice-thumb">${homeToneSvg("amber")}</span>
            <span class="day-slice-body">
              <span class="day-slice-badge num">${HOME.latestDay.shortDateLabel} · ${HOME.latestDay.ageDisplay}</span>
              <span class="day-slice-title">${HOME.latestDay.title}</span>
              <span class="day-slice-excerpt">${HOME.latestDay.excerpt}</span>
              <span class="day-slice-cta">读这一天 →</span>
            </span>
          </button>

          <section class="bento-tile tile-growth" aria-label="近月成长">
            <div>
              <div class="tile-growth-head">
                <span class="tile-label tile-label--lavender">近月成长</span>
                <span class="tile-growth-clock num">${HOME.growthHighlight.monthLabel} · ${HOME.growthHighlight.ageDisplay}</span>
              </div>
              <p class="growth-headline">${HOME.growthHighlight.headline}</p>
            </div>
            <ul class="growth-tags">
              ${HOME.growthHighlight.tags.map((tag) => `<li class="growth-tag">${tag}</li>`).join("")}
            </ul>
          </section>

          <section class="bento-tile tile-voices" aria-label="家人的话">
            <div class="tile-voices-head">
              <h2 class="tile-label tile-label--peach">家人的话</h2>
              <button type="button" class="tile-rotate-btn" data-action="rotate-voices">换一批</button>
            </div>
            <div class="chat-bubbles">
              ${shownVoices.map((v) => `
                <div class="chat-msg">
                  <span class="chat-avatar chat-avatar--${v.tone}" aria-hidden="true">${v.initial}</span>
                  <div>
                    <span class="chat-text">「${v.quote}」</span>
                    <span class="chat-meta num"><strong>${v.speaker}</strong> · ${v.shortDateLabel} · ${v.ageDisplay}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </section>

          <button type="button" class="bento-tile tile-film" data-action="archive-toast">
            <div class="home-film-poster">
              <span class="home-film-duration num">▶ ${HOME.filmEntry.duration}</span>
            </div>
            <div>
              <span class="home-film-kicker num">${HOME.filmEntry.monthLabel} · ${HOME.filmEntry.ageDisplay}</span>
              <span class="home-film-title">${HOME.filmEntry.title}</span>
              <span class="home-film-sub">${HOME.filmEntry.subtitle}</span>
            </div>
          </button>
        </div>

        <section class="mod-section mod-section--journal" aria-label="近期日常">
          <div class="mod-sec-head">
            <h2 class="mod-sec-title">近期日常</h2>
            <button type="button" class="mod-sec-pill" data-action="archive-toast">11 月记录 →</button>
          </div>
          <div class="journal-grid">
            ${HOME.journalDays.map((d) => `
              <button type="button" class="j-card" data-action="archive-toast">
                <div class="j-card-photo">${homeToneSvg(d.tone)}</div>
                <p class="j-card-meta num">${d.weekdayDateLabel} · ${d.ageDisplay}</p>
                <h3 class="j-card-title">${d.title}</h3>
                <p class="j-card-excerpt">${d.excerpt}</p>
                <div class="j-card-foot">读这一天 →</div>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="mod-section mod-section--capsules" aria-label="过去的张年">
          <div class="mod-sec-head">
            <h2 class="mod-sec-title">过去的张年</h2>
            <button type="button" class="mod-sec-pill" data-action="archive-toast">全部记忆 →</button>
          </div>
          <div class="capsule-strip">
            ${HOME.capsules.map((c) => `
              <button type="button" class="capsule-card" data-action="archive-toast">
                ${homeToneSvg(c.tone)}
                <span class="capsule-scrim" aria-hidden="true"></span>
                <span class="capsule-badge num">${c.badgeLabel}</span>
                <span class="capsule-info">
                  <time class="capsule-date num">${c.fullDateLabel} · ${c.ageDisplay}</time>
                  <span class="capsule-title">${c.title}</span>
                </span>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="footprint-panel" aria-label="旅行足迹">
          <div class="widget-head">
            <div class="widget-title-wrap">
              <h2 class="widget-title">旅行足迹</h2>
              <span class="widget-badge--mint num">${VISITED.stats}</span>
            </div>
            <button type="button" class="btn btn-quiet" data-go-travel="visited">足迹地图 →</button>
          </div>
          <div class="footprint-latest" role="button" tabindex="0" data-go-travel="visited">
            <div class="num" style="font-size: var(--text-xs); color: var(--color-muted);">${VISITED.latestTrip.rangeLabel} · 当时 1 岁 7 个月</div>
            <div style="font-weight: 700; font-size: var(--text-md); margin: 4px 0;">${VISITED.latestTrip.title}</div>
            <div style="font-size: var(--text-sm); color: var(--color-ink-2);">${VISITED.latestTrip.summary}</div>
          </div>
          <div class="footprint-foot">
            <button type="button" class="btn btn-quiet" data-go-travel="plan">看看这周末准备去哪 →</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderVisited() {
    const sel = VISITED.stamps.find((s) => s.key === appState.selectedStampKey) || VISITED.stamps[6];
    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">足迹记录</h1>
          <p class="page-sub">已点亮 ${VISITED.stats}，只收已经去过并留下照片或日子记录的旅行；未成行的周末提案不会放进这里。</p>
        </div>
        <div class="seg-pill">
          <button type="button" class="seg-pill-btn" data-travel-tab="plan">准备去哪</button>
          <button type="button" class="seg-pill-btn is-active" data-travel-tab="visited">已经去过</button>
        </div>
      </div>

      <section class="surface-card">
        <div class="section-heading">
          <h2>最近出行：${VISITED.latestTrip.title}</h2>
          <p class="num">${VISITED.latestTrip.rangeLabel}</p>
        </div>
        <p class="archive-copy">${VISITED.latestTrip.summary}</p>
        <div class="stamps-grid">
          ${VISITED.stamps.map((s) => `
            <button type="button" class="stamp-tile ${s.key === sel.key ? "is-active" : ""}" data-stamp-key="${s.key}">
              <div style="font-weight: 700; font-size: var(--text-sm);">${s.name}</div>
              <div class="num" style="font-size: var(--text-xs); color: var(--color-muted);">${s.firstMonth} · ${s.visits} 次</div>
            </button>
          `).join("")}
        </div>
        <p style="margin-top: var(--space-md); font-size: var(--text-sm); color: var(--color-ink-2);">
          当前查看：<strong>${sel.name}</strong>（首次抵达 ${sel.firstMonth}，累计 ${sel.visits} 次）
        </p>
      </section>
    `;
  }

  function renderInspirationCard(item) {
    const open = !!appState.openInsp[item.id];
    const kf = item.keyFacts || {};
    const ph = INSP_PHOTOS[item.id] || {};
    const isSeasonal = item.poolKind === "seasonalLimited";
    const isWeak = item.signalStrength === "weak";
    const notes = item.xhsEvidence || [];
    const extraSources = (item.sources || []).filter((u) => !String(u).includes("xiaohongshu.com"));

    return `
      <article class="insp-card-item">
        <div class="insp-card-photo">
          <img src="${ph.src || ""}" alt="${ph.alt || item.title}" />
        </div>
        <div class="insp-card-body">
          <div class="btn-row">
            <span class="badge ${isSeasonal ? "badge-emerald" : "badge-muted"}">${isSeasonal ? "应季限定" : "常驻备选"}</span>
            ${isWeak ? `<span class="badge badge-amber">信号较弱</span>` : ""}
          </div>
          <h3 class="insp-card-title">${item.title}</h3>
          <div class="insp-card-meta num">${item.region}</div>
          <p class="insp-card-why">${item.whyThisWeek}</p>
          ${item.caveat ? `<div class="insp-caveat">${item.caveat}</div>` : ""}
          <div class="insp-card-actions">
            <button type="button" class="btn btn-secondary" aria-expanded="${open}" data-insp-toggle="${item.id}">
              ${open ? "收起详情" : "看开放门票与小红书"}
            </button>
            <button type="button" class="btn btn-ghost" data-dislike-type="${item.experienceType}" data-dislike-label="${item.experienceTypeLabel}">
              不喜欢这类
            </button>
          </div>
        </div>
        ${open ? `
          <div class="insp-expanded">
            <div class="insp-facts-grid">
              <div><strong>开放时间：</strong>${kf.openingHours || "待现场确认"}</div>
              <div><strong>门票与预约：</strong>${kf.ticketSummary || "待确认"}（${kf.bookingChannel || "免预约"}）</div>
              <div><strong>推车与停车：</strong>${kf.strollerNote || "平路通行"}</div>
            </div>
            ${notes.length ? `
              <div class="insp-xhs-list">
                <strong>小红书近期实拍（仅文字与直跳链接）：</strong>
                ${notes.map((n) => `
                  <div class="insp-xhs-row">
                    <div>
                      <a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.title}</a>
                      <span class="num" style="color: var(--color-muted);"> · ${n.author} · ${n.publishedAt} · ${n.likes}赞/${n.commentCountText}</span>
                    </div>
                    <div style="margin-top: 3px;">${n.keyTakeaway}；${n.commentFeedback}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
            ${extraSources.length ? `
              <div>
                <strong>参考来源：</strong>
                ${extraSources.map((u, idx) => `<a href="${u}" target="_blank" rel="noopener noreferrer" style="color: var(--color-accent); margin-right: 8px;">参考链接 ${idx + 1}</a>`).join("")}
              </div>
            ` : ""}
          </div>
        ` : ""}
      </article>
    `;
  }

  function renderTravel() {
    if (appState.travelTab === "visited") return renderVisited();

    const banners = {
      weather_shift: {
        cls: "is-amber",
        title: "周五天气复核：德清周六 17 时前起风降温至 6–7℃",
        desc: "上海两日无雨维持不变，杭州亚奥全室内备选不受影响；若选德清下渚湖，建议按 09:30 早出发并在 16:00 前上岸返杭。"
      },
      unavailable: {
        cls: "is-crimson",
        title: "示例演示状态：模拟「金桥地铁站亚朵」临时满房或推荐暂未更新",
        desc: "同沿线可无缝切往「上海浦东金桥国际商业广场亚朵酒店」（标准 2 早 ¥490 / 高级 2 早 ¥543，免费停车），或改选杭州、德清当日往返。"
      },
      collecting: {
        cls: "is-amber",
        title: "本周提案整理中（酒店实价与周五短时天气核对中）",
        desc: "完整三套备选预计周三晚间发布，先浏览下方 4 处季节灵感库。"
      },
      expired_rest: {
        cls: "",
        title: "往期方案 · 2026 年 11 月 21–22 日（已过周末）",
        desc: "未确认成行前不会进入正式足迹；可在下方顺手点一次周日轻反馈。"
      }
    };
    const activeBanner = banners[appState.systemState];
    const activeList = RAW.proposals.filter((p) => !isExcluded(p.experienceType));
    const lead = activeList[0];
    const backups = activeList.slice(1);
    const showPlanCards = appState.systemState !== "collecting" && appState.systemState !== "expired_rest";

    const inspList = (RAW.inspirationPool || []).filter((item) => {
      if (isExcluded(item.experienceType)) return false;
      if (appState.inspFilter === "seasonal") return item.poolKind === "seasonalLimited";
      if (appState.inspFilter === "evergreen") return item.poolKind === "evergreen";
      return true;
    });

    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">周末去哪</h1>
          <p class="page-sub num">2026 年 11 月 21 日 – 22 日 · 1 岁 10 个月推车平路为主</p>
        </div>
        <div class="seg-pill">
          <button type="button" class="seg-pill-btn is-active" data-travel-tab="plan">准备去哪</button>
          <button type="button" class="seg-pill-btn" data-travel-tab="visited">已经去过</button>
        </div>
      </div>

      ${activeBanner ? `
        <div class="notice-banner ${activeBanner.cls}">
          <div>
            <div class="notice-title">${activeBanner.title}</div>
            <div class="notice-desc">${activeBanner.desc}</div>
          </div>
          ${appState.systemState === "unavailable" ? `<button type="button" class="btn btn-secondary" data-open-detail="${RAW.proposals[0].id}">看沿线亚朵对比</button>` : ""}
        </div>
      ` : ""}

      ${showPlanCards ? `
        ${renderWeatherBar()}

        ${lead ? (() => {
          const cp = COPY[lead.id];
          const ph = PHOTOS[lead.id];
          return `
            <article class="lead-proposal-card">
              <div class="proposal-photo-wrap">
                <img src="${ph.src}" alt="${ph.alt}" width="1280" height="720" fetchpriority="high" />
              </div>
              <div class="proposal-body">
                <div>
                  <div class="btn-row" style="margin-bottom: var(--space-xs);">
                    <span class="badge ${cp.tagClass}">${cp.rankBadge}</span>
                    <span class="badge badge-emerald">${cp.statusTag}</span>
                  </div>
                  <h2 class="proposal-title">${lead.title}</h2>
                </div>
                <p class="proposal-pitch">${cp.pitch}</p>
                <div class="kv-strip">
                  <div class="kv-item"><span class="kv-k">三墩车程</span><span class="kv-v num">${cp.driveShort}</span></div>
                  <div class="kv-item"><span class="kv-k">住宿建议</span><span class="kv-v">${cp.stayBrief}</span></div>
                </div>
                <blockquote class="quote-whisper">${cp.quote}</blockquote>
                <div class="btn-row">
                  <button type="button" class="btn btn-primary" data-open-detail="${lead.id}">看详情与酒店</button>
                  <button type="button" class="btn btn-secondary" data-open-live="${lead.id}">周六现场</button>
                  <button type="button" class="btn btn-ghost" data-dislike-type="${lead.experienceType}" data-dislike-label="${lead.experienceTypeLabel}">不喜欢这类</button>
                </div>
              </div>
            </article>
          `;
        })() : `<div class="surface-card" style="margin-bottom: var(--space-lg);">当前已将全部分类加入「已避开」，可在页面底部点「撤销」。</div>`}

        ${backups.length ? `
          <div class="backups-pair">
            ${backups.map((p) => {
              const cp = COPY[p.id];
              const ph = PHOTOS[p.id];
              const isDqShift = p.id.includes("deqing") && appState.systemState === "weather_shift";
              const weatherTxt = isDqShift ? "六晴 13–17℃（17 时起风降至 6–7℃）" : cp.weatherShort;
              return `
                <article class="backup-card">
                  <div class="backup-photo">
                    <img src="${ph.src}" alt="${ph.alt}" width="1160" height="870" />
                  </div>
                  <div class="backup-body">
                    <div class="btn-row">
                      <span class="badge badge-muted">${cp.rankBadge}</span>
                      <span class="badge ${cp.tagClass}">${cp.statusTag}</span>
                    </div>
                    <h3 class="proposal-title">${p.title}</h3>
                    <p class="proposal-pitch">${cp.pitch}</p>
                    <div class="kv-strip">
                      <div class="kv-item"><span class="kv-k">车程天气</span><span class="kv-v num">${cp.driveCompact} · ${weatherTxt}</span></div>
                      <div class="kv-item"><span class="kv-k">安排贴士</span><span class="kv-v">${cp.stayBrief}</span></div>
                    </div>
                    <blockquote class="quote-whisper">${cp.quote}</blockquote>
                    <div class="backup-footer">
                      <div class="btn-row">
                        <button type="button" class="btn btn-quiet" data-open-detail="${p.id}">看详情</button>
                        <button type="button" class="btn btn-quiet" data-open-live="${p.id}">现场模式</button>
                        <button type="button" class="btn btn-ghost" data-dislike-type="${p.experienceType}" data-dislike-label="${p.experienceTypeLabel}">不喜欢这类</button>
                      </div>
                    </div>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        ` : ""}

        <section class="surface-card route-map-panel" aria-label="三墩出发方位与车程图">
          <div class="section-heading">
            <h2>三墩出发相对方位与车程</h2>
            <p>点击目的地直接看详细时间轴</p>
          </div>
          <svg class="route-svg" viewBox="0 0 640 165" role="img" aria-label="从杭州三墩出发到萧山亚奥、德清下渚湖与上海浦东静安车程对比图">
            <line x1="88" y1="106" x2="245" y2="132" stroke="var(--color-line-strong)" stroke-width="2" />
            <line x1="88" y1="106" x2="245" y2="38" stroke="var(--color-line-strong)" stroke-width="2" />
            <line x1="88" y1="106" x2="530" y2="62" stroke="var(--color-accent)" stroke-width="2.5" />

            <circle cx="88" cy="106" r="6" fill="var(--color-ink)" />
            <text x="88" y="90" text-anchor="middle" fill="var(--color-ink)" font-size="12" font-weight="600">杭州三墩</text>

            <g class="map-node" data-open-detail="2026-11-21-hangzhou-yaao-mixc">
              <circle cx="245" cy="132" r="6" fill="var(--color-amber)" />
              <text x="259" y="130" fill="var(--color-ink)" font-size="12" font-weight="600">亚奥万象天地</text>
              <text x="259" y="146" fill="var(--color-muted)" font-size="11">35–45 分钟 · 当日</text>
            </g>

            <g class="map-node" data-open-detail="2026-11-21-deqing-xiazhuhu-yucun">
              <circle cx="245" cy="38" r="6" fill="var(--color-emerald)" />
              <text x="259" y="36" fill="var(--color-ink)" font-size="12" font-weight="600">德清下渚湖</text>
              <text x="259" y="52" fill="var(--color-muted)" font-size="11">50–65 分钟 · 当日</text>
            </g>

            <g class="map-node" data-open-detail="2026-11-21-shanghai-jufuchang-senlan">
              <circle cx="530" cy="62" r="7" fill="var(--color-accent)" />
              <text x="530" y="44" text-anchor="middle" fill="var(--color-accent)" font-size="12" font-weight="700">上海森兰 &amp; 巨富长</text>
              <text x="530" y="84" text-anchor="middle" fill="var(--color-muted)" font-size="11">2h10m–35m · 住金桥亚朵 ¥560</text>
            </g>
          </svg>
        </section>
      ` : ""}

      <section class="insp-card" aria-label="季节灵感库">
        <div class="section-heading">
          <div>
            <h2>季节灵感库（${RAW.inspirationPool.length} 处真实备选）</h2>
            <p>留给下次换口味或临时起意出门，每处都带实景配图、避坑提醒与可展开详情</p>
          </div>
          <div class="seg-pill">
            <button type="button" class="seg-pill-btn ${appState.inspFilter === "all" ? "is-active" : ""}" data-insp-filter="all">全部 (${RAW.inspirationPool.length})</button>
            <button type="button" class="seg-pill-btn ${appState.inspFilter === "seasonal" ? "is-active" : ""}" data-insp-filter="seasonal">应季限定</button>
            <button type="button" class="seg-pill-btn ${appState.inspFilter === "evergreen" ? "is-active" : ""}" data-insp-filter="evergreen">常驻</button>
          </div>
        </div>
        <div class="insp-grid">
          ${inspList.length ? inspList.map(renderInspirationCard).join("") : `<div style="padding: 12px 0; color: var(--color-muted);">当前筛选下暂无未避开的条目。</div>`}
        </div>
      </section>

      <section class="surface-card">
        <div class="section-heading">
          <h2>周日轻反馈（帮以后排得更准，不计入正式足迹）</h2>
        </div>
        <div class="btn-row" style="margin-bottom: var(--space-md);">
          ${[
            ["great", "去了，都喜欢"],
            ["kid_only", "娃开心大人累"],
            ["tired", "太赶不便"],
            ["crowded", "人多踩雷"],
            ["stayed_home", "没去在家歇"]
          ].map(([k, lbl]) => `
            <button type="button" class="btn btn-secondary ${appState.sundayFeedback === k ? "is-selected" : ""}" data-sunday-fb="${k}">${lbl}</button>
          `).join("")}
        </div>
        <div id="excludedChips" style="font-size: var(--text-xs); color: var(--color-muted);">
          已避开类型：
          ${appState.excludedTypes.length ? appState.excludedTypes.map((ex) => `
            <span class="badge badge-muted" style="margin-left: 4px;">
              ${ex.label}
              <button type="button" style="border:0;background:transparent;color:var(--color-accent);cursor:pointer;font-weight:600;padding:0 0 0 4px;" data-undo-type="${ex.experienceType}">撤销</button>
            </span>
          `).join("") : "无"}
        </div>
      </section>
    `;
  }

  function renderHotelBlock(p) {
    const h = p.hotel;
    if (!h || !h.required) {
      return `
        <section class="detail-section">
          <div class="section-heading"><h2>住宿安排</h2></div>
          <p style="margin: 0; color: var(--color-ink-2);">${h?.note || "当日往返即可，不安排过夜。"}</p>
        </section>
      `;
    }

    const win = h.options[0];
    const intlAlt = h.options[1];
    const huashan = h.options[2];

    return `
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h2>住哪里 · 首选上海浦东金桥地铁站亚朵酒店</h2>
            <p>11.21–22 携程实查（2 成人 + 1 岁 10 个月同睡 1.8m 大床，无需婴儿床 · 硬上限 ¥1,000）</p>
          </div>
          <a class="btn btn-secondary" href="${win.bookingUrl}" target="_blank" rel="noopener noreferrer">携程查实时房态</a>
        </div>

        <div class="hotel-gallery">
          <figure class="hotel-photo-card">
            <div class="hotel-photo-frame"><img src="./assets/atour-metro-ext.jpg" alt="上海浦东金桥地铁站亚朵酒店外观" width="1138" height="853" /></div>
            <figcaption class="hotel-photo-cap">首选 · 金桥地铁站亚朵外观（2023 年开业）</figcaption>
          </figure>
          <figure class="hotel-photo-card">
            <div class="hotel-photo-frame"><img src="./assets/atour-metro-room1.jpg" alt="金桥地铁站亚朵26平米1.8米高级大床房实景" width="1280" height="853" /></div>
            <figcaption class="hotel-photo-cap">26㎡ 高级大床房（1.8m 大床 2 早 ¥560）</figcaption>
          </figure>
          <figure class="hotel-photo-card">
            <div class="hotel-photo-frame"><img src="./assets/atour-intl-ext.jpg" alt="上海浦东金桥国际商业广场亚朵酒店外观" width="1280" height="800" /></div>
            <figcaption class="hotel-photo-cap">沿线备选 · 金桥国际商业广场亚朵（¥490–¥543）</figcaption>
          </figure>
        </div>

        <div class="hotel-win-box">
          <div class="hotel-win-top">
            <div>
              <strong>${win.name}</strong> · <span style="font-size: var(--text-sm); color: var(--color-ink-2);">${win.brandType} · ${win.recommendedRoom}</span>
            </div>
            <div class="hotel-price-big num">2 早 ¥${win.liveRatesCny.superiorKing2Breakfast}</div>
          </div>
          <p style="margin: 0 0 8px; font-size: var(--text-sm); color: var(--color-ink-2);">
            <strong>取消、早餐与停车：</strong>${win.freeCancellationDeadline} · 1.2m 以下儿童早餐免费 · ${win.parkingPolicy}<br/>
            <strong>为什么选这家：</strong>更贴合家里偏爱的亚朵床品与 2023 年新装修设施（1 早 ¥488 / 2 早 ¥560 接近 ¥500 常规区间）；步行 820m 到 LaLaport 金桥，晚上逛完直接推车散步回房早点休息。周日 09:45 退房上杨浦大桥/内环约 25–30 分钟直抵静安 PAC 现代地库，全程不走回头路。
          </p>
        </div>

        <div class="hotel-alt-pair">
          <div class="hotel-alt-mini">
            <div style="font-weight: 700; font-size: var(--text-sm); margin-bottom: 4px;">沿线亚朵对比 · ${intlAlt.name}</div>
            <div style="font-size: var(--text-xs); color: var(--color-muted); margin-bottom: 6px;">标准 2 早 ¥490 / 高级 2 早 ¥543 · 周六 12:00 前可退</div>
            <div style="font-size: var(--text-sm); color: var(--color-ink-2);">去静安更近内环约省 5 分钟、免费停车；但 2018 年开业略旧，1.2m 以下儿童早另计 ¥24 且不能步行往返 LaLaport。</div>
          </div>
          <div class="hotel-alt-mini">
            <div style="font-weight: 700; font-size: var(--text-sm); margin-bottom: 4px;">若看静安商圈 · ${huashan.name}</div>
            <div style="font-size: var(--text-xs); color: var(--color-muted); margin-bottom: 6px;">1.51m 2早 ¥851 · 1.8m 2早 ¥1,040（超 ¥1,000 上限）</div>
            <div style="font-size: var(--text-sm); color: var(--color-ink-2);">周日下楼即逛巨富长，但 17–18㎡ 空间局促、周六进城堵车，1.8m 含双早超 ¥1,000 硬上限且市区停车收费未明。</div>
          </div>
        </div>

        <button type="button" class="btn btn-quiet" style="white-space: normal; height: auto; padding-block: 9px; text-align: left;" id="toggleAllHotelsBtn" data-action="toggle-hotels">
          ${appState.showAllHotels ? "收起 6 家完整核价对比表" : `展开全部 ${h.options.length} 家同条件核价与 ${h.eliminatedOptions.length} 家淘汰记录`}
        </button>

        ${appState.showAllHotels ? `
          <div class="hotel-table-wrap">
            <table class="hotel-table">
              <thead>
                <tr>
                  <th>酒店与区域</th>
                  <th>大床房型</th>
                  <th>周六实价</th>
                  <th>取消与停车</th>
                  <th>儿童同睡政策</th>
                  <th>动线取舍</th>
                </tr>
              </thead>
              <tbody>
                ${h.options.map((o) => `
                  <tr>
                    <td><strong>${o.name}</strong><br/><span style="font-size: var(--text-xs); color: var(--color-muted);">${o.districtArea} · ${o.brandType}</span></td>
                    <td>${o.recommendedRoom}</td>
                    <td class="num">${rateText(o)}</td>
                    <td>${o.freeCancellationDeadline}<br/>${o.parkingPolicy}</td>
                    <td>${o.childAndCribPolicy}</td>
                    <td>${o.routingNote}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
            <div style="padding-top: var(--space-sm); font-size: var(--text-xs); color: var(--color-muted);">
              ${h.eliminatedOptions.map((e) => `<p style="margin: 2px 0;"><strong>${e.name}：</strong>${e.reason}</p>`).join("")}
            </div>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderDetail() {
    const p = getProposal(appState.selectedProposalId);
    const cp = COPY[p.id];
    const ph = PHOTOS[p.id];
    const dep = p.departures[appState.departureMode] || p.departures.sat_morning;
    const isDeqingLate = p.id.includes("deqing") && appState.departureMode === "sat_afternoon";
    const isDeqingShift = p.id.includes("deqing") && appState.systemState === "weather_shift";

    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">${p.title}</h1>
          <p class="page-sub">${cp.rankBadge} · 基准车程 ${cp.driveShort}</p>
        </div>
        <div class="seg-pill" aria-label="切换查看方案详情">
          ${RAW.proposals.map((item) => `
            <button type="button" class="seg-pill-btn ${item.id === p.id ? "is-active" : ""}" data-open-detail="${item.id}">${COPY[item.id].shortName}</button>
          `).join("")}
        </div>
      </div>

      <section class="detail-hero">
        <div class="proposal-photo-wrap">
          <img src="${ph.src}" alt="${ph.alt}" width="1280" height="720" fetchpriority="high" />
        </div>
        <div class="proposal-body">
          <p class="proposal-pitch">${cp.pitch}</p>
          <div class="kv-strip">
            <div class="kv-item"><span class="kv-k">三墩车程</span><span class="kv-v num">${p.driveFromSandun.durationLabel}</span></div>
            <div class="kv-item"><span class="kv-k">天气窗</span><span class="kv-v num">${(p.weatherSlots || []).map((w) => `${w.slotLabel} ${w.condition} ${w.tempRangeC}`).join("；")}</span></div>
            <div class="kv-item"><span class="kv-k">出行原则</span><span class="kv-v">1 岁 10 个月推车平路为主，无需带婴儿床，大床同睡</span></div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-open-live="${p.id}">进入周六现场</button>
            <button type="button" class="btn btn-secondary" data-go-travel="plan">返回方案页</button>
            <button type="button" class="btn btn-ghost" data-dislike-type="${p.experienceType}" data-dislike-label="${p.experienceTypeLabel}">不喜欢这类</button>
          </div>
        </div>
      </section>

      ${renderHotelBlock(p)}

      <section class="detail-section">
        <div class="section-heading">
          <div>
            <h2>两日时段安排</h2>
            <p>${dep.departureTime}出发 · ${dep.arrivalEstimate} · ${dep.returnTime}</p>
          </div>
          <div class="seg-pill">
            <button type="button" class="seg-pill-btn ${appState.departureMode === "sat_morning" ? "is-active" : ""}" data-dep="sat_morning">周六早出发</button>
            <button type="button" class="seg-pill-btn ${appState.departureMode === "sat_afternoon" ? "is-active" : ""}" data-dep="sat_afternoon">周六午后出发</button>
          </div>
        </div>

        ${isDeqingShift ? `
          <div class="notice-banner is-amber" style="margin-bottom: var(--space-md);">
            <div>
              <div class="notice-title">周五天气微调：德清周六 17 时前起风降至 6–7℃</div>
              <div class="notice-desc">建议 16:00 前完成船游上岸，不在日落后湖边久留。</div>
            </div>
          </div>
        ` : ""}

        ${isDeqingLate ? `
          <div class="notice-banner is-amber" style="margin-bottom: var(--space-md);">
            <div>
              <div class="notice-title">午后出发提示：德清下渚湖船班 15:30 前入园为佳</div>
              <div class="notice-desc">${dep.trimNote || "12:30 后出发湖面停留时间不足 1.5h，建议早出发或直奔庾村白鸽广场。"}</div>
            </div>
          </div>
        ` : dep.trimNote ? `<p style="margin: 0 0 var(--space-md); font-size: var(--text-sm); color: var(--color-muted);">${dep.trimNote}</p>` : ""}

        <ol class="timeline">
          ${(dep.timeline || []).map((st) => `
            <li class="timeline-step">
              <div class="timeline-time num">${st.timeWindow}</div>
              <div>
                <div style="font-weight: 700; margin-bottom: 3px;">${st.title}</div>
                <div style="font-size: var(--text-sm); color: var(--color-ink-2);">${st.location}${st.driveOrWalkNote ? `；${st.driveOrWalkNote}` : ""}</div>
                ${st.strollerAndRestNote ? `<div style="font-size: var(--text-xs); color: var(--color-muted); margin-top: 4px;">${st.strollerAndRestNote}</div>` : ""}
              </div>
            </li>
          `).join("")}
        </ol>
      </section>

      <section class="detail-section">
        <div class="section-heading">
          <h2>突发 15 分钟应急替代</h2>
          <p>现场随时一键切换备选路线</p>
        </div>
        <div class="fallback-grid">
          ${[
            ["rain", "下雨了"],
            ["childTired", "宝宝犯困"],
            ["crowded", "人太多"],
            ["returnEarly", "提前回杭"]
          ].map(([k, title]) => {
            const node = p.degradationTree?.[k];
            const alts = (node?.nearbyAlternatives || []).map((a) => `${a.name}（${a.driveOrWalk}）`).join("、");
            return `
              <div class="fallback-cell">
                <strong>${title} · ${node?.triggerLabel || ""}</strong>
                <p style="margin: 6px 0 0; color: var(--color-ink-2);">${node?.actionSummary || ""}${alts ? ` 备选：${alts}` : ""}</p>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderLive() {
    const p = getProposal(appState.selectedProposalId);
    const dep = p.departures[appState.departureMode] || p.departures.sat_morning;
    const slots = dep.timeline || [];
    const idx = Math.min(appState.liveSlotIdx, Math.max(0, slots.length - 1));
    const cur = slots[idx] || { timeWindow: "进行中", title: p.title, location: "", driveOrWalkNote: "" };
    const next = slots[idx + 1];
    const fb = appState.liveFallbackKey ? p.degradationTree?.[appState.liveFallbackKey] : null;

    return `
      <div class="live-wrap">
        <div class="page-header">
          <div>
            <h1 class="page-title">周六现场助手</h1>
            <p class="page-sub">${COPY[p.id].shortName} · ${dep.departureTime}出发</p>
          </div>
          <button type="button" class="btn btn-secondary" data-open-detail="${p.id}">完整详情</button>
        </div>

        <div class="live-slot-bar">
          ${slots.map((s, i) => `
            <button type="button" class="live-slot-btn num ${i === idx ? "is-active" : ""}" data-live-slot="${i}">${s.timeWindow}</button>
          `).join("")}
        </div>

        <section class="live-now-card">
          <div class="live-now-kicker num">当前时段 · ${cur.timeWindow}</div>
          <h2>${cur.title}</h2>
          <p>${cur.location}${cur.driveOrWalkNote ? `；${cur.driveOrWalkNote}` : ""}</p>
          <div class="live-kv">
            <div class="live-kv-row"><span>推车休息</span><span>${cur.strollerAndRestNote || cur.slotWeather3h || "按平路节奏通行"}</span></div>
            ${p.hotel?.required ? `<div class="live-kv-row"><span>今晚住哪</span><span>金桥地铁站亚朵 1.8m 大床（周六 12:00 前可退 · 步行 820m 到 LaLaport）</span></div>` : ""}
            <div class="live-kv-row"><span>下一时段</span><span>${next ? `${next.timeWindow} · ${next.title}` : "本段结束后直接返杭"}</span></div>
          </div>
        </section>

        <section class="surface-card">
          <div class="section-heading">
            <h2>遇到状况，立即切换替代路线</h2>
          </div>
          <div class="emergency-btns">
            ${[
              ["rain", "突然下雨了"],
              ["childTired", "宝宝犯困了"],
              ["crowded", "人太多太挤"],
              ["returnEarly", "想提前回杭"]
            ].map(([k, lbl]) => `
              <button type="button" class="btn btn-secondary ${appState.liveFallbackKey === k ? "is-selected" : ""}" data-live-fb="${k}">${lbl}</button>
            `).join("")}
          </div>

          ${fb ? `
            <div class="notice-banner is-amber" style="margin-bottom: 0;">
              <div>
                <div class="notice-title">${fb.triggerLabel}</div>
                <div class="notice-desc">${fb.actionSummary}${(fb.nearbyAlternatives || []).length ? ` 就近去：${fb.nearbyAlternatives.map((a) => `${a.name}（${a.driveOrWalk}）`).join("、")}。` : ""}</div>
              </div>
            </div>
          ` : `<p style="margin: 0; font-size: var(--text-sm); color: var(--color-muted);">点任一按钮，直接显示 15 分钟内室内躲雨、休息或回杭路线。</p>`}
        </section>
      </div>
    `;
  }

  function render() {
    const main = document.getElementById("appMain");
    if (!main) return;
    if (appState.view === "home") main.innerHTML = renderHome();
    else if (appState.view === "travel") main.innerHTML = renderTravel();
    else if (appState.view === "detail") main.innerHTML = renderDetail();
    else if (appState.view === "live") main.innerHTML = renderLive();

    const activeNav = appState.view === "home" ? "home" : "travel";
    document.querySelectorAll(".nav-item[data-nav]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === activeNav);
    });
    const sel = document.getElementById("stateSelect");
    if (sel && sel.value !== appState.systemState) sel.value = appState.systemState;
    const chk = document.getElementById("toggleHomeEntry");
    if (chk && chk.checked !== appState.hideHomeEntry) chk.checked = appState.hideHomeEntry;
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a[data-nav], .map-node, [data-go-travel]");
    if (!t) return;

    if (t.id === "studioTrigger") {
      appState.studioOpen = !appState.studioOpen;
      const panel = document.getElementById("studioPanel");
      if (panel) panel.hidden = !appState.studioOpen;
      t.setAttribute("aria-expanded", String(appState.studioOpen));
      return;
    }

    if (t.dataset.protoView) {
      clearToast();
      appState.view = t.dataset.protoView;
      if (appState.view === "travel") appState.travelTab = "plan";
      appState.studioOpen = false;
      const panel = document.getElementById("studioPanel");
      if (panel) panel.hidden = true;
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (t.dataset.nav) {
      e.preventDefault();
      clearToast();
      const target = t.dataset.nav;
      if (target === "home" || target === "travel") {
        appState.view = target;
        if (target === "travel") appState.travelTab = "plan";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      } else {
        showToast("当前原型聚焦「首页」与「旅行 / 详情 / 现场」流程");
      }
      return;
    }

    if (t.dataset.action === "archive-toast") {
      showToast("原站内对应「记忆」频道可打开完整图文与声音记录");
      return;
    }

    if (t.dataset.action === "rotate-voices") {
      appState.voiceStep = (appState.voiceStep + 1) % (HOME.voicePool?.length || 1);
      render();
      return;
    }

    if (t.dataset.action === "toggle-hotels") {
      appState.showAllHotels = !appState.showAllHotels;
      render();
      return;
    }

    if (t.dataset.goTravel) {
      clearToast();
      appState.view = "travel";
      appState.travelTab = t.dataset.goTravel;
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (t.dataset.travelTab) {
      appState.travelTab = t.dataset.travelTab;
      render();
      return;
    }

    if (t.dataset.openDetail) {
      clearToast();
      appState.selectedProposalId = t.dataset.openDetail;
      appState.view = "detail";
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (t.dataset.openLive) {
      clearToast();
      appState.selectedProposalId = t.dataset.openLive;
      appState.liveSlotIdx = 0;
      appState.liveFallbackKey = null;
      appState.view = "live";
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (t.dataset.dep) {
      appState.departureMode = t.dataset.dep;
      render();
      return;
    }

    if (t.dataset.dislikeType) {
      const type = t.dataset.dislikeType;
      const label = t.dataset.dislikeLabel || type;
      if (!isExcluded(type)) {
        appState.excludedTypes.push({ experienceType: type, label, addedBy: "parent" });
        saveExcluded();
        render();
        showToast(`已避开「${label}」（可在底部随时撤销）`);
      }
      return;
    }

    if (t.dataset.undoType) {
      appState.excludedTypes = appState.excludedTypes.filter((x) => x.experienceType !== t.dataset.undoType);
      saveExcluded();
      render();
      return;
    }

    if (t.dataset.inspFilter) {
      appState.inspFilter = t.dataset.inspFilter;
      render();
      return;
    }

    if (t.dataset.inspToggle) {
      appState.openInsp[t.dataset.inspToggle] = !appState.openInsp[t.dataset.inspToggle];
      render();
      return;
    }

    if (t.dataset.sundayFb) {
      appState.sundayFeedback = appState.sundayFeedback === t.dataset.sundayFb ? null : t.dataset.sundayFb;
      render();
      showToast("已记录本周轻反馈");
      return;
    }

    if (t.dataset.stampKey) {
      appState.selectedStampKey = t.dataset.stampKey;
      render();
      return;
    }

    if (t.dataset.liveSlot !== undefined) {
      appState.liveSlotIdx = Number(t.dataset.liveSlot) || 0;
      render();
      return;
    }

    if (t.dataset.liveFb) {
      appState.liveFallbackKey = appState.liveFallbackKey === t.dataset.liveFb ? null : t.dataset.liveFb;
      render();
    }
  });

  document.getElementById("stateSelect")?.addEventListener("change", (e) => {
    appState.systemState = e.target.value;
    render();
  });

  document.getElementById("toggleHomeEntry")?.addEventListener("change", (e) => {
    appState.hideHomeEntry = !!e.target.checked;
    render();
  });

  const params = new URLSearchParams(location.search);
  const v = params.get("view");
  const st = params.get("state");
  if (v && ["home", "travel", "detail", "live"].includes(v)) appState.view = v;
  if (v === "visited") {
    appState.view = "travel";
    appState.travelTab = "visited";
  }
  if (st && ["published", "weather_shift", "unavailable", "collecting", "expired_rest"].includes(st)) {
    appState.systemState = st;
  }

  window.__setProtoV3 = function (patch) {
    clearToast();
    Object.assign(appState, patch || {});
    render();
  };

  render();
})();
