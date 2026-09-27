<script lang="ts">
  import { appState } from './app-state.svelte';
</script>

<div class="inspector">
  <h3>检查器</h3>
  <p class="placeholder">选中一个片段查看属性（B5 落地）</p>
</div>

<style>
  .inspector {
    padding: 12px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-1);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .placeholder {
    color: var(--text-2);
  }
</style>
