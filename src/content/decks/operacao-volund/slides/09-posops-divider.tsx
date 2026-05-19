import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide09PosOpsDivider() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 03 <span>/</span> PÓS-OPS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">FASE 03 · PÓS-OPS</div>
          <div className="ph-num">03</div>
          <div className="ph-name">Pós-Ops</div>
          <p className="ph-desc">
            Operação assistida sobre o ambiente produtivo, janela de
            contingência para ajustes finais e avaliação de satisfação
            encerrando o ciclo.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Agenda da fase · 03 etapas</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Operação Assistida</span>
              <span className="tg">Diário</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Contingência</span>
              <span className="tg">Reserva</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">Avaliação de Satisfação</span>
              <span className="tg">Cliente</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Duração</div>
            <div className="v">
              <span className="accent">3</span> meses
            </div>
          </div>
          <div className="cell">
            <div className="k">Etapas</div>
            <div className="v">03 marcos</div>
          </div>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">Diária · assistida</div>
          </div>
          <div className="cell">
            <div className="k">Output principal</div>
            <div className="v">NPS · CSAT · aprendizados</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 03" num="09 / 10" />
    </>
  );
}
