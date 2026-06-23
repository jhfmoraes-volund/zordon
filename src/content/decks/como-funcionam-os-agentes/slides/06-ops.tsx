import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideOps() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            APP 03 <span>/</span> OPS · ALPHA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">OPS</span> · visão de operação · agente: Alpha
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1500 }}
          >
            Alpha responde sobre a operação —
            <br />e <em>sabe onde você está</em>.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>Visão global</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Leitura</span>
            </div>
            <div className="body">
              <p>
                Pergunte sobre a operação de qualquer lugar — sem citar IDs.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                sprint · tasks · alertas · backlog · membros · reuniões
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Foco na rota</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Route-scoped</span>
              <span className="tag">novo</span>
            </div>
            <div className="body">
              <p>
                Numa página de projeto, &ldquo;lista os módulos&rdquo; já sabe
                qual projeto — pela rota, sem você dizer o ID.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                módulos · personas · stories · capacidade · distribuição
              </div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Escrita (começou)</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Editar task</span>
              <span className="tag">live</span>
            </div>
            <div className="body">
              <p>
                Já edita task pelo chat (status, sprint, responsável). Criar
                task/sprint/alocação e integrações (GitHub/Calendar) vêm a
                seguir — atrás de um interruptor de segurança.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Status</div>
              <div className="note">editar task live · resto no roadmap</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>Hoje: leitura ampla (global + route-scoped) + 1ª escrita</span>
          </div>
          <div>Novas escritas atrás de toggle</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · OPS" num="06 / 11" />
    </>
  );
}
