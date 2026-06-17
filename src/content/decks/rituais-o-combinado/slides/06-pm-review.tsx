import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlidePmReview() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            RITUAL 02 <span>/</span> PM REVIEW
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">RITUAL 02 · CADÊNCIA SEMANAL</div>
          <div className="ph-num">02</div>
          <div className="ph-name">PM Review</div>
          <p className="ph-desc">
            O pulso semanal do projeto. A Vitoria gera um report estruturado a
            partir das reuniões e notas da semana. Há um por semana (referência
            na segunda) e ele fica sempre consultável pela liderança — o último
            publicado aparece fixo no topo dos rituais.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Notas tipadas que estruturam o report</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Resumo</span>
              <span className="tg">Semana</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Direção do projeto</span>
              <span className="tg">Rumo</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">Próximo passo</span>
              <span className="tg">Ação</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Risco · Necessidade</span>
              <span className="tg">Alerta</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Sinal do time · Decisão aberta</span>
              <span className="tg">Pendência</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">
              <span className="accent">Semanal</span> · 1 por semana
            </div>
          </div>
          <div className="cell">
            <div className="k">Dono</div>
            <div className="v">Lead / Admin</div>
          </div>
          <div className="cell">
            <div className="k">Estado</div>
            <div className="v">draft → published</div>
          </div>
          <div className="cell">
            <div className="k">Output</div>
            <div className="v">Report + decisões</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · PM REVIEW" num="06 / 10" />
    </>
  );
}
