import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide04ImersaoDivider() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 01 <span>/</span> IMERSÃO
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">FASE 01 · IMERSÃO</div>
          <div className="ph-num">01</div>
          <div className="ph-name">Imersão</div>
          <p className="ph-desc">
            Do primeiro contato comercial ao alinhamento final com o cliente —
            entendimento da jornada, mapeamento de risco e definição de
            escopo.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Agenda da fase · 06 etapas</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Comercial</span>
              <span className="tg">Pré-venda</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Proposta</span>
              <span className="tg">Pré-venda</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">KickOff</span>
              <span className="tg">Cliente · D1</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Design Session</span>
              <span className="tg">Cliente · D2</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Requisitos e Refino</span>
              <span className="tg">Interno</span>
            </li>
            <li>
              <span className="ix">06</span>
              <span className="nm">Alinhamento Final</span>
              <span className="tg">Cliente · D4</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Duração</div>
            <div className="v">
              <span className="accent">4</span> dias úteis
            </div>
          </div>
          <div className="cell">
            <div className="k">Etapas</div>
            <div className="v">06 marcos</div>
          </div>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">Síncrona com cliente</div>
          </div>
          <div className="cell">
            <div className="k">Output principal</div>
            <div className="v">Cronograma + tasks</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 01" num="04 / 10" />
    </>
  );
}
