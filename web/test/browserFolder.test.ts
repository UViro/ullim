import { describe, expect, it } from 'vitest'
import { range } from '../src/dsp/range'
import { EMPTY_VOICE_SETTINGS } from '../src/model/voiceSettings'
import { EMPTY_RECORDS, encodeRecordsFile, RECORDS_FILE, SETTINGS_FILE } from '../src/storage/archive'
import { BROWSER_FOLDER_NAME, BrowserFolder, MemoryFileTable } from '../src/storage/browserFolder'
import { copyRecordings, openRecordFolder } from '../src/storage/openFolder'
import { MemoryFolder } from '../src/storage/recordFolder'
import { packRecordFolder, unpackRecordFile } from '../src/storage/recordZip'

// 이 기기의 브라우저 저장소(2026-11-15): 실제 IndexedDB 대신 같은 모양의 Map 표로 시험한다 (새 패키지 없이).
// 표를 그대로 두고 폴더를 새로 만드는 것이 ‘새로고침’이다.

const now = new Date('2026-11-15T11:00:00Z')

describe('BrowserFolder (이 기기의 브라우저 저장소)', () => {
  it('글자와 소리를 쓰고 그대로 읽는다 (소리는 형식까지)', async () => {
    const folder = new BrowserFolder(new MemoryFileTable())
    await folder.write(SETTINGS_FILE, '{"a":1}')
    await folder.write('녹음/Ullim-20261115-2000.wav', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))

    expect(await (await folder.read(SETTINGS_FILE))?.text()).toBe('{"a":1}')
    const wav = await folder.read('녹음/Ullim-20261115-2000.wav')
    expect(wav?.type).toBe('audio/wav')
    expect([...new Uint8Array(await wav!.arrayBuffer())]).toEqual([1, 2, 3])
    expect(await folder.read('없는-파일.json')).toBeNull()
    expect(folder.name).toBe(BROWSER_FOLDER_NAME)
  })

  it('폴더 안 파일 이름만 보이고, 지우면 사라진다. 다른 폴더처럼 이상한 경로는 막는다', async () => {
    const folder = new BrowserFolder(new MemoryFileTable())
    await folder.write('녹음/a.wav', new Blob([]))
    await folder.write('녹음/b.wav', new Blob([]))
    await folder.write(RECORDS_FILE, '{}')
    expect((await folder.list('녹음')).sort()).toEqual(['a.wav', 'b.wav'])
    expect(await folder.list('없는 폴더')).toEqual([])

    await folder.remove('녹음/a.wav')
    expect(await folder.list('녹음')).toEqual(['b.wav'])
    await expect(folder.write('../밖.json', '{}')).rejects.toThrow()
    await expect(folder.read('녹음/깊은/c.wav')).rejects.toThrow()
  })

  it('새로고침해도(같은 표로 폴더를 다시 열어도) 설정·기록이 남는다', async () => {
    const table = new MemoryFileTable()
    const target = range(180, 220)
    const record = { id: 'r1', recordedAt: now.toISOString(), title: '', memo: '', fileName: 'x.wav', language: 'ko' }
    const first = await openRecordFolder(
      new BrowserFolder(table),
      { ...EMPTY_VOICE_SETTINGS, target },
      new Set(['target']),
      { ...EMPTY_RECORDS, baselineHistory: [record] },
      now,
    )
    expect(first.ok).toBe(true)

    // 새로고침: 화면의 값은 비어 있고, 폴더(표)만 남아 있다
    const reopened = await openRecordFolder(new BrowserFolder(table), EMPTY_VOICE_SETTINGS, new Set(), EMPTY_RECORDS, now)
    expect(reopened.ok && reopened.settings.target).toEqual(target)
    expect(reopened.ok && reopened.records.baselineHistory).toEqual([record])
  })

  it('브라우저 저장소의 녹음은 고른 폴더로 옮길 수 있고, 기록 파일(zip)로도 묶인다', async () => {
    const browser = new BrowserFolder(new MemoryFileTable())
    await browser.write(RECORDS_FILE, encodeRecordsFile(EMPTY_RECORDS, now))
    await browser.write('녹음/a.wav', new Blob([new Uint8Array([9])], { type: 'audio/wav' }))

    const picked = new MemoryFolder()
    await copyRecordings(browser, picked)
    expect(await picked.list('녹음')).toEqual(['a.wav'])

    const unpacked = await unpackRecordFile(await packRecordFolder(browser, now))
    expect(unpacked.ok && unpacked.recordingCount).toBe(1)
  })
})
