// =============================================================================
// S0 はじめに（導入）
// キャッチコピー・説明文 → 胸部 3D モデル（ヒーロー） → 4 ステップ → 背景 → 特長 → 構成図
// =============================================================================
import '../styles/screens/intro.css';
import { h, researchBadge } from '../ui/dom.js';
import { state, subscribe, navigate } from '../app/state.js';
import { LOGO_SVG } from '../ui/brand.js';
import { FOUR_STEPS, STEP_HEADLINE, visibleValues, iconSVG, valueCard } from './intro/content.js';
import { createHeroVisual } from './intro/heroVisual.js';
import { createDiagram } from './intro/diagram.js';

const CYCLE_MS = 3200;

function startTour() {
  const headerBtn = document.querySelector('.app-header .btn-accent');
  if (headerBtn) headerBtn.click();
  else window.__zeus?.startTour?.();
}

export default {
  id: 'intro',
  title: 'はじめに',
  frame: 'page',

  mount(root, ctx) {
    const { signal } = ctx;
    const cleanups = [];
    let touring = false;

    // ---------------------------------------------------------------- ヒーロー
    const tourBtn = h('button', { class: 'btn btn-ghost btn-lg intro-tour-btn', onclick: startTour },
      h('span', { class: 'intro-play', 'aria-hidden': 'true' }), 'ガイドツアーを見る');
    const startBtn = h('button', { class: 'btn btn-accent btn-lg intro-start-btn', onclick: () => navigate('home') },
      'デモを始める', h('span', { 'aria-hidden': 'true', class: 'intro-arrow' }, '→'));

    const copy = h('div', { class: 'intro-hero-copy' },
      h('div', { class: 'intro-eyebrow' },
        h('span', { class: 'intro-eyebrow-logo', html: LOGO_SVG }),
        h('span', {}, 'Thoracentes Zeus β（研究開発中）')),
      h('h1', { class: 'intro-title' },
        h('span', { class: 'intro-title-line' }, '見えないものを、'),
        h('span', { class: 'intro-title-line' }, h('em', {}, '見える化'), 'する。')),
      h('p', { class: 'intro-lead' },
        '胸部CTから臓器の3Dモデルをつくり、ARグラスで患者の体表に重ねて表示する複合現実システム（研究開発中）です。'),
      h('div', { class: 'intro-cta' }, startBtn, tourBtn),
      h('p', { class: 'intro-note' },
        h('span', { class: 'intro-note-dot', 'aria-hidden': 'true' }),
        'このデモは合成ファントム（架空のデータ）を使った説明用のシミュレーションです。'));

    const stageCaption = h('span', { class: 'hero3d-caption-text' }, '胸部CTから3Dモデルを構成しています…');
    const stageNum = h('span', { class: 'hero3d-caption-num' }, '3D');
    const canvasHost = h('div', { class: 'hero3d-canvas' });
    const loading = h('div', { class: 'hero3d-loading' }, h('span', { class: 'spinner' }), '3Dモデルを準備中…');
    const legend = [
      ['体表', '#4aa8ff'], ['肺', '#7fd3ff'], ['心臓', '#e0566b'], ['血管', '#ef3b3b'], ['骨', '#efe8d8'],
    ];
    const visual = h('div', { class: 'hero3d' },
      h('div', { class: 'hero3d-grid', 'aria-hidden': 'true' }),
      canvasHost,
      h('span', { class: 'hero3d-corner tl' }), h('span', { class: 'hero3d-corner tr' }),
      h('span', { class: 'hero3d-corner bl' }), h('span', { class: 'hero3d-corner br' }),
      h('div', { class: 'hero3d-hud-top' },
        h('div', { class: 'hero3d-tag' }, h('span', { class: 'hero3d-live' }), '3Dモデル（合成ファントム・架空のデータ）'),
        h('div', { class: 'hero3d-legend' }, legend.map(([n, c]) => h('span', {}, h('i', { style: { background: c } }), n)))),
      h('div', { class: 'hero3d-caption' }, stageNum, stageCaption),
      h('div', { class: 'hero3d-hint' }, 'ドラッグで回転'),
      loading);
    visual.setAttribute('role', 'img');
    visual.setAttribute('aria-label', '合成ファントムから作った胸部の3Dモデル。体表・肺・心臓・血管・骨と3点のマーカを表示しています。');

    const hero = h('section', { class: 'intro-hero' }, copy, visual);

    // ---------------------------------------------------------------- 4 ステップ
    const stepEls = FOUR_STEPS.map((s, i) => h('div', { class: 'intro-step', tabindex: '0', dataset: { i: String(i) } },
      h('div', { class: 'intro-step-icon', html: iconSVG(s.icon, { size: 40 }) }),
      h('div', { class: 'intro-step-body' },
        h('div', { class: 'intro-step-num' }, `STEP ${i + 1}`),
        h('div', { class: 'intro-step-title' }, s.title),
        h('p', { class: 'intro-step-desc' }, s.desc)),
      h('span', { class: 'intro-step-bar', 'aria-hidden': 'true' })));
    const arrows = [0, 1, 2].map(() => h('div', { class: 'intro-step-arrow', 'aria-hidden': 'true',
      html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>' }));
    const stepRow = h('div', { class: 'intro-steps-row' });
    stepEls.forEach((el, i) => { stepRow.appendChild(el); if (arrows[i]) stepRow.appendChild(arrows[i]); });
    const steps = h('section', { class: 'intro-steps', 'aria-label': '4つのステップ' },
      h('div', { class: 'intro-steps-head' },
        h('span', { class: 'intro-kicker' }, '4 STEPS'),
        h('span', { class: 'intro-steps-headline' }, STEP_HEADLINE)),
      stepRow);

    // ---------------------------------------------------------------- 背景
    const background = h('section', { class: 'intro-section intro-bg' },
      sectionHead('背景', '胸腔の手技前に、位置関係を確かめたい'),
      h('div', { class: 'intro-bg-grid' },
        h('div', { class: 'intro-bg-card' },
          h('span', { class: 'intro-bg-icon', html: iconSVG('lungs', { size: 34 }) }),
          h('p', {}, '胸腔には重要な臓器が密集しています。肺は空気を含むため、超音波では描出が難しい領域があります。')),
        h('div', { class: 'intro-bg-card' },
          h('span', { class: 'intro-bg-icon is-warn', html: iconSVG('alert', { size: 34 }) }),
          h('p', {}, '胸腔穿刺・ドレナージでは、重篤な合併症の事例が公的機関の医療安全情報などで報告されています。')),
        h('div', { class: 'intro-bg-card is-approach' },
          h('span', { class: 'intro-bg-icon is-blue', html: iconSVG('eye', { size: 34 }) }),
          h('div', {},
            h('div', { class: 'intro-bg-approach' }, 'Zeus β のアプローチ'),
            h('p', {}, 'CT画像から作った3Dモデルを患者の体表に重ねて表示し、手技の前に位置関係を確認することを支援します。'),
            h('p', { class: 'intro-bg-foot' }, '基本機能は、手技の前に位置を確認するための使い方を想定しています。')))));

    // ---------------------------------------------------------------- 特長
    const valuesGrid = h('div', { class: 'intro-values' });
    const renderValues = () => valuesGrid.replaceChildren(...visibleValues(state.researchMode).map(valueCard));
    renderValues();
    const values = h('section', { class: 'intro-section' },
      sectionHead('特長', '時間はいずれも目安です。研究開発中の機能には', researchBadge(), 'を付けています。'),
      valuesGrid);

    // ---------------------------------------------------------------- 構成図
    const diagram = createDiagram();
    const system = h('section', { class: 'intro-section' },
      sectionHead('システム構成', 'CT・PACS → PCアプリ「Zeus」 → ARグラス・タブレット'),
      diagram.el);

    // ---------------------------------------------------------------- 最後の CTA
    const tourBtn2 = h('button', { class: 'btn btn-ghost btn-lg', onclick: startTour }, h('span', { class: 'intro-play', 'aria-hidden': 'true' }), 'ガイドツアーを見る');
    const finalCta = h('section', { class: 'intro-final' },
      h('div', {},
        h('div', { class: 'intro-final-title' }, 'PCアプリ「Zeus」の操作から、ARグラスでの表示まで。'),
        h('p', { class: 'muted' }, 'デモでは、データ取込 → 3D構成 → マーカ確認 → 関心領域 → 端末への転送 → AR表示 の順に操作できます。')),
      h('div', { class: 'intro-final-actions' },
        h('button', { class: 'btn btn-accent btn-lg', onclick: () => navigate('home') }, 'デモを始める', h('span', { class: 'intro-arrow', 'aria-hidden': 'true' }, '→')),
        tourBtn2));

    const page = h('div', { class: 'intro' }, hero, steps, background, values, system, finalCta);
    root.appendChild(page);

    // ---------------------------------------------------------------- 3D
    let heroVis = null;
    try {
      heroVis = createHeroVisual(canvasHost, { signal, onReady: () => { loading.classList.add('is-hidden'); visual.classList.add('is-ready'); } });
    } catch (e) {
      console.error(e);
      loading.textContent = '3D表示を利用できません（WebGL）';
    }

    // ---------------------------------------------------------------- ステップの点灯（自動）
    let active = -1;
    let phase = 0;
    let hoverPause = false;
    function setActive(i) {
      active = i;
      stepEls.forEach((el, k) => {
        el.classList.toggle('is-active', k === i);
        el.classList.toggle('is-past', i > k);
      });
      arrows.forEach((a, k) => a.classList.toggle('is-lit', i > k));
      steps.classList.toggle('is-complete', i >= 4);
      heroVis?.setStage(i);
      if (i >= 0 && i < 4) {
        stageNum.textContent = String(i + 1);
        stageCaption.textContent = FOUR_STEPS[i].stage;
      } else if (i >= 4) {
        stageNum.textContent = '✓';
        stageCaption.textContent = 'CTの情報を、患者の体表に重ねて見える化';
      }
      visual.dataset.stage = String(i);
    }
    const tick = () => {
      if (hoverPause || touring) return;
      phase = (phase + 1) % 5;
      setActive(phase);
    };
    // 3D の組み上げ（約2秒）が終わってから点灯を始める
    let cycleTimer = 0;
    const firstTimer = setTimeout(() => {
      if (touring) return;
      if (!hoverPause) { phase = 0; setActive(0); }
      cycleTimer = setInterval(tick, CYCLE_MS);
    }, 2600);
    cleanups.push(() => { clearTimeout(firstTimer); clearInterval(cycleTimer); });

    stepEls.forEach((el, i) => {
      const enter = () => { if (touring) return; hoverPause = true; phase = i; setActive(i); };
      const leave = () => { hoverPause = false; };
      el.addEventListener('mouseenter', enter, { signal });
      el.addEventListener('focus', enter, { signal });
      el.addEventListener('mouseleave', leave, { signal });
      el.addEventListener('blur', leave, { signal });
    });

    // ツアー中は「ガイドツアーを見る」を無効化
    const syncTourBtn = () => {
      for (const b of [tourBtn, tourBtn2]) {
        b.disabled = !!state.tourActive;
        b.title = state.tourActive ? 'ガイドツアーを再生中です' : 'デモの流れを自動で再生します';
      }
    };
    syncTourBtn();
    cleanups.push(subscribe((s, patch) => {
      if ('tourActive' in patch) syncTourBtn();
      if ('researchMode' in patch) renderValues();
    }));

    const scroller = root.closest('.screen-host') || document.scrollingElement;
    const scrollToEl = (el, block = 'center') => {
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block });
    };

    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      for (const fn of cleanups) fn();
      diagram.destroy();
      heroVis?.dispose();
      heroVis = null;
    };
    signal.addEventListener('abort', destroy, { once: true });

    return {
      destroy,

      /** ガイドツアー（約15秒） */
      async tour(t) {
        touring = true;
        clearTimeout(firstTimer);
        clearInterval(cycleTimer);
        try {
          await runTour(t);
        } finally {
          // 途中で停止されたときは自動の点灯に戻す
          touring = false;
          if (!destroyed) {
            diagram.light(-1);
            phase = Math.max(0, Math.min(active, 4));
            clearInterval(cycleTimer);
            cycleTimer = setInterval(tick, CYCLE_MS);
          }
        }
      },
    };

    async function runTour(t) {
      if (scroller) scroller.scrollTop = 0;
      setActive(-1);
      t.caption('Thoracentes Zeus β は、胸部CTから臓器の3Dモデルをつくり、ARグラスで患者の体表に重ねて表示します（研究開発中）。');
      await t.pointAt(visual, 600);
      await t.sleep(2050);
      const caps = [
        '① CTを撮る：体表に3点のマーカを貼って、胸部CTを撮影します。',
        '② マーカを確認する：3Dモデル上で、自動認識された3点を確認します。',
        '③ 範囲をなぞる：CT画像の上で、関心領域をなぞって指定します。',
        '④ そして見る：ARグラスへ転送し、患者の体表に重ねて表示します。',
      ];
      for (let i = 0; i < 4; i++) {
        t.check();
        setActive(i);
        t.caption(caps[i]);
        await t.pointAt(stepEls[i], 400);
        await t.highlight(stepEls[i], 1550);
      }
      setActive(4);
      t.caption('データは CT・PACS から PCアプリ「Zeus」へ。ワンクリックでARグラスなどへ転送します。');
      scrollToEl(diagram.el);
      await t.sleep(750);
      for (let k = 0; k < 3; k++) {
        t.check();
        diagram.light(k);
        await t.pointAt(diagram.nodeEl(k), 380);
        await t.sleep(420);
      }
      await t.highlight(diagram.el, 900);
      diagram.light(-1);
    }
  },
};

function sectionHead(title, ...sub) {
  return h('div', { class: 'intro-section-head' },
    h('h2', {}, title),
    sub.length ? h('p', { class: 'intro-section-sub' }, ...sub) : null);
}
