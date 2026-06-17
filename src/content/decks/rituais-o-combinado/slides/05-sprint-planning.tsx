import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideSprintPlanning() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            RITUAL 01 <span>/</span> SPRINT PLANNING
          </>
        }
      />
      <Crosshairs />

      <div className={styles.dividerStage}>
        <div className={styles.dividerId}>
          <div className="ph-eyebrow">RITUAL 01 · CADÊNCIA SEMANAL</div>
          <div className="ph-num">01</div>
          <div className="ph-name">Sprint Planning</div>
          <p className="ph-desc">
            O plano da sprint que vai começar. Você linka as reuniões e fontes
            da semana, a Vitoria lê e propõe o plano de tasks, e você aprova.
            Existe uma planning viva por sprint — reabrível enquanto a sprint
            não fecha.
          </p>
        </div>

        <div className={styles.dividerAgenda}>
          <div className="label">Ciclo do ritual · 5 estados</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Idle</span>
              <span className="tg">Criado</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Reading</span>
              <span className="tg">Lê contexto</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">Proposing</span>
              <span className="tg">Vitoria propõe</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Approving</span>
              <span className="tg">PM revisa</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Closed</span>
              <span className="tg">Plano publicado</span>
            </li>
          </ul>
        </div>

        <div className={styles.dividerMeta}>
          <div className="cell">
            <div className="k">Cadência</div>
            <div className="v">
              <span className="accent">Semanal</span> · 1 por sprint
            </div>
          </div>
          <div className="cell">
            <div className="k">Dono</div>
            <div className="v">PM / Lead</div>
          </div>
          <div className="cell">
            <div className="k">Alimenta com</div>
            <div className="v">Transcrições + fontes</div>
          </div>
          <div className="cell">
            <div className="k">Output</div>
            <div className="v">Plano de tasks da sprint</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · SPRINT PLANNING" num="05 / 10" />
    </>
  );
}
