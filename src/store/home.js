import { defineStore } from 'pinia'

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opt.body = JSON.stringify(body)
  const r = await fetch('/api' + path, opt)
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || '请求失败')
  return data
}

export const useHomeStore = defineStore('home', {
  state: () => ({
    loaded: false,
    role: localStorage.getItem('smarthome_role') || 'resident', // resident 住户 / worker 维护人员
    rooms: [],
    types: [],
    devices: [],
    scenes: [],
    logs: [],
    energy: [],
    alerts: [],
    repairs: [],
    toast: null
  }),
  getters: {
    onlineCount: (s) => s.devices.filter((d) => d.status === 'online').length,
    errorCount: (s) => s.devices.filter((d) => d.status === 'error').length,
    isolatedCount: (s) => s.devices.filter((d) => d.isolated).length,
    onCount: (s) => s.devices.filter((d) => d.power_on).length,
    totalWatts: (s) => s.devices.reduce((sum, d) => sum + (d.power_on && !d.isolated ? d.watts : 0), 0),
    // 进行中的工单（待接单/已接单/隔离中/待确认）
    activeRepairs: (s) => s.repairs.filter((r) => ['pending', 'accepted', 'isolated', 'repaired'].includes(r.status)),
    // 设备 ID → 进行中工单，供告警/设备卡片判断「处理中」
    activeRepairByDevice() {
      const m = {}
      this.activeRepairs.forEach((r) => { if (r.device_id != null) m[r.device_id] = r })
      return m
    }
  },
  actions: {
    async load() {
      const d = await api('/state')
      this.rooms = d.rooms
      this.types = d.types
      this.devices = d.devices
      this.scenes = d.scenes
      this.logs = d.logs
      this.energy = d.energy
      this.alerts = d.alerts
      this.repairs = d.repairs || []
      this.loaded = true
    },
    setRole(role) {
      this.role = role
      localStorage.setItem('smarthome_role', role)
    },
    toastMsg(msg, type = 'info') {
      this.toast = { msg, type, id: Date.now() }
    },
    clearToast() { this.toast = null },

    async addDevice(p) {
      try { await api('/device', 'POST', p); await this.load(); this.toastMsg('已新增设备', 'success') }
      catch (e) { this.toastMsg(e.message, 'warn') }
    },
    async removeDevice(id) {
      await api('/device/' + id, 'DELETE'); await this.load()
    },
    async toggleDevice(id) {
      try {
        const r = await api(`/device/${id}/toggle`, 'POST'); await this.load()
        return r.power_on
      } catch (e) { this.toastMsg(e.message, 'warn') }
    },
    async updateDevice(id, patch) {
      await api(`/device/${id}/update`, 'POST', patch); await this.load()
    },
    async addScene(scene) {
      const r = await api('/scene', 'POST', scene); await this.load(); this.toastMsg('场景已创建', 'success'); return r.id
    },
    async deleteScene(id) {
      await api('/scene/' + id, 'DELETE'); await this.load()
    },
    async toggleScene(id) {
      await api(`/scene/${id}/toggle`, 'POST'); await this.load()
    },
    async runScene(id) {
      try {
        const r = await api(`/scene/${id}/run`, 'POST')
        await this.load()
        if (r.failed?.length)
          this.toastMsg(`场景执行完成：成功 ${r.executed.length} 项，失败 ${r.failed.length} 项`, 'warn')
        else
          this.toastMsg(`场景已触发，成功执行 ${r.executed.length} 个动作`, 'success')
        return r
      } catch (e) {
        this.toastMsg(e.message, 'warn')
      }
    },

    // ===== 报修工单 =====
    async createRepair(device_id, reason) {
      try {
        await api('/repair', 'POST', { device_id, reason })
        await this.load()
        this.toastMsg('报修已发起，等待维护人员接单', 'success')
        return true
      } catch (e) { this.toastMsg(e.message, 'warn'); return false }
    },
    async repairAction(id, act, body, okMsg) {
      try {
        await api(`/repair/${id}/${act}`, 'POST', body || {})
        await this.load()
        this.toastMsg(okMsg, 'success')
        return true
      } catch (e) { this.toastMsg(e.message, 'warn'); return false }
    }
  }
})
