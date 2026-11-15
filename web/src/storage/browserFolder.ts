import { splitPath, type RecordFolder } from './recordFolder'

/**
 * 이 기기의 브라우저 안 저장소(IndexedDB)에 두는 기록 폴더 (2026-11-15). 폴더를 고를 수 없는 스마트폰 브라우저
 * (아이폰 사파리 등)에서도 새로고침해도 기록이 남게 한다. 다른 폴더와 똑같이 `울림-설정.json`·`울림-기록.json`·`녹음/…`을 담는다.
 * 기록은 그 기기의 그 브라우저에만 있고, 어디로도 보내지 않는다. 브라우저의 사이트 데이터를 지우면 함께 지워진다.
 */
export const BROWSER_FOLDER_NAME = '이 기기의 브라우저'

/**
 * 파일 하나를 담는 모양. 글자는 그대로, 소리 등은 바이트(ArrayBuffer)와 형식으로 둔다
 * (Blob을 그대로 넣으면 브라우저에 따라 IndexedDB가 거부한 적이 있어서, 어디서나 되는 바이트로 둔다)
 */
export type StoredFile = { readonly text: string } | { readonly bytes: ArrayBuffer; readonly type: string }

/** 경로 → 파일. IndexedDB 한 칸이고, 테스트에서는 Map으로 바꿔 끼운다 */
export interface FileTable {
  get(path: string): Promise<StoredFile | undefined>
  put(path: string, file: StoredFile): Promise<void>
  delete(path: string): Promise<void>
  paths(): Promise<string[]>
}

export class BrowserFolder implements RecordFolder {
  readonly name = BROWSER_FOLDER_NAME

  constructor(private readonly table: FileTable = indexedDBTable()) {}

  async read(path: string): Promise<Blob | null> {
    splitPath(path)
    const file = await this.table.get(path)
    if (file === undefined) return null
    return 'text' in file ? new Blob([file.text], { type: 'application/json' }) : new Blob([file.bytes], { type: file.type })
  }

  async write(path: string, data: Blob | string): Promise<void> {
    splitPath(path)
    await this.table.put(path, typeof data === 'string' ? { text: data } : { bytes: await data.arrayBuffer(), type: data.type })
  }

  async remove(path: string): Promise<void> {
    splitPath(path)
    await this.table.delete(path)
  }

  async list(directory: string): Promise<string[]> {
    const prefix = `${directory}/`
    return (await this.table.paths()).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length))
  }
}

/** 브라우저가 이 사이트의 저장소를 함부로 지우지 않게 부탁한다 (들어줄지는 브라우저가 정한다). 들어주면 true */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if ((await navigator.storage?.persisted?.()) === true) return true
    return (await navigator.storage?.persist?.()) === true
  } catch {
    return false
  }
}

/** Map에 두는 표 (테스트용) */
export class MemoryFileTable implements FileTable {
  readonly files = new Map<string, StoredFile>()
  async get(path: string) {
    return this.files.get(path)
  }
  async put(path: string, file: StoredFile) {
    this.files.set(path, file)
  }
  async delete(path: string) {
    this.files.delete(path)
  }
  async paths() {
    return [...this.files.keys()]
  }
}

// MARK: - IndexedDB

/** 폴더 연결 정보(`handleStore.ts`의 ‘ullim’)와 따로 둔다 (한쪽을 바꿔도 다른 쪽 판을 올리지 않게) */
const DATABASE = 'ullim-records'
const STORE = 'files'

function indexedDBTable(): FileTable {
  let opening: Promise<IDBDatabase> | null = null
  const database = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => {
        const db = request.result
        // 다른 탭이 판을 올리거나 저장소를 지우려 하면 연결을 놓아 준다 (다음에 쓸 때 다시 연다)
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    }).catch((error: unknown) => {
      opening = null // 다음에 다시 열어 본다
      throw error
    }))

  async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await database()
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = action(transaction.objectStore(STORE))
      // 쓰기는 거래가 끝까지 디스크에 들어간 뒤에 끝난 것으로 본다
      transaction.oncomplete = () => resolve(request.result as T)
      transaction.onerror = () => reject(transaction.error ?? request.error)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
  }

  return {
    get: (path) => run<StoredFile | undefined>('readonly', (store) => store.get(path)),
    put: async (path, file) => {
      await run('readwrite', (store) => store.put(file, path))
    },
    delete: async (path) => {
      await run('readwrite', (store) => store.delete(path))
    },
    paths: async () => (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())).map(String),
  }
}
