import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide07OpsDetail() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 02 · OPS <span>/</span> ETAPAS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">FASE 02 · OPS</span> · 1 a 3 meses · 5 etapas
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            De <em>sprint a sprint</em> até produção,
            <br />
            com governança contínua.
          </h2>
        </div>

        <div className={styles.durationBar}>
          <div className="l">
            <span>1 a 3 meses</span>
            <span className="pill">Scrum Volund</span>
          </div>
          <div>SPRINT 1 → N · AUDITORIA → GO LIVE</div>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols5}`}>
          <div className="step-card">
            <div className="head">
              <span>Sprints</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Squad</span>
              <span className="tag">Scrum Volund</span>
            </div>
            <div className="body">
              <p>Condução de sprints seguindo formato Scrum Volund.</p>
              <p>
                Sprints com cap de FP entendendo bem nossa capacity para
                operação contínua.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">
                Entregas incrementais · 50% · 75% · 95% · 100%
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Alinhamento Contínuo</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Cliente</span>
              <span className="tag">Governança</span>
            </div>
            <div className="body">
              <p>
                Alinhamento contínuo com o cliente, considerando suas
                expectativas com o que estamos construindo.
              </p>
              <p>
                Solicitamos demos de acordo com o cliente: temos clientes que
                desejam mais e outros menos.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">
                Mantemos os processos pareados à agenda do cliente
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>QA</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Squad + Cliente</span>
            </div>
            <div className="body">
              <p>Inclusão de QA a partir da Sprint X.</p>
              <p>QA interno e validação do lado do cliente também.</p>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">
                Backlog de bugs priorizado · regressão controlada
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Auditoria Técnica + Segurança</span>
              <span className="ix">04</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Security · Infra</span>
            </div>
            <div className="body">
              <p>
                Com o produto pronto e validado em ambiente de staging,
                seguimos para auditoria técnica e de segurança.
              </p>
              <p>
                Objetivo: produto bem documentado, limpo e seguindo diretrizes
                do cliente.
              </p>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">Relatório de auditoria + go/no-go</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Go Live</span>
              <span className="ix">05</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Marco</span>
              <span className="tag cliente">Cliente</span>
            </div>
            <div className="body">
              <p>Produto em produção.</p>
              <p>
                Transição da fase Ops para Pós-Ops, com ambiente produtivo
                monitorado e janela de contigência ativa.
              </p>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">Produto live · handover para pós-ops</div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 02" num="07 / 10" />
    </>
  );
}
