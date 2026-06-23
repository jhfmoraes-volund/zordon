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
            Uma Vitoria, dois rituais —
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
              <span>Planning</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Propõe</span>
              <span className="tag">Contínuo</span>
            </div>
            <div className="body">
              <p>
                Vê capacidade e backlog, propõe tasks e distribui em sprints pra
                você aprovar. Nada entra sem o seu OK.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                propor task em lote · mover de sprint · estado da planning
              </div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Stories &amp; módulos</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Organiza</span>
              <span className="tag">novo</span>
            </div>
            <div className="body">
              <p>
                Lê a árvore de stories, carimba o módulo, propõe critérios de
                aceite e o commit da story — tudo como card pra você aprovar.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ferramentas</div>
              <div className="note">
                listar stories/módulos · update_story · approve_module
              </div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              Núcleo compartilhado: sprint · tasks · stories · capacidade ·
              dependências · DS
            </span>
          </div>
          <div>Mudanças viram card — você aprova ao Concluir</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · RITUAIS" num="05 / 11" />
    </>
  );
}
