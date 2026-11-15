<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { analyzePhraseEndings } from '../dsp/phraseEnding'
  import { graphHeight } from '../graph/pitchGraph'
  import { PRACTICE_LANGUAGES, type PracticeLanguage } from '../model/records'
  import { settings } from '../model/settings.svelte'
  import { session } from '../practice/session.svelte'
  import { takeSummary } from '../practice/take'
  import BaselineSheet from './BaselineSheet.svelte'
  import LivePanel from './LivePanel.svelte'
  import { navigation } from './navigation.svelte'
  import SentenceCards from './SentenceCards.svelte'
  import StorageNotice from './StorageNotice.svelte'
  import SummaryCard from './SummaryCard.svelte'
  import TargetRangeControls from './TargetRangeControls.svelte'

  /**
   * [높이] 화면 (iOS `ContentView.practiceScreen`): 높이 숫자와 그래프는 위에 고정하고,
   * 그 아래(목표 범위·요약 카드·문장·대본)만 스크롤한다. 녹음·듣기 버튼은 [모음] 화면과 함께 쓰는 `PracticeControls`에 있다.
   */
  let available = $state(600)

  /** 대본을 읽는 중이면 그래프를 줄여(읽기 모드) 대본 자리를 넓힌다 */
  const compact = $derived(settings.sentenceSource === 'scripts')
  const height = $derived(graphHeight(available, compact))
  const phase = $derived(session.phase)
  /**
   * 마지막 녹음의 요약. 녹음하는 동안에도 ‘지난 녹음’으로 흐리게 남겨 둔다 (2026-11-15):
   * 숨기면 녹음을 시작하고 끝낼 때마다 아래 문장 카드·대본이 카드 높이만큼 위아래로 튀었다
   */
  const summary = $derived(session.lastTake === null ? null : takeSummary(session.lastTake, settings.target))
  /** 마지막 녹음의 구절별 문장 끝 분석 (요약과 같은 목표 범위로). 요약 카드가 보일 때만 계산한다 */
  const phraseEndings = $derived(
    session.lastTake === null || summary === null ? null : analyzePhraseEndings(session.lastTake.readings, settings.target),
  )

  const caption = $derived.by(() => {
    if (session.busy === 'starting') return '마이크를 켜는 중…'
    switch (phase.kind) {
      case 'recording':
        return '현재 목소리 높이'
      case 'listening':
      case 'replaying':
        return '녹음을 다시 듣는 중'
      case 'countdown':
        return '곧 다시 녹음해요'
      case 'measuring':
        return session.measuringVowel !== null ? `‘${session.measuringVowel}’ 길게 내는 중` : '내 목소리 재는 중'
      case 'idle':
        return session.lastTake !== null ? '마지막 녹음' : '‘반복 루프 재생’을 누르면 녹음과 분석을 시작해요'
    }
  })

  let scrollBox: HTMLDivElement
  let summaryBox: HTMLDivElement | null = $state(null)
  /** 마지막으로 올려 보인 녹음 (같은 녹음으로 두 번 올리지 않게) */
  let revealedTakeId: number | null = null
  /** 바로 앞 단계 (다 듣고 다음 녹음으로 넘어가는 때를 알려고) */
  let previousPhase: string = session.phase.kind

  // 녹음이 끝나 새 요약이 생기면(지금 들어보기·정지·파일 불러오기) 아래 화면을 올려 요약 카드를 보인다 (2026-11-15 사용자 요청)
  $effect(() => {
    const id = session.lastTake?.id ?? null
    if (id === null || id === revealedTakeId) return
    revealedTakeId = id
    void tick().then(() => untrack(revealSummary))
  })

  // 다 듣고(또는 건너뛰고) 다음 녹음으로 넘어가면 문장·대본 카드로 내려가 바로 이어 읽게 한다 (2026-11-15 사용자 요청)
  $effect(() => {
    const kind = phase.kind
    const from = previousPhase
    previousPhase = kind
    if (from === 'listening' && (kind === 'countdown' || kind === 'recording')) {
      void tick().then(() => untrack(() => scrollToTop(scrollBox.querySelector<HTMLElement>('[data-reading]'))))
    }
  })

  function revealSummary() {
    scrollToTop(summaryBox)
  }

  /** 아래 영역을 올리거나 내려 `element`의 위쪽이 영역 맨 위(8px 아래)에 오게 한다 */
  function scrollToTop(element: HTMLElement | null) {
    // 다른 탭에 가려져 있으면(높이가 없으면) 그대로 둔다
    if (element === null || scrollBox.offsetParent === null) return
    const top = scrollBox.scrollTop + element.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top - 8
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    scrollBox.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  onMount(() => {
    // 처음 열 때 한 번: 기준 목소리를 아직 안 쟀으면 재기 화면을 띄운다 ("나중에"로 건너뛸 수 있음).
    if (settings.baseline === null && !settings.baselinePromptShown) {
      settings.markBaselinePromptShown()
      navigation.baselineSheetOpen = true
    }
  })
</script>

<div class="screen">
  <div class="main" bind:clientHeight={available}>
    <div class="top">
      <LivePanel {compact} {height} {caption} />
    </div>

    <div class="scroll" bind:this={scrollBox}>
      <StorageNotice />
      <TargetRangeControls canMeasure={!session.isRunning} onMeasure={() => (navigation.baselineSheetOpen = true)} />
      {#if session.lastTake !== null && summary !== null && phraseEndings !== null}
        <div bind:this={summaryBox}>
          <SummaryCard take={session.lastTake} {summary} {phraseEndings} recording={phase.kind === 'recording'} />
        </div>
      {/if}
      <SentenceCards isPracticing={session.isRunning} />
      <!-- 말하는 언어는 문장 아래에 둔다. 기록에 함께 남아 나중에 언어별로 높이를 비교한다. 연습 중에는 바꾸지 않는다 -->
      <label class="language">
        <span>🌐 말하는 언어</span>
        <select
          value={settings.practiceLanguage}
          onchange={(event) => settings.setPracticeLanguage((event.currentTarget as HTMLSelectElement).value as PracticeLanguage)}
          disabled={session.isRunning}
        >
          {#each PRACTICE_LANGUAGES as language (language.id)}
            <option value={language.id}>{language.label}</option>
          {/each}
        </select>
      </label>
      <div class="guide">
        <p>
          음량은 이 기기 마이크가 받은 소리 크기(dBFS, 0이 마이크가 받을 수 있는 최대)예요. 마이크마다 값이 달라서 귀로 듣는
          절대 데시벨(dB SPL)이 아니에요.
        </p>
        <p>
          공명 밝기는 최근 2.5초 목소리의 둘째 포먼트(F2) 중앙값이에요. 가운데 보라 선은 내 목소리 재기 때의 값이에요. 문장 속
          공명은 어떤 모음을 말했는지에 따라 달라져요. 같은 대본을 읽을 때 비교하면 정확해요. 점이 비어 있으면 목소리가 높아 값이
          불확실할 수 있어요.
        </p>
        <p>소리는 이 기기 안에서만 분석하고 어디로도 보내지 않아요. 울림은 의료 기기가 아니에요.</p>
      </div>
    </div>
  </div>
</div>

<BaselineSheet open={navigation.baselineSheetOpen} onClose={() => (navigation.baselineSheetOpen = false)} />

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .top {
    flex: none;
    padding: max(8px, env(safe-area-inset-top)) 16px 10px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border-top: 1px solid var(--divider);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .language {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
    font-size: 0.9rem;
  }
  .language select {
    font: inherit;
    color: var(--target);
    background: var(--fill);
    border: none;
    border-radius: 8px;
    padding: 6px 10px;
  }
  .guide {
    color: var(--secondary);
    font-size: 0.75rem;
  }
  .guide p {
    margin: 0 0 4px;
  }
</style>
