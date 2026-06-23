import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideMapa() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            O MAPA <span>/</span> APPS × AGENTES
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage}>
        <Eyebrow>
          <span className="pri">CADA APP TEM SEU AGENTE</span> · discovery ·
          rituais · operação
        </Eyebrow>
        <h2 className={styles.titleH2} style={{ maxWidth: 1400 }}>
          Três apps, três agentes —
          <br />
          cada um <em>dono do seu domínio</em>.
        </h2>

        <div className={styles.ovRail}>
          <div className="ov-phase">
            <div className="marker">1</div>
            <div className="ph-eyebrow">APP 01 · DISCOVERY</div>
            <h3>Design Session</h3>
            <div className="duration">· agente: Vitor</div>
            <p className="desc">
              Onde o porquê do produto nasce. Vitor conduz a descoberta —
              visão, personas, riscos, decisões — e propõe os PRDs.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Estrutura o contexto
              </div>
              <div className="step">
                <span className="ix">02</span>Registra decisões
              </div>
              <div className="step">
                <span className="ix">03</span>Propõe PRD
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">2</div>
            <div className="ph-eyebrow">APP 02 · RITUAIS</div>
            <h3>PM Review · Planning</h3>
            <div className="duration">· agente: Vitoria</div>
            <p className="desc">
              O copiloto do PM nos rituais. Enxerga sprint e capacidade, propõe
              o plano de tasks e stories, e redige o report da semana.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Lê sprint + capacidade
              </div>
              <div className="step">
                <span className="ix">02</span>Propõe tasks/stories
              </div>
              <div className="step">
                <span className="ix">03</span>Escreve o report
              </div>
            </div>
          </div>

          <div className="ov-phase">
            <div className="marker">3</div>
            <div className="ph-eyebrow">APP 03 · OPERAÇÃO</div>
            <h3>Ops</h3>
            <div className="duration">· agente: Alpha</div>
            <p className="desc">
              A visão de operação. Alpha responde sobre sprint, alertas,
              backlog e reuniões — e sabe em qual projeto você está.
            </p>
            <div className="steps">
              <div className="step">
                <span className="ix">01</span>Estado da operação
              </div>
              <div className="step">
                <span className="ix">02</span>Alertas + backlog
              </div>
              <div className="step">
                <span className="ix">03</span>Foco na rota
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · O MAPA" num="03 / 11" />
    </>
  );
}
