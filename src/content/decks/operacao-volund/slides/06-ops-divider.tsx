import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide06OpsDivider() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 02 <span>/</span> OPS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">FASE 02 · OPS</div>
          <div className="ph-num">02</div>
          <div className="ph-name">Ops</div>
          <p className="ph-desc">
            Execução em sprints no formato Scrum Volund, com governança
            contínua, QA, auditoria técnica e de segurança até o go-live em
            produção.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Agenda da fase · 05 etapas</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Sprints</span>
              <span className="tg">Scrum Volund</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Alinhamento Contínuo</span>
              <span className="tg">Cliente</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">QA</span>
              <span className="tg">Squad + Cliente</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Auditoria + Segurança</span>
              <span className="tg">Interno</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Go Live</span>
              <span className="tg">Marco</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Duração</div>
            <div className="v">
              <span className="accent">1–3</span> meses
            </div>
          </div>
          <div className="cell">
            <div className="k">Etapas</div>
            <div className="v">05 marcos</div>
          </div>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">Sprints com cap FP</div>
          </div>
          <div className="cell">
            <div className="k">Output principal</div>
            <div className="v">Produto em produção</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 02" num="06 / 10" />
    </>
  );
}
