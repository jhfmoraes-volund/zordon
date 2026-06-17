import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideReleasePlanning() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            RITUAL 03 <span>/</span> RELEASE PLANNING
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">RITUAL 03 · 1× POR PROJETO</div>
          <div className="ph-num">03</div>
          <div className="ph-name">Release Planning</div>
          <p className="ph-desc">
            A ordem do roadmap. Decide a sequência dos PRDs e os quebra em
            stories e tasks, distribuídos nas sprints. Roda na imersão e
            re-roda quando o escopo muda de verdade — o roadmap é versionado a
            cada rodada.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Da entrada ao roadmap · 5 estados</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Draft</span>
              <span className="tg">PRDs priorizados</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Orchestrating</span>
              <span className="tg">Quebra em tasks</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">In-review</span>
              <span className="tg">Revisão</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Approved</span>
              <span className="tg">Roadmap versionado</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Re-rodável</span>
              <span className="tg">Escopo mudou</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">
              <span className="accent">1×</span> / projeto · re-rodável
            </div>
          </div>
          <div className="cell">
            <div className="k">Dono</div>
            <div className="v">Manager / Lead</div>
          </div>
          <div className="cell">
            <div className="k">Entrada</div>
            <div className="v">PRDs do Vitor</div>
          </div>
          <div className="cell">
            <div className="k">Output</div>
            <div className="v">Roadmap + sprints</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · RELEASE PLANNING" num="07 / 10" />
    </>
  );
}
