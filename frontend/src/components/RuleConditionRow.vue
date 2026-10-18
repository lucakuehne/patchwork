<script setup lang="ts">
import { FIELD_LABELS, OPERATORS, VALUE_PLACEHOLDERS } from '../rules-text';
import type { ConditionField, RuleCondition } from '../types';

/** Eine Bedingung einer Regel: Feld, Vergleich und Wert. */
const props = defineProps<{ mailboxes: { id: string; name: string; address: string }[] }>();
const condition = defineModel<RuleCondition>({ required: true });
const emit = defineEmits<{ remove: [] }>();

function setField(field: ConditionField) {
  condition.value = {
    kind: 'condition',
    field,
    operator: OPERATORS[field][0]!.value,
    value: field === 'mailbox' ? (props.mailboxes[0]?.id ?? '') : '',
  };
}
</script>

<template>
  <div class="condition">
    <select
      class="select field"
      :value="condition.field"
      aria-label="Feld"
      @change="setField(($event.target as HTMLSelectElement).value as ConditionField)"
    >
      <option v-for="(label, key) in FIELD_LABELS" :key="key" :value="key">{{ label }}</option>
    </select>
    <select v-model="condition.operator" class="select operator" aria-label="Vergleich">
      <option v-for="o in OPERATORS[condition.field]" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <select v-if="condition.field === 'mailbox'" v-model="condition.value" class="select value" aria-label="Postfach">
      <option v-for="m in mailboxes" :key="m.id" :value="m.id">{{ m.name }} · {{ m.address }}</option>
    </select>
    <input
      v-else
      v-model="condition.value"
      class="input value"
      maxlength="500"
      :placeholder="VALUE_PLACEHOLDERS[condition.operator]"
      aria-label="Wert"
    />
    <button class="btn btn-ghost btn-icon remove" type="button" aria-label="Bedingung entfernen" @click="emit('remove')">✕</button>
  </div>
</template>

<style scoped>
.condition {
  display: grid;
  grid-template-columns: 170px 170px minmax(0, 1fr) 32px;
  gap: 6px;
  align-items: center;
}
@media (max-width: 720px) {
  .condition {
    grid-template-columns: 1fr 1fr;
  }
  .value {
    grid-column: 1 / 2;
  }
}
</style>
