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
    onCount: (s) => s.devices.filter((d) => d.power_on).length,
    totalWatts: (s) => s.devices.reduce((sum, d) => sum + (d.power_on ? d.watts : 0), 0),
    activeRepairs: (s) => s.repairs.filter((r) => ['pending', 'repairing', 'fixed'].includes(r.status)),
    isolatedCount: (s) => s.devices.filter((d) => d.isolated).length
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
      this.repairs = d.repairs
      this.loaded = true
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

    // ===== 维修工单 =====
    async createRepair(p) {
      try {
        await api('/repair', 'POST', p); await this.load()
        this.toastMsg('报修已提交，等待维护人员接单', 'success')
        return true
      } catch (e) { this.toastMsg(e.message, 'warn'); return false }
    },
    async acceptRepair(id) {
      try { await api(`/repair/${id}/accept`, 'POST'); await this.load(); this.toastMsg('已接单，设备已隔离', 'success') }
      catch (e) { this.toastMsg(e.message, 'warn') }
    },
    async fixRepair(id, result) {
      try { await api(`/repair/${id}/fix`, 'POST', { result }); await this.load(); this.toastMsg('检修完成，待住户确认', 'success') }
      catch (e) { this.toastMsg(e.message, 'warn') }
    },
    async confirmRepair(id) {
      try { await api(`/repair/${id}/confirm`, 'POST'); await this.load(); this.toastMsg('已确认，设备恢复控制', 'success') }
      catch (e) { this.toastMsg(e.message, 'warn') }
    },
    async cancelRepair(id) {
      try { await api(`/repair/${id}/cancel`, 'POST'); await this.load(); this.toastMsg('报修已取消', 'info') }
      catch (e) { this.toastMsg(e.message, 'warn') }
    }
  }
})
