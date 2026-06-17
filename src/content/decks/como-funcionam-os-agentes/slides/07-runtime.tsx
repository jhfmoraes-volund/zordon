import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideRuntime() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            POR BAIXO <span>/</span> DOIS RUNTIMES
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">ONDE O AGENTE RODA</span> · default · fallback
            · v1
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1500 }}
          >
            Dois motores, troca <em>invisível</em>.
            <br />O chat nunca trava.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>Claude Daemon</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Default</span>
            </div>
            <div className="body">
              <p>
                O caminho padrão. Mesma stack da Forge, memória de conversa
                nativa e ferramentas via MCP. É aqui que os agentes rodam.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>OpenRouter</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Fallback</span>
            </div>
            <div className="body">
              <p>
                Se o daemon cai (sem sinal por 60s), o chat troca sozinho pra
                este caminho e mostra uma tag âmbar. Você não fica na mão.
              </p>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Daemon v1</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Hoje</span>
            </div>
            <div className="body">
              <p>
                Hoje o daemon roda numa máquina central e todos se conectam
                nele. O v2 (cada um roda o seu, com login próprio) vem no roadmap.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>A escolha é por usuário + agente — e dá pra forçar OpenRouter</span>
          </div>
          <div>Settings · Agentes</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · RUNTIME" num="07 / 11" />
    </>
  );
}
