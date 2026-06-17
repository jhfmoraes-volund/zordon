import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideFechamento() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FECHAMENTO <span>/</span> COMECE AGORA
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">O COMBINADO</span> · em uma linha
        </Eyebrow>
        <h1
          className={styles.titleH1}
          style={{ marginTop: 28, fontSize: 88, maxWidth: 1560 }}
        >
          Ritual em dia
          <br />
          <em>= projeto visível</em>
          <br />
          <span className="quiet">= decisão boa.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 30 }}>
          Abra a aba <strong>Rituais</strong> do seu projeto e mantenha o seu
          em dia. É o gesto que faz o contexto de fora virar a realidade que o
          time enxerga.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Passo 01</div>
            <div className="v">Abra a aba Rituais</div>
          </div>
          <div>
            <div className="k">Passo 02</div>
            <div className="v">Crie o ritual da semana</div>
          </div>
          <div>
            <div className="k">Passo 03</div>
            <div className="v">Linke as fontes</div>
          </div>
          <div>
            <div className="k">Passo 04</div>
            <div className="v">
              <span className="accent">Aprove</span>{" "}
              <span className="quiet">o que a Vitoria propõe</span>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · O COMBINADO" num="10 / 10" />
    </>
  );
}
