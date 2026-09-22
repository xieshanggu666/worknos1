<template>
  <div class="repairs">
    <!-- 住户发起报修 -->
    <form v-if="store.role==='resident'" class="card report" @submit.prevent="submit">
      <h4>📨 发起报修</h4>
      <p class="tip">从健康看板告警发现设备异常时，可在此选择设备提交报修单，维护人员接单处理后需由你确认恢复。</p>
      <div class="form-row">
        <select v-model="form.device_id" required>
          <option disabled value="">选择异常设备</option>
          <option v-for="d in store.devices" :key="d.id" :value="d.id">
            {{ d.type_icon }} {{ d.name }}（{{ d.room }}）{{ d.isolated ? '· 隔离中' : d.status === 'error' ? '· 异常' : '' }}
          </option>
        </select>
        <input v-model="form.reason" placeholder="故障描述，如 频繁掉线 / 无法开关（可选）" maxlength="100" />
        <button class="primary" type="submit">提交报修</button>
      </div>
      <p v-if="reportHint" class="hint">{{ reportHint }}</p>
    </form>

    <!-- 流程说明 -->
    <div class="flow">
      <span v-for="(s,i) in flowSteps" :key="s.key" class="fstep" :class="{now: activeKey===s.key}">
        <i>{{ i + 1 }}</i>{{ s.label }}<b v-if="i<flowSteps.length-1">→</b>
      </span>
    </div>

    <h4 class="list-title">📋 工单列表 <em>（进行中 {{ store.activeRepairs.length }}）</em></h4>
    <div v-if="!store.repairs.length" class="none">暂无报修工单</div>
    <div v-for="o in store.repairs" :key="o.id" class="order" :class="['st-' + o.status]">
      <div class="o-head">
        <span class="oid">#{{ o.id }}</span>
        <b class="oname">{{ o.device_name }}</b>
        <span class="status" :class="o.status">{{ statusText(o.status) }}</span>
        <span class="time">{{ o.created_at }}</span>
      </div>
      <div class="o-desc" v-if="o.reason">📝 {{ o.reason }}</div>
      <div class="o-track">
        <span v-for="s in trackSteps" :key="s.key" class="tk"
              :class="{done: stepDone(o, s.key), cur: o.status===s.key}">{{ s.label }}</span>
      </div>
      <div class="o-meta">
        <span v-if="o.worker">👷 {{ o.worker }}</span>
        <span v-if="o.result">🔧 {{ o.result }}</span>
        <span v-if="o.status==='done' && o.confirmed_at">✅ 住户已于 {{ o.confirmed_at }} 确认恢复</span>
        <span v-if="o.status==='cancelled' && o.cancelled_at">🚫 已于 {{ o.cancelled_at }} 撤销</span>
      </div>
      <div class="o-actions">
        <!-- 住户视角 -->
        <template v-if="store.role==='resident'">
          <button v-if="o.status==='repaired'" class="primary" @click="confirm(o)">✅ 确认恢复控制</button>
          <button v-if="['pending','accepted'].includes(o.status)" class="ghost danger" @click="cancel(o)">撤销报修</button>
          <span v-if="o.status==='isolated'" class="locked">🔒 设备隔离中，已暂停手动与场景操作</span>
          <span v-if="o.status==='pending'" class="wait">⏳ 等待维护人员接单</span>
          <span v-if="o.status==='accepted'" class="wait">👷 维护人员已接单，等待隔离检修</span>
          <span v-if="o.status==='done'" class="done-txt">本单已闭环</span>
        </template>
        <!-- 维护人员视角 -->
        <template v-else>
          <button v-if="o.status==='pending'" class="primary" @click="accept(o)">📥 接单</button>
          <button v-if="o.status==='accepted'" class="warn" @click="isolate(o)">🚧 隔离设备并检修</button>
          <button v-if="o.status==='isolated'" class="primary" @click="showResult(o)">✔️ 完成检修</button>
          <span v-if="o.status==='repaired'" class="wait">⏳ 已解除隔离，等待住户确认</span>
          <span v-if="o.status==='done'" class="done-txt">住户已确认，工单闭环</span>
          <span v-if="o.status==='cancelled'" class="done-txt">住户已撤销</span>
        </template>
      </div>
    </div>

    <!-- 检修结果填写 -->
    <div v-if="repairing" class="mask" @click.self="repairing=null">
      <div class="dialog">
        <h4>🔧 提交检修结果 · #{{ repairing.id }} {{ repairing.device_name }}</h4>
        <p class="tip">提交后设备将解除隔离并恢复在线，随后由住户确认恢复控制。</p>
        <textarea v-model="result" placeholder="处理措施与结果，如 更换电池并重新配网" maxlength="200" rows="3"></textarea>
        <div class="dlg-btns">
          <button class="primary" @click="submitRepair">提交检修结果</button>
          <button class="ghost" @click="repairing=null">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useHomeStore } from '@/store/home'
const store = useHomeStore()

const form = ref({ device_id: '', reason: '' })
const reportHint = ref('')
const repairing = ref(null)
const result = ref('')

const flowSteps = [
  { key: 'pending', label: '住户报修' },
  { key: 'accepted', label: '维护接单' },
  { key: 'isolated', label: '隔离检修' },
  { key: 'repaired', label: '检修完成' },
  { key: 'done', label: '住户确认恢复' }
]
const trackSteps = flowSteps
const activeKey = computed(() => store.activeRepairs[0]?.status || '')

const STATUS = { pending: '待接单', accepted: '已接单', isolated: '隔离检修中', repaired: '待住户确认', done: '已恢复', cancelled: '已撤销' }
function statusText(s) { return STATUS[s] || s }

const order = { pending: 0, accepted: 1, isolated: 2, repaired: 3, done: 4, cancelled: -1 }
function stepDone(o, key) {
  if (o.status === 'cancelled') return false
  return order[o.status] >= order[key]
}

async function submit() {
  reportHint.value = ''
  const ok = await store.createRepair(Number(form.value.device_id), form.value.reason.trim())
  if (ok) form.value = { device_id: '', reason: '' }
}
function accept(o) { store.repairAction(o.id, 'accept', { worker: '张工' }, `已接单（#${o.id}）`) }
function isolate(o) { store.repairAction(o.id, 'isolate', {}, `设备已隔离，手动与场景操作已锁定（#${o.id}）`) }
function showResult(o) { repairing.value = o; result.value = '' }
async function submitRepair() {
  const ok = await store.repairAction(repairing.value.id, 'repair',
    { result: result.value.trim() }, `检修结果已提交，等待住户确认（#${repairing.value.id}）`)
  if (ok) repairing.value = null
}
function confirm(o) { store.repairAction(o.id, 'confirm', {}, '已确认，设备控制恢复') }
async function cancel(o) {
  if (!confirm(`撤销工单 #${o.id}（${o.device_name}）？`)) return
  store.repairAction(o.id, 'cancel', {}, `工单 #${o.id} 已撤销`)
}
</script>

<style scoped>
.repairs{display:flex;flex-direction:column;gap:14px;}
.card{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:16px;}
h4{margin:0 0 10px;color:#fff;font-size:14px;}
.tip{color:#8ba2c8;font-size:12px;margin:0 0 10px;line-height:1.6;}
.form-row{display:flex;gap:8px;flex-wrap:wrap;}
select,input,button,textarea{font-family:inherit;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#dbe4f3;border-radius:8px;padding:9px 10px;font-size:12px;}
select{flex:1;min-width:200px;}
input{flex:2;min-width:220px;}
textarea{width:100%;resize:vertical;box-sizing:border-box;}
.primary{background:linear-gradient(135deg,#43a047,#2e7d32);border:none;color:#fff;font-weight:600;cursor:pointer;}
.warn{background:linear-gradient(135deg,#fb8c00,#e65100);border:none;color:#fff;font-weight:600;cursor:pointer;}
.ghost{background:#16263f;color:#aebadd;cursor:pointer;}
.ghost.danger{color:#ef9a9a;border-color:rgba(239,83,80,0.4);}
.hint{color:#ffb300;font-size:11px;margin:8px 0 0;}
/* 流程条 */
.flow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:12px 16px;}
.fstep{display:inline-flex;align-items:center;gap:6px;color:#8ba2c8;font-size:12px;}
.fstep i{width:20px;height:20px;border-radius:50%;background:#243357;display:grid;place-items:center;font-style:normal;font-size:11px;color:#aebadd;}
.fstep b{margin:0 6px;color:#3b4f78;font-weight:400;}
.fstep.now{color:#90caf9;}
.fstep.now i{background:#2962ff;color:#fff;}
.list-title{color:#fff;font-size:14px;margin:4px 0 0;}
.list-title em{color:#8ba2c8;font-style:normal;font-size:11px;font-weight:400;}
/* 工单卡 */
.order{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;}
.order.st-isolated{border-color:rgba(251,140,0,0.55);}
.order.st-repaired{border-color:rgba(102,187,106,0.5);}
.order.st-done,.order.st-cancelled{opacity:.7;}
.o-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.oid{background:#16263f;border:1px solid rgba(120,160,220,0.2);border-radius:6px;padding:2px 7px;font-size:11px;color:#90caf9;}
.oname{color:#fff;font-size:14px;}
.time{margin-left:auto;color:#5b6f94;font-size:10px;}
.status{font-size:10px;padding:2px 9px;border-radius:6px;font-weight:600;}
.status.pending{background:#37474f;color:#cfd8dc;}
.status.accepted{background:#1a3a6b;color:#90caf9;}
.status.isolated{background:#e65100;color:#ffe0b2;}
.status.repaired{background:#1b5e20;color:#a5d6a7;}
.status.done{background:#263238;color:#90a4ae;}
.status.cancelled{background:#263238;color:#78909c;}
.o-desc{font-size:12px;color:#cfd8dc;background:#13233f;border-radius:8px;padding:8px 10px;}
.o-track{display:flex;gap:6px;flex-wrap:wrap;}
.tk{position:relative;font-size:11px;color:#5b6f94;background:#0c1730;border:1px solid rgba(120,160,220,0.12);border-radius:20px;padding:4px 12px;}
.tk.done{color:#a5d6a7;border-color:rgba(102,187,106,0.4);}
.tk.cur{color:#ffe0b2;border-color:#fb8c00;background:#3a2208;}
.o-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:#8ba2c8;}
.o-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.o-actions button{cursor:pointer;}
.locked{color:#ffb300;font-size:12px;font-weight:600;}
.wait{color:#8ba2c8;font-size:12px;}
.done-txt{color:#66bb6a;font-size:12px;}
/* 弹窗 */
.mask{position:fixed;inset:0;background:rgba(5,10,22,0.7);z-index:60;display:grid;place-items:center;padding:20px;}
.dialog{background:#0f1b38;border:1px solid rgba(120,160,220,0.3);border-radius:14px;padding:20px;width:min(460px,100%);display:flex;flex-direction:column;gap:10px;}
.dlg-btns{display:flex;gap:8px;}
.none{color:#5b6f94;text-align:center;padding:30px;}
</style>
