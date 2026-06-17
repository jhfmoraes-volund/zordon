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
            FECHAMENTO <span>/</span> O COMBINADO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">EM UMA FRASE</span> · agente = motor do app
        </Eyebrow>
        <h1 className={styles.titleH1} style={{ marginTop: 24 }}>
          O agente é tão bom
          <br />
          <em>quanto o app</em>
          <br />
          <span className="quiet">onde ele vive.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 28 }}>
          Vitor na Design Session, Vitoria nos Rituais, Alpha no Ops. Cada um vê
          o estado real, age por ferramentas do seu domínio e devolve a decisão
          pra você. Quanto mais em dia o app, mais o agente entrega.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Vitor</div>
            <div className="v">Design Session</div>
          </div>
          <div>
            <div className="k">Vitoria</div>
            <div className="v">Rituais</div>
          </div>
          <div>
            <div className="k">Alpha</div>
            <div className="v">Ops</div>
          </div>
          <div>
            <div className="k">Você</div>
            <div className="v">
              <span className="accent">No comando</span>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES" num="11 / 11" />
    </>
  );
}
