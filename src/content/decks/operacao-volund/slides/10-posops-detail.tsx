import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide10PosOpsDetail() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 03 · PÓS-OPS <span>/</span> ETAPAS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">FASE 03 · PÓS-OPS</span> · 3 meses · 3 etapas
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            Estabilizar, mitigar, <em>medir satisfação</em>.
          </h2>
        </div>

        <div className={styles.durationBar}>
          <div className="l">
            <span>3 meses</span>
            <span className="pill">Operação Assistida</span>
          </div>
          <div>GO LIVE → ENCERRAMENTO</div>
        </div>

        <div
          className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}
          style={{ maxWidth: 1500 }}
        >
          <div className="step-card">
            <div className="head">
              <span>Operação Assistida</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Squad</span>
              <span className="tag">Diário</span>
            </div>
            <div className="body">
              <p>
                Ambiente produtivo monitorado diariamente para estabilização
                inicial.
              </p>
              <p>
                Correções rápidas aplicadas para estabilização do ambiente
                produtivo.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">
                Ambiente estabilizado · backlog de incidentes endereçado
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Contigência</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Reserva</span>
            </div>
            <div className="body">
              <p>Janela de contigência reservada para ajustes finais pós Go Live.</p>
              <p>
                Não é desenvolvimento novo — é o colchão técnico para travas,
                regressões e ajustes residuais.
              </p>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">Ajustes finais aplicados · scope fechado</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Avaliação de Satisfação</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Cliente</span>
              <span className="tag brand">Encerramento</span>
            </div>
            <div className="body">
              <p>Avaliação com o cliente sobre satisfação com o projeto.</p>
              <ol>
                <li>Metodologia</li>
                <li>Time</li>
                <li>NPS</li>
                <li>CSAT</li>
              </ol>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">
                Relatório de satisfação · aprendizados para a próxima operação
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 03" num="10 / 10" />
    </>
  );
}
