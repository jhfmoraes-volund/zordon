/**
 * Anti-FOUC bootstrap script.
 *
 * Roda blocking no <head> antes do CSS aplicar — lê o tema salvo em
 * localStorage e seta data-theme no <html> antes do primeiro paint.
 *
 * Self-contained: não importa nada em runtime (executa antes dos
 * módulos JS carregarem). Storage key e default vão hardcoded; se
 * mudarem em themes.ts, mudar aqui também.
 *
 * IDs desconhecidos passam direto — o CSS faz fallback ao default
 * (charcoal vive em `.dark` sem seletor [data-theme]).
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('volund.theme');document.documentElement.dataset.theme=t||'charcoal'}catch(e){document.documentElement.dataset.theme='charcoal'}})();`;
