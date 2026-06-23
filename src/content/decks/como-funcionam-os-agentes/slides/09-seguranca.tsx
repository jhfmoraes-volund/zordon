import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideSeguranca() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            CONFIANÇA <span>/</span> FALLBACK · LIMITES · CONTEXTO
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">POR QUE É SEGURO</span> · sem trava · sem
            surpresa
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1500 }}
          >
            O agente é <em>contido por construção</em>.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>Nunca trava</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Fallback</span>
            </div>
            <div className="body">
              <p>
                Daemon offline? O chat troca de motor sozinho e avisa com uma
                tag. A conversa não morre.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Escopo fechado</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Só as tools certas</span>
            </div>
            <div className="body">
              <p>
                Cada agente só enxerga as ferramentas do seu domínio. As
                ferramentas genéricas que varrem disco ficam bloqueadas.
              </p>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Contexto no servidor</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Não confia no cliente</span>
            </div>
            <div className="body">
              <p>
                Quem é você, qual projeto, qual sprint — tudo é resolvido no
                servidor a partir da conversa, não enviado pelo agente.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>Novas escritas autônomas (Alpha) entram atrás de um interruptor</span>
          </div>
          <div>Humano aprova o que muda</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · CONFIANÇA" num="09 / 11" />
    </>
  );
}
