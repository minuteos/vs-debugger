import { getLog } from '@my/services/log'
import { getStorage, StorageScope } from '@my/services/storage'
import { hourMs } from '@my/util/date'
import { parseStringPromise } from 'xml2js'

import { Svd, SvdAddressBlock, SvdField, SvdPeripheral, SvdRegister, SvdRegisterProperties } from './svd'

const log = getLog('SVD-Cache')
const svdStorage = getStorage('svd', StorageScope.Global)

const indexCache = 4 * hourMs

const INDEX_CACHE_VERSION = 1
const SVD_CACHE_VERSION = 1

// TODO: configurable
const svdRepo = {
  owner: 'cmsis-svd',
  repo: 'cmsis-svd-data',
  branch: 'main',
}

const OctokitPromise = import('@octokit/rest')
const octokitPromise = OctokitPromise.then(p => new p.Octokit())

interface Index {
  version: number
  items: {
    dir?: string
    name: string
    size: number
    sha: string
    url: string
  }[]
}

type MaybeArray<T> = T | T[]

interface SvdDerivedFrom {
  $?: { derivedFrom?: string }
}

interface SvdInput extends Omit<Svd, 'peripherals'>, Partial<SvdRegisterProperties> {
  peripherals: { peripheral: MaybeArray<SvdInputPeripheral> }
}

interface SvdInputPeripheral extends Omit<SvdPeripheral, 'registers' | 'addressBlocks'>, Partial<SvdRegisterProperties>, SvdDerivedFrom {
  registers?: { register: MaybeArray<SvdInputRegister> }
  addressBlock?: MaybeArray<SvdAddressBlock>
}

interface SvdInputRegister extends Omit<SvdRegister, 'fields'>, SvdDerivedFrom {
  fields?: { field: MaybeArray<SvdField> }
}

async function getSvdIndex(): Promise<Index> {
  const cache = await svdStorage.getBlob('index.json')
  if (cache && (cache.timestamp - Date.now()) < indexCache) {
    log.debug('Using SVD index cache from', new Date(cache.timestamp))
    const index = JSON.parse(Buffer.from(cache.content).toString('utf8')) as Index
    if (index.version !== INDEX_CACHE_VERSION) {
      log.warn('Dropping index cache due to version mismatch')
    } else {
      return index
    }
  }

  log.debug('Loading SVD index from', svdRepo)
  const octokit = await octokitPromise
  const branch = await octokit.repos.getBranch({ ...svdRepo })
  const tree = (await octokit.git.getTree({
    ...svdRepo, tree_sha: branch.data.commit.sha, recursive: '1',
  })).data
  log.debug('Transforming SVD index')
  const index: Index = {
    version: INDEX_CACHE_VERSION,
    items: [],
  }
  for (const item of tree.tree) {
    const { type, sha, path, size, url } = item
    if (type === 'blob' && sha && path?.endsWith('.svd') && size && url) {
      const lastSlash = path.lastIndexOf('/')
      const dir = lastSlash < 0 ? undefined : path.slice(0, lastSlash)
      const name = path.slice(lastSlash + 1, -4)
      index.items.push({ sha, dir, name, size, url })
    }
  }
  log.debug('Caching SVD index')
  await svdStorage.setBlob('index.json', Buffer.from(JSON.stringify(index)))
  return index
}

async function getSvdFromSha({ sha, url }: { sha: string, url: string }): Promise<Svd> {
  const cacheName = `${sha}.json`
  const cache = await svdStorage.getBlob(cacheName)
  if (cache) {
    log.debug('Using cached SVD', sha)
    const svd = JSON.parse(Buffer.from(cache.content).toString('utf8')) as Svd
    if (svd.cacheVersion !== SVD_CACHE_VERSION) {
      log.warn('Dropping SVD cache due to version mismatch')
    } else {
      return svd
    }
  }

  log.debug('Loading SVD from', url)
  const octokit = await octokitPromise
  const resp = await octokit.request({ url, headers: { accept: 'application/vnd.github.raw+json' } })
  if (typeof resp.data !== 'string') {
    throw new Error('SVD not text')
  }

  const svd = await svdFromXml(resp.data)

  log.debug('Caching SVD', sha)
  await svdStorage.setBlob(cacheName, Buffer.from(JSON.stringify(svd)))
  return svd
}

async function svdFromXml(xml: string): Promise<Svd> {
  const source = await parseStringPromise(xml, {
    trim: true,
    normalize: true,
    explicitRoot: false,
    explicitArray: false,
    valueProcessors: [
      (value) => {
        const num = Number(value)
        if (!isNaN(num)) {
          return num
        }
        const int = parseInt(value)
        if (!isNaN(int)) {
          return int
        }
        switch (value) {
          case 'true': return true
          case 'false': return false
          default: return value
        }
      },
    ],
  }) as SvdInput

  function extractSharedProps<T extends Partial<SvdRegisterProperties>>(p: T, merge?: Partial<SvdRegisterProperties>): [Partial<SvdRegisterProperties>, Omit<T, keyof SvdRegisterProperties>] {
    const {
      size = merge?.size,
      access = merge?.access,
      protection = merge?.protection,
      resetMask = merge?.resetMask,
      resetValue = merge?.resetValue,
      ...rest
    } = p
    return [{ size, access, protection, resetMask, resetValue }, rest]
  }

  const [sShared, sRest] = extractSharedProps(source)
  const sourcePeripherals = [source.peripherals.peripheral].flat()
  const sourcePeripheralsMap = Object.fromEntries(sourcePeripherals.map(p => [p.name, p]))

  function parsePeripheral(p: SvdInputPeripheral): SvdPeripheral {
    const [pShared, pRest] = extractSharedProps(p, sShared)
    const { registers: pRegisters, addressBlock, ...pRestWithoutRegisters } = pRest

    const base = p.$?.derivedFrom ? sourcePeripheralsMap[p.$.derivedFrom] : undefined
    const res = {
      registers: [],
      addressBlocks: [],
      ...(base ? parsePeripheral(base) : {}),
      ...pRestWithoutRegisters,
    }

    if (pRegisters) {
      // patch the register array
      const newRegs = [pRegisters.register].flat().map((r) => {
        return {
          ...pShared,
          ...r,
          fields: r.fields ? [r.fields.field].flat() : undefined,
        }
      })
      const newNames = new Set(newRegs.map(r => r.name))
      res.registers = [
        ...res.registers.filter(r => !newNames.has(r.name)),
        ...newRegs,
      ]
    }

    if (addressBlock) {
      // if defined, override anything from base
      res.addressBlocks = [addressBlock].flat()
    }

    return res
  }

  const peripherals: SvdPeripheral[] = sourcePeripherals.map(parsePeripheral)

  return {
    ...sRest,
    cacheVersion: SVD_CACHE_VERSION,
    peripherals,
  }
}

function match(s1: string, s2: string) {
  let i = 0
  for (; i < s1.length && i < s2.length; i++) {
    if (s1[i] === s2[i]) {
      // exact match
      continue
    }

    if (s1[i] === 'x' || s2[i] === 'x') {
      // one of the sides has a wildcard, try continue from anywhere in the other one
      let w = s1.substring(i + 1), o = s2.substring(i + 1)
      if (s2[i] === 'x') {
        // w = wild, o = other
        [w, o] = [o, w]
      }

      for (;;) {
        if (match(w, o)) {
          return true
        }
        if (!o.length) {
          return false
        }
        o = o.substring(1)
      }
    }

    if (s1[i].toLowerCase() !== s2[i].toLowerCase()) {
      // CI match
      return false
    }
  }

  return i === s1.length && i === s2.length
}

export async function getSvd(model: string): Promise<Svd | undefined> {
  const index = await getSvdIndex()

  const candidates = index.items.filter(c => match(c.name, model))

  if (!candidates.length) {
    return undefined
  }

  // take the largest SVD that matches 🤷‍♂️
  candidates.sort((c1, c2) => c2.size - c1.size)

  return await getSvdFromSha(candidates[0])
}
