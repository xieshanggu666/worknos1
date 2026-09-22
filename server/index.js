import express from 'express'
import { db } from './db.js'

const app = express()
app.use(express.json())

const q = (sql, ...p) => db.prepare(sql).all(...p)
const q1 = (sql, ...p) => db.prepare(sql).get(...p)
const run = (sql, ...p) => db.prepare(sql).run(...p)
const now = () => new Date().toLocaleString('zh-CN')

// 追加日志
function log(device, action, detail = '') {
  run('INSERT INTO device_logs (device_name,action,detail,time) VALUES (?,?,?,?)', device, action, detail, now())
  // 保留最近 200 条
  const c = q1('SELECT COUNT(*) c FROM device_logs').c
  if (c > 200) db.exec('DELETE FROM device_logs WHERE id <= (SELECT MAX(id)-200 FROM device_logs)')
}

// ===== 状态聚合 =====
app.get('/api/state', (req, res) => {
  res.json({
    rooms: q('SELECT * FROM rooms'),
    types: q('SELECT * FROM device_types'),
    devices: q(`SELECT d.*, r.name room, t.name type_name, t.icon type_icon
                FROM devices d JOIN rooms r ON r.id=d.room_id JOIN device_types t ON t.id=d.type_id`),
    scenes: q('SELECT * FROM scenes').map((s) => {
      const actions = q(`SELECT sa.id, sa.device_id, sa.device_key, sa.action, d.name device_name,
                                (SELECT COUNT(*) FROM devices x WHERE x.name=sa.device_key) key_match_count
                         FROM scene_actions sa LEFT JOIN devices d ON d.id=sa.device_id
                         WHERE sa.scene_id=? ORDER BY sa.order_no, sa.id`, s.id)
        .map((a) => ({
          ...a,
          // device_id 为空时区分原因：同名设备不止一台=迁移时无法判定归属，需人工重新绑定；否则为设备已删除
          unresolved: !a.device_name ? (a.key_match_count > 1 ? 'duplicate' : 'missing') : null
        }))
      return { ...s, action_count: actions.length, actions }
    }),
    logs: q('SELECT * FROM device_logs ORDER BY id DESC LIMIT 50'),
    energy: q('SELECT * FROM energy'),
    alerts: computeAlerts(),
    repairs: q('SELECT * FROM repair_tickets ORDER BY id DESC LIMIT 50')
  })
})

function computeAlerts() {
  const devs = q('SELECT * FROM devices')
  const alerts = []
  for (const d of devs) {
    if (d.status === 'error') alerts.push({ device: d.name, device_id: d.id, level: 'error', text: '设备离线/异常' })
    else if (d.battery < 40) alerts.push({ device: d.name, device_id: d.id, level: 'warn', text: `电量低(${d.battery}%)` })
    else if (d.signal < 60) alerts.push({ device: d.name, device_id: d.id, level: 'warn', text: `信号弱(${d.signal})` })
  }
  // 能耗异常：某设备 24h 峰值异常偏离
  const agg = q(`SELECT device_name, MAX(kwh) peak, AVG(kwh) avg FROM energy GROUP BY device_name`)
  for (const row of agg) {
    if (row.avg > 0 && row.peak > row.avg * 3) {
      // 名称唯一命中才给出 device_id，重名设备不猜测归属（前端据此隐藏报修入口）
      const m = q('SELECT id FROM devices WHERE name=?', row.device_name)
      alerts.push({ device: row.device_name, device_id: m.length === 1 ? m[0].id : null, level: 'info', text: '能耗尖峰偏离平均值' })
    }
  }
  return alerts
}

// ===== 设备 =====
app.post('/api/device', (req, res) => {
  const { name, type_id, room_id } = req.body
  if (!name || !type_id || !room_id) return res.status(400).json({ error: 'missing' })
  const r = run('INSERT INTO devices (name,type_id,room_id) VALUES (?,?,?)', name, type_id, room_id)
  log(name, '新增设备', `房间 ${q1('SELECT name FROM rooms WHERE id=?', room_id).name}`)
  res.json({ ok: true, id: r.lastInsertRowid })
})
app.delete('/api/device/:id', (req, res) => {
  const d = q1('SELECT * FROM devices WHERE id=?', req.params.id)
  if (!d) return res.status(404).json({ error: 'not found' })
  // 有进行中工单的设备禁止删除，避免工单悬在空中
  const active = q1(`SELECT COUNT(*) c FROM repair_tickets WHERE device_id=? AND status IN ('pending','repairing','fixed')`, d.id).c
  if (active) return res.status(409).json({ error: '设备有进行中的维修工单，无法删除' })
  // 引用该设备的场景动作将随外键 ON DELETE SET NULL 置空（失效引用）
  const affected = q1('SELECT COUNT(*) c FROM scene_actions WHERE device_id=?', d.id).c
  run('DELETE FROM devices WHERE id=?', d.id)
  log(d.name, '删除设备', affected ? `${affected} 个场景动作失效` : '')
  res.json({ ok: true, affected_actions: affected })
})
// 切换开关
app.post('/api/device/:id/toggle', (req, res) => {
  const d = q1('SELECT * FROM devices WHERE id=?', req.params.id)
  if (!d) return res.status(404).json({ error: 'not found' })
  if (d.isolated) return res.status(409).json({ error: '设备检修隔离中，禁止手动操作' })
  if (d.status === 'error') return res.status(409).json({ error: '设备异常，无法操作' })
  const on = d.power_on ? 0 : 1
  run('UPDATE devices SET power_on=? WHERE id=?', on, d.id)
  log(d.name, on ? '开启' : '关闭')
  res.json({ ok: true, power_on: on })
})
// 更新设备字段
app.post('/api/device/:id/update', (req, res) => {
  const d = q1('SELECT * FROM devices WHERE id=?', req.params.id)
  if (!d) return res.status(404).json({ error: 'not found' })
  const { name, room_id, watts, power_on } = req.body
  // 隔离期间禁止改动开关状态（名称/功率等元信息仍可编辑）
  if (d.isolated && power_on !== undefined && power_on !== d.power_on)
    return res.status(409).json({ error: '设备检修隔离中，禁止手动操作' })
  run('UPDATE devices SET name=?, room_id=?, watts=?, power_on=? WHERE id=?',
    name ?? d.name, room_id ?? d.room_id, watts ?? d.watts, power_on ?? d.power_on, d.id)
  // 改名后同步场景动作里的名称快照（关联仍按 device_id，不受影响）
  if (name && name !== d.name) run('UPDATE scene_actions SET device_key=? WHERE device_id=?', name, d.id)
  log(name ?? d.name, '更新设备')
  res.json({ ok: true })
})

// ===== 场景 =====
app.post('/api/scene', (req, res) => {
  const { name, actions } = req.body
  const list = Array.isArray(actions) ? actions : []
  for (const a of list) {
    if (!q1('SELECT id FROM devices WHERE id=?', a.device_id))
      return res.status(400).json({ error: `动作引用了不存在的设备（ID ${a.device_id}）` })
  }
  const r = run('INSERT INTO scenes (name,desc,enabled) VALUES (?,?,1)', name || '新场景', '')
  const act = db.prepare('INSERT INTO scene_actions (scene_id,device_id,device_key,action,order_no) VALUES (?,?,?,?,?)')
  list.forEach((a, i) => {
    const d = q1('SELECT name FROM devices WHERE id=?', a.device_id)
    act.run(r.lastInsertRowid, a.device_id, d.name, a.action, i)
  })
  res.json({ ok: true, id: r.lastInsertRowid })
})
app.delete('/api/scene/:id', (req, res) => {
  const s = q1('SELECT * FROM scenes WHERE id=?', req.params.id)
  if (s) { run('DELETE FROM scenes WHERE id=?', s.id); run('DELETE FROM scene_actions WHERE scene_id=?', s.id) }
  res.json({ ok: true })
})
app.post('/api/scene/:id/toggle', (req, res) => {
  const s = q1('SELECT * FROM scenes WHERE id=?', req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  run('UPDATE scenes SET enabled=? WHERE id=?', s.enabled ? 0 : 1, s.id)
  res.json({ ok: true, enabled: s.enabled ? 0 : 1 })
})
// 触发场景：按 device_id 逐条执行，成功/失败如实记录并返回
app.post('/api/scene/:id/run', (req, res) => {
  const s = q1('SELECT * FROM scenes WHERE id=?', req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  if (!s.enabled) return res.status(409).json({ error: '场景已停用，无法执行' })
  const actions = q(`SELECT sa.*, d.id did, d.name dname, d.status dstatus, d.isolated disolated,
                            (SELECT COUNT(*) FROM devices x WHERE x.name=sa.device_key) key_match_count
                     FROM scene_actions sa LEFT JOIN devices d ON d.id=sa.device_id
                     WHERE sa.scene_id=? ORDER BY sa.order_no, sa.id`, s.id)
  const executed = [], failed = []
  for (const a of actions) {
    const label = a.dname || a.device_key || `设备#${a.device_id ?? '?'}`
    if (!a.did) {
      // 未绑定动作一律跳过，绝不按名称猜测执行，避免误控同名设备
      const duplicate = a.key_match_count > 1
      const reason = duplicate ? '存在重名设备，待重新绑定' : '设备已删除'
      failed.push({ device: label, action: a.action, reason })
      log(label, `场景「${s.name}」执行失败`, `${a.action}（${reason}）`)
      continue
    }
    if (a.disolated) {
      // 检修隔离中的设备不响应场景动作
      failed.push({ device: a.dname, action: a.action, reason: '设备检修隔离中' })
      log(a.dname, `场景「${s.name}」执行失败`, `${a.action}（设备检修隔离中）`)
      continue
    }
    if (a.dstatus !== 'online') {
      failed.push({ device: a.dname, action: a.action, reason: '设备离线/异常' })
      log(a.dname, `场景「${s.name}」执行失败`, `${a.action}（设备离线/异常）`)
      continue
    }
    // 每个动作确定性地映射为开/关：关闭/关机/撤防→关，其余（开启/启动/布防/制冷/调光…）→开
    const on = /关|撤防/.test(a.action) ? 0 : 1
    run('UPDATE devices SET power_on=? WHERE id=?', on, a.did)
    log(a.dname, `场景「${s.name}」执行`, a.action)
    executed.push({ device: a.dname, action: a.action })
  }
  res.json({ ok: failed.length === 0, executed, failed })
})

// ===== 日志 =====
app.get('/api/logs', (req, res) => {
  res.json(q('SELECT * FROM device_logs ORDER BY id DESC LIMIT 100'))
})

// ===== 维修工单 =====
const ACTIVE_TICKET = `status IN ('pending','repairing','fixed')`
const ticketOf = (id) => q1('SELECT * FROM repair_tickets WHERE id=?', id)

// 住户从告警发起报修
app.post('/api/repair', (req, res) => {
  const { device_id, alert_text, note } = req.body
  const d = q1('SELECT * FROM devices WHERE id=?', device_id)
  if (!d) return res.status(404).json({ error: '设备不存在' })
  const active = q1(`SELECT id FROM repair_tickets WHERE device_id=? AND ${ACTIVE_TICKET}`, d.id)
  if (active) return res.status(409).json({ error: '该设备已有进行中的报修工单' })
  const r = run(`INSERT INTO repair_tickets (device_id,device_name,alert_text,note,status,created_at)
                 VALUES (?,?,?,?,'pending',?)`, d.id, d.name, alert_text || '', note || '', now())
  log(d.name, '发起报修', [`工单#${r.lastInsertRowid}`, alert_text && `告警：${alert_text}`, note && `描述：${note}`].filter(Boolean).join('；'))
  res.json({ ok: true, id: r.lastInsertRowid })
})
// 维护人员接单：工单进入检修中，设备隔离（禁止手动/场景操作）
app.post('/api/repair/:id/accept', (req, res) => {
  const t = ticketOf(req.params.id)
  if (!t) return res.status(404).json({ error: '工单不存在' })
  if (t.status !== 'pending') return res.status(409).json({ error: '工单状态已变化，请刷新' })
  run(`UPDATE repair_tickets SET status='repairing', accepted_at=? WHERE id=?`, now(), t.id)
  if (t.device_id) run('UPDATE devices SET isolated=1 WHERE id=?', t.device_id)
  log(t.device_name, '维修接单', `工单#${t.id} 维护人员已接单，设备隔离中（手动/场景操作暂停）`)
  res.json({ ok: true })
})
// 维护人员检修完成：修复设备健康状况，等待住户确认（仍保持隔离）
app.post('/api/repair/:id/fix', (req, res) => {
  const t = ticketOf(req.params.id)
  if (!t) return res.status(404).json({ error: '工单不存在' })
  if (t.status !== 'repairing') return res.status(409).json({ error: '工单状态已变化，请刷新' })
  const result = (req.body.result || '').trim() || '检修完成'
  run(`UPDATE repair_tickets SET status='fixed', result=?, fixed_at=? WHERE id=?`, result, now(), t.id)
  if (t.device_id) {
    const d = q1('SELECT * FROM devices WHERE id=?', t.device_id)
    if (d) {
      // 检修视为处理了告警根因：恢复在线，低电量/弱信号一并修复
      run(`UPDATE devices SET status='online', battery=?, signal=? WHERE id=?`,
        d.battery < 40 ? 100 : d.battery, d.signal < 60 ? 88 : d.signal, d.id)
    }
  }
  log(t.device_name, '检修完成', `${result}（待住户确认后恢复控制）`)
  res.json({ ok: true })
})
// 住户确认：解除隔离，恢复设备控制
app.post('/api/repair/:id/confirm', (req, res) => {
  const t = ticketOf(req.params.id)
  if (!t) return res.status(404).json({ error: '工单不存在' })
  if (t.status !== 'fixed') return res.status(409).json({ error: '工单状态已变化，请刷新' })
  run(`UPDATE repair_tickets SET status='done', confirmed_at=? WHERE id=?`, now(), t.id)
  if (t.device_id) run('UPDATE devices SET isolated=0 WHERE id=?', t.device_id)
  log(t.device_name, '恢复控制', `工单#${t.id} 住户已确认，设备解除隔离、恢复控制`)
  res.json({ ok: true })
})
// 住户取消报修（仅待接单阶段）
app.post('/api/repair/:id/cancel', (req, res) => {
  const t = ticketOf(req.params.id)
  if (!t) return res.status(404).json({ error: '工单不存在' })
  if (t.status !== 'pending') return res.status(409).json({ error: '工单已受理，无法取消' })
  run(`UPDATE repair_tickets SET status='cancelled' WHERE id=?`, t.id)
  log(t.device_name, '取消报修', `工单#${t.id}`)
  res.json({ ok: true })
})

const PORT = 4120
app.listen(PORT, () => console.log(`[HOME] API running at http://localhost:${PORT}`))