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
          <span className="pri">EM UMA LINHA</span> · comece agora
        </Eyebrow>
        <h1
          className={styles.titleH1}
          style={{ marginTop: 28, fontSize: 84, maxWidth: 1580 }}
        >
          PM Review publicado
          <br />
          <em>= projeto com pulso</em>
          <br />
          <span className="quiet">= liderança enxergando.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 30 }}>
          Jogue as transcrições da semana na pasta do projeto, dentro do
          Granola, confira o rascunho que a Vitoria montou e publique. Sem
          Granola? Crie o review na mão pela aba <strong>Apps → Cerimônias</strong>.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Passo 01</div>
            <div className="v">Alimente o Granola da semana</div>
          </div>
          <div>
            <div className="k">Passo 02</div>
            <div className="v">A Vitoria monta o rascunho</div>
          </div>
          <div>
            <div className="k">Passo 03</div>
            <div className="v">Apps → Cerimônias e confira</div>
          </div>
          <div>
            <div className="k">Passo 04</div>
            <div className="v">
              <span className="accent">Publique</span>{" "}
              <span className="quiet">— terça a sexta</span>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · PASSO A PASSO" num="10 / 10" />
    </>
  );
}
