import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideAlimentarGranola() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            ROTINA <span>/</span> CURAR O GRANOLA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">A ROTINA DA SEMANA</span> · você cura, a
            Vitoria escreve
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1540 }}
          >
            Na prática, <em>sua semana é só o Granola</em>.
          </h2>
        </div>

        <div
          className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}
          style={{ alignContent: "center", gridAutoRows: "max-content" }}
        >
          <div className="step-card">
            <div className="head">
              <span>Você compartilha</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag">Você · no Granola</span>
            </div>
            <div className="body">
              <p>
                Toda reunião que importa, jogue a nota na folder do projeto, no
                Granola. É só compartilhar lá — nada a fazer no Zordon.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Notas curadas na folder</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>A Vitoria lê e escreve</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Vitoria · automático</span>
            </div>
            <div className="body">
              <p>
                Em dias úteis (~08h BRT), ela varre a folder, vê o que é novo e
                gera ou atualiza o rascunho do PM Review da semana.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Rascunho sempre fresco</div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Você revisa e publica</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Decisão humana</span>
            </div>
            <div className="body">
              <p>
                Abra o review, confira o que ela escreveu, ajuste o que precisar
                e publique. Aí vira a verdade da semana.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Review publicado</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>O que não cai na folder, a Vitoria não enxerga.</span>
          </div>
          <div>Curar o Granola = o hábito da semana</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · ROTINA" num="06 / 10" />
    </>
  );
}
