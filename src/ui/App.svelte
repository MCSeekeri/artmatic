<script lang="ts">
  import logoSmall from '../assets/brand/logo-small-with-fonttype.svg';
</script>

<div class="shell">
  <header>
    <img src={logoSmall} alt="Artmatic" height="24" />
    <span class="hint">B2 渲染管线验证</span>
  </header>
  <div id="preview-host">
    <canvas id="gl"></canvas>
  </div>
</div>

<style>
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
  }
  .hint {
    color: var(--text-1);
  }
  #preview-host {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  #gl {
    max-width: 100%;
    max-height: 100%;
    background: #000;
  }
</style>
