<template>
  <div class="repairs">
    <div class="toolbar">
      <div class="role-switch">
        <span class="lbl">当前身份</span>
        <button :class="{on: role==='resident'}" @click="role='resident'">👤 住户</button>
        <button :class="{on: role==='maintenance'}" @click="role='maintenance'">🧰 维护人员</button>
      </div>
      <div class="filter">
        <button :class="{on: tab==='active'}" @click="tab='active'">进行中 {{ store.activeRepairs.length }}</button>
        <button :class="{on: tab==='all'}" @click="tab='all'">全部</button>
      </div>
    </div>

    <div class="list">
      <div v-for="t in shown" :key="t.id" class="ticket" :class="t.status">
        <div class="t-head">
          <b>{{ t.device_name }}</b>
          <span class="tid">工单#{{ t.id }}</span>
          <span class="badge" :class="t.status">{{ STATUS[t.status].label }}</span>
        </div>
        <div class="t-info">
          <span v-if="t.alert_text">🚨 {{ t.alert_text }}</span>
          <span v-if="t.note">📝 {{ t.note }}</span>
        </div>

        <!-- 流转时间线 -->
        <div class="steps">
          <div class="step" :class="{hit: t.created_at}"><i>1</i><div><b>发起报修</b><em>{{ t.created_at || '—' }}</em></div></div>
          <div class="step" :class="{hit: t.accepted_at}"><i>2</i><div><b>接单·隔离</b><em>{{ t.accepted_at || '—' }}</em></div></div>
          <div class="step" :class="{hit: t.fixed_at}"><i>3</i><div><b>检修完成</b><em>{{ t.fixed_at || '—' }}</em></div></div>
          <div class="step" :class="{hit: t.confirmed_at}"><i>4</i><div><b>确认·恢复</b><em>{{ t.confirmed_at || '—' }}</em></div></div>
        </div>

        <div v-if="t.result" class="result">🔧 检修结论：{{ t.result }}</div>
        <div v-if="t.status==='repairing'" class="iso-hint">🔒 设备隔离中：手动开关与场景联动均已暂停</div>

        <!-- 角色操作区 -->
        <div class="ops">
          <template v-if="role==='maintenance'">
            <button v-if="t.status==='pending'" class="op accept" @click="store.acceptRepair(t.id)">🧰 接单并隔离设备</button>
            <template v-if="t.status==='repairing'">
              <input v-model="results[t.id]" placeholder="检修结论，如 已更换电池/重启网关" />
              <button class="op fix" @click="fix(t)">✅ 检修完成</button>
            </template>
          </template>
          <template v-else>
            <button v-if="t.status==='fixed'" class="op confirm" @click="store.confirmRepair(t.id)">👍 确认恢复控制</button>
            <button v-if="t.status==='pending'" class="op cancel" @click="store.cancelRepair(t.id)">取消报修</button>
          </template>
        </div>
      </div>
      <div v-if="!shown.length" class="none">{{ tab==='active' ? '✨ 暂无进行中的工单' : '暂无工单' }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useHomeStore } from '@/store/home'
const store = useHomeStore()
const role = ref('resident')
const tab = ref('active')
const results = ref({})

const STATUS = {
  pending: { label: '待接单' },
  repairing: { label: '检修中·已隔离' },
  fixed: { label: '待住户确认' },
  done: { label: '已完成' },
  cancelled: { label: '已取消' }
}

const shown = computed(() => tab.value === 'active' ? store.activeRepairs : store.repairs)

function fix(t) {
  store.fixRepair(t.id, results.value[t.id] || '')
  results.value[t.id] = ''
}
</script>

<style scoped>
.repairs{display:flex;flex-direction:column;gap:12px;}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.role-switch,.filter{display:flex;gap:6px;align-items:center;background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:10px;padding:5px 8px;}
.lbl{font-size:11px;color:#8ba2c8;}
.role-switch button,.filter button{font-family:inherit;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#aebadd;border-radius:7px;padding:6px 12px;font-size:12px;cursor:pointer;}
.role-switch button.on,.filter button.on{background:linear-gradient(135deg,#1d3f8f,#2962ff);color:#fff;border-color:transparent;}
.filter{margin-left:auto;}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;}
.ticket{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;}
.ticket.repairing{border-color:rgba(255,179,0,0.45);}
.ticket.fixed{border-color:rgba(171,71,188,0.45);}
.ticket.done{opacity:.8;}
.ticket.cancelled{opacity:.55;}
.t-head{display:flex;align-items:center;gap:8px;}
.t-head b{color:#fff;font-size:14px;}
.tid{font-size:10px;color:#5b6f94;}
.badge{margin-left:auto;font-size:10px;padding:2px 8px;border-radius:6px;}
.badge.pending{background:#0d47a1;color:#bbdefb;}
.badge.repairing{background:#4e342e;color:#ffcc80;}
.badge.fixed{background:#4a148c;color:#e1bee7;}
.badge.done{background:#1b5e20;color:#a5d6a7;}
.badge.cancelled{background:#37474f;color:#90a4ae;}
.t-info{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#8ba2c8;}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;}
.step{display:flex;gap:6px;align-items:flex-start;opacity:.4;}
.step.hit{opacity:1;}
.step i{width:18px;height:18px;border-radius:50%;background:#16263f;color:#90caf9;font-size:10px;font-style:normal;display:grid;place-items:center;flex:none;}
.step.hit i{background:#2962ff;color:#fff;}
.step b{display:block;font-size:11px;color:#dbe4f3;}
.step em{font-size:9px;color:#5b6f94;font-style:normal;word-break:break-all;}
.result{font-size:12px;color:#a5d6a7;background:#12261a;border:1px solid rgba(102,187,106,0.25);border-radius:8px;padding:7px 10px;}
.iso-hint{font-size:11px;color:#ffcc80;background:#2a2111;border:1px solid rgba(255,179,0,0.3);border-radius:8px;padding:6px 10px;}
.ops{display:flex;gap:8px;flex-wrap:wrap;}
.ops input{flex:1;min-width:140px;font-family:inherit;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#dbe4f3;border-radius:8px;padding:8px 10px;font-size:12px;}
.op{font-family:inherit;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;}
.op.accept{background:linear-gradient(135deg,#fb8c00,#ef6c00);}
.op.fix{background:linear-gradient(135deg,#43a047,#2e7d32);}
.op.confirm{background:linear-gradient(135deg,#1d3f8f,#2962ff);}
.op.cancel{background:#37474f;color:#b0bec5;}
.none{color:#5b6f94;text-align:center;padding:30px;grid-column:1/-1;}
</style>
