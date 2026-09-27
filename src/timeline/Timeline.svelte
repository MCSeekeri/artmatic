<script lang="ts">
  import { appState } from '../ui/app-state.svelte';
</script>

<div class="timeline">
  <p class="placeholder">时间轴（B5 落地）· 工程时长 {appState.project?.duration ?? 0}s</p>
</div>

<style>
  .timeline {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .placeholder {
    color: var(--text-2);
  }
</style>
