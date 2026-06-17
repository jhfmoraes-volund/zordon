import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideRituais() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            APP 02 <span>/</span> RITUAIS · VITORIA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">RITUAIS</span> · copiloto do PM · agente:
            Vitoria
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1500 }}
          >
            Uma Vitoria, três rituais —
            <br />
            <em>mesmo núcleo</em> de visão de sprint.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>PM Review</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Report</span>
              <span className="tag">Semanal</span>
            </div>
            <div className="body">
              <p>
                Lê reuniões, notas e indicadores e redige o report da semana —
                enxergando a sprint, não só o texto.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                ler transcrição · notas · indicadores · report
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Sprint Planning</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Propõe</span>
              <span className="tag">Por sprint</span>
            </div>
            <div className="body">
              <p>
                Vê capacidade e backlog, propõe o plano de tasks/stories pra
                você aprovar. Nada entra sem o seu OK.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                propor task/story · staging · estado da planning
              </div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Release Planning</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Roadmap</span>
              <span className="tag">1× / projeto</span>
            </div>
            <div className="body">
              <p>
                Apoia a ordem do roadmap e a quebra em sprints. Toolset dedicado
                ainda em evolução (ver roadmap).
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">núcleo de leitura · em expansão</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              Núcleo compartilhado: sprint · tasks · capacidade · dependências ·
              DS
            </span>
          </div>
          <div>Só os writes mudam por ritual</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · RITUAIS" num="05 / 11" />
    </>
  );
}
