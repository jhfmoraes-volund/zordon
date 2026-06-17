import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideQuemFaz() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            QUEM FAZ O QUÊ <span>/</span> RESPONSABILIDADE
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">RESPONSABILIDADE</span> · dono · cadência · em
            dia quando
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            Cada um faz a <em>sua parte</em>.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>Sprint Planning</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">PM</span>
              <span className="tag">Semanal</span>
            </div>
            <div className="body">
              <p>
                Você, PM, roda toda semana antes da sprint. Linka as reuniões e
                fontes da semana; a Vitoria propõe, você aprova.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Em dia quando</div>
              <div className="note">
                Existe uma planning publicada pra sprint atual.
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>PM Review</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Lead / Head Ops</span>
              <span className="tag">Semanal</span>
            </div>
            <div className="body">
              <p>
                Conduzido por quem lidera o projeto. Toda semana tem um — é o
                pulso que a liderança consulta quando quiser.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Em dia quando</div>
              <div className="note">
                A semana atual tem review publicada.
              </div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Release Planning</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Manager / Lead</span>
              <span className="tag">1× / projeto</span>
            </div>
            <div className="body">
              <p>
                Roda na imersão e re-roda quando o escopo muda de verdade.
                Define a ordem do roadmap e a quebra em sprints.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Em dia quando</div>
              <div className="note">
                Existe um roadmap aprovado e atual.
              </div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>Alguns rituais são do Head Ops — o que é seu, é seu</span>
          </div>
          <div>Cadência não negocia</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · QUEM FAZ O QUÊ" num="08 / 10" />
    </>
  );
}
