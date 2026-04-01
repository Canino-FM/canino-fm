/**
 * Parse WordPress MySQL dump for wp_posts and wp_postmeta.
 * Handles table prefix (e.g. wp_ or jocczzlm_).
 * Returns { posts: [], meta: [], options: [] }.
 */

const defaultPrefix = 'wp_'

/**
 * mysqldump often splits INSERTs: header line ends with VALUES, rows follow until `);`
 * Join those into one string per statement so parseInsertValues can run.
 */
function collectInsertStatements(lines, tableName) {
  const quoted = `\`${tableName}\``
  const out = []
  let buffer = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (buffer !== null) {
      buffer += '\n' + line
      if (trimmed.endsWith(';')) {
        out.push(buffer)
        buffer = null
      }
      continue
    }
    if (trimmed.toUpperCase().startsWith('INSERT INTO') && line.includes(quoted)) {
      buffer = line
      if (trimmed.endsWith(';')) {
        out.push(buffer)
        buffer = null
      }
    }
  }
  return out
}

/**
 * Parse INSERT statement values: (1,'a',2,'b\'c'),(3,'d')
 * Returns array of rows, each row is array of cell values.
 * mysqldump uses VALUES then newline then `(row1),(row2),...` — do not strip the
 * opening `(` of the first row (a VALUES\\s*\\((.*)\\) regex would break that).
 */
function parseInsertValues(line, tableName) {
  const valuesHead = line.match(/\bVALUES\b\s*/i)
  if (!valuesHead) return []
  let rest = line.slice(valuesHead.index + valuesHead[0].length).trimStart()
  rest = rest.replace(/\s*;\s*$/, '')
  const rows = []
  let depth = 0
  let current = ''
  let row = []
  let inString = false
  let escape = false
  let i = 0
  while (i < rest.length) {
    const c = rest[i]
    if (escape) {
      const esc =
        c === 'n'
          ? '\n'
          : c === 'r'
            ? '\r'
            : c === 't'
              ? '\t'
              : c === 'b'
                ? '\b'
                : c === '0'
                  ? '\0'
                  : c === 'Z' || c === 'z'
                    ? '\x1a'
                    : c
      current += esc
      escape = false
      i++
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      i++
      continue
    }
    if (inString) {
      if (c === "'") {
        inString = false
        row.push(current)
        current = ''
      } else {
        current += c
      }
      i++
      continue
    }
    if (c === "'") {
      inString = true
      i++
      continue
    }
    if (c === '(') {
      depth++
      if (depth === 1) row = []
      i++
      continue
    }
    if (c === ')') {
      depth--
      if (depth === 0) {
        if (current.trim() !== '') row.push(current.trim())
        rows.push(row)
        row = []
      }
      i++
      continue
    }
    if (c === ',' && depth === 1) {
      if (current.trim() !== '') row.push(current.trim())
      current = ''
      i++
      continue
    }
    if (depth >= 1 && c !== ' ' && c !== '\n') current += c
    i++
  }
  if (current.trim() !== '' && row.length >= 0) row.push(current.trim())
  if (row.length) rows.push(row)
  return rows
}

/**
 * Get column names from INSERT INTO `table` (col1,col2) VALUES ...
 */
function getInsertColumns(line) {
  const match = line.match(/INSERT\s+INTO\s+`?\w+`?\s*\(([^)]+)\)\s*VALUES/i)
  if (!match) return null
  return match[1].split(',').map((c) => c.replace(/`/g, '').trim())
}

function parsePostsTable(statements, prefix) {
  const tableName = `${prefix}posts`
  const posts = []
  for (const line of statements) {
    if (!line.includes(`\`${tableName}\``) && !line.includes(`'${tableName}'`)) continue
    if (!line.toUpperCase().includes('INSERT INTO')) continue
    const columns = getInsertColumns(line)
    const rows = parseInsertValues(line, tableName)
    const colMap = columns
      ? Object.fromEntries(columns.map((c, i) => [c, i]))
      : {
          ID: 0,
          post_title: 1,
          post_type: 2,
          post_status: 3,
          menu_order: 4,
          guid: 5,
        }
    for (const row of rows) {
      const id = row[colMap.ID ?? 0]
      const type = (row[colMap.post_type ?? 2] || '').toLowerCase()
      const status = (row[colMap.post_status ?? 3] || '').toLowerCase()
      posts.push({
        ID: parseInt(id, 10),
        post_title: row[colMap.post_title ?? 1] ?? '',
        post_type: type,
        post_status: status,
        menu_order: parseInt(row[colMap.menu_order ?? 4], 10) || 0,
        guid: row[colMap.guid ?? 5] ?? '',
      })
    }
  }
  return posts
}

function parsePostmetaTable(statements, prefix) {
  const tableName = `${prefix}postmeta`
  const meta = []
  for (const line of statements) {
    if (!line.includes(`\`${tableName}\``) && !line.includes(`'${tableName}'`)) continue
    if (!line.toUpperCase().includes('INSERT INTO')) continue
    const columns = getInsertColumns(line)
    const rows = parseInsertValues(line, tableName)
    const colMap = columns
      ? Object.fromEntries(columns.map((c, i) => [c, i]))
      : { meta_id: 0, post_id: 1, meta_key: 2, meta_value: 3 }
    for (const row of rows) {
      meta.push({
        post_id: parseInt(row[colMap.post_id ?? 1], 10),
        meta_key: row[colMap.meta_key ?? 2] ?? '',
        meta_value: row[colMap.meta_value ?? 3] ?? '',
      })
    }
  }
  return meta
}

function parseOptionsTable(statements, prefix) {
  const tableName = `${prefix}options`
  const options = []
  for (const line of statements) {
    if (!line.includes(`\`${tableName}\``) && !line.includes(`'${tableName}'`)) continue
    if (!line.toUpperCase().includes('INSERT INTO')) continue
    const columns = getInsertColumns(line)
    const rows = parseInsertValues(line, tableName)
    const colMap = columns
      ? Object.fromEntries(columns.map((c, i) => [c, i]))
      : { option_id: 0, option_name: 1, option_value: 2 }
    for (const row of rows) {
      options.push({
        option_name: row[colMap.option_name ?? 1] ?? '',
        option_value: row[colMap.option_value ?? 2] ?? '',
      })
    }
  }
  return options
}

/**
 * Parse PHP serialized string for ACF relationship (array of IDs).
 * e.g. a:2:{i:0;s:3:"123";i:1;s:3:"456";} -> [123, 456]
 * mysqldump escapes " as \\" inside SQL string literals; normalize before matching.
 */
function parsePhpSerializedIds(value) {
  if (!value || typeof value !== 'string') return []
  value = value.replace(/\\"/g, '"')
  const ids = []
  const regex = /s:\d+:"(\d+)"/g
  let m
  while ((m = regex.exec(value)) !== null) ids.push(parseInt(m[1], 10))
  if (ids.length) return ids
  const single = /^(\d+)$/.exec(value.trim())
  return single ? [parseInt(single[1], 10)] : []
}

export function parseWpDump(sqlContent, tablePrefix = defaultPrefix) {
  const lines = sqlContent.split(/\n/)
  const posts = parsePostsTable(collectInsertStatements(lines, `${tablePrefix}posts`), tablePrefix)
  const meta = parsePostmetaTable(collectInsertStatements(lines, `${tablePrefix}postmeta`), tablePrefix)
  const options = parseOptionsTable(collectInsertStatements(lines, `${tablePrefix}options`), tablePrefix)
  return { posts, meta, options }
}

export function getMetaByPostId(meta, postId) {
  const out = {}
  for (const m of meta) {
    if (m.post_id !== postId) continue
    out[m.meta_key] = m.meta_value
  }
  return out
}

export function getMetaByKey(meta, metaKey) {
  return meta.filter((m) => m.meta_key === metaKey).map((m) => ({ post_id: m.post_id, value: m.meta_value }))
}

/**
 * Reconstruct ACF repeater "program" from post_id 2 meta.
 * Keys: program_event_0_date, program_event_0_shows_0_schedule, program_event_0_shows_0_title, ...
 */
export function buildProgram(meta) {
  const eventMap = new Map()
  for (const key of Object.keys(meta)) {
    if (!key.startsWith('program_')) continue
    const val = meta[key]
    const dateMatch = key.match(/^program_event_(\d+)_date$/)
    if (dateMatch) {
      const eventIdx = parseInt(dateMatch[1], 10)
      if (!eventMap.has(eventIdx)) eventMap.set(eventIdx, { date: '', shows: [] })
      eventMap.get(eventIdx).date = val
      continue
    }
    const showMatch = key.match(/^program_event_(\d+)_shows_(\d+)_(schedule|title)$/)
    if (showMatch) {
      const eventIdx = parseInt(showMatch[1], 10)
      const sIdx = parseInt(showMatch[2], 10)
      const field = showMatch[3]
      if (!eventMap.has(eventIdx)) eventMap.set(eventIdx, { date: '', shows: [] })
      const ev = eventMap.get(eventIdx)
      while (ev.shows.length <= sIdx) ev.shows.push({ schedule: '', title: '' })
      ev.shows[sIdx][field] = val
    }
  }
  const events = Array.from(eventMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => e)
  return { events }
}

/**
 * Get ACF option for theme-settings. ACF stores as options_theme-settings or theme-settings_about etc.
 */
export function getThemeSettingsOptions(options) {
  const out = { about: '', contact: '' }
  for (const o of options) {
    if (o.option_name === 'options_theme-settings' && o.option_value) {
      try {
        const parsed = JSON.parse(o.option_value)
        if (parsed.about != null) out.about = parsed.about
        if (parsed.contact != null) out.contact = parsed.contact
      } catch (_) {}
    }
    if (o.option_name === 'theme-settings_about') out.about = o.option_value || ''
    if (o.option_name === 'theme-settings_contact') out.contact = o.option_value || ''
  }
  return out
}

export { parsePhpSerializedIds }
