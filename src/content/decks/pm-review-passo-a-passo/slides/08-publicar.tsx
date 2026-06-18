import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlidePublicar() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            PUBLICAR <span>/</span> APROVAR = VERDADE
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">PUBLICAR</span> · o gesto que importa
        </Eyebrow>
        <h1
          className={styles.titleH1}
          style={{ marginTop: 28, fontSize: 88, maxWidth: 1560 }}
        >
          Rascunho é proposta.
          <br />
          <em>Publicado é verdade.</em>
        </h1>
        <p className={styles.lede} style={{ marginTop: 30 }}>
          Os dois caminhos param no mesmo lugar: um rascunho. Você lê, ajusta e
          clica <strong>Publicar</strong>. Só então o review vira a fonte de
          verdade da semana — fica disponível pra consulta da liderança e
          congela: o cron não sobrescreve mais o que você aprovou (continua
          editável se você quiser).
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Antes</div>
            <div className="v">Rascunho · editável</div>
          </div>
          <div>
            <div className="k">Quem aprova</div>
            <div className="v">Você, PM (lead) ou admin</div>
          </div>
          <div>
            <div className="k">Depois</div>
            <div className="v">
              <span className="accent">Verdade da semana</span>{" "}
              <span className="quiet">— pra consulta</span>
            </div>
          </div>
          <div>
            <div className="k">Congela</div>
            <div className="v">Cron não sobrescreve</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · PUBLICAR" num="08 / 10" />
    </>
  );
}
