import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideCover() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            PM REVIEW <span>/</span> PASSO A PASSO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">PM REVIEW</span> · tutorial prático · PM &amp;
          Admin
        </Eyebrow>
        <h1 className={styles.titleH1} style={{ marginTop: 28 }}>
          Toda semana,
          <br />
          <em>um PM Review publicado</em>
          <br />
          <span className="quiet">por projeto.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 32 }}>
          O PM Review é o pulso semanal do projeto: um report que a Vitoria
          escreve a partir das reuniões e notas da semana. Você monta na mão ou
          deixa a automação do Granola montar pra você — nos dois caminhos ele
          nasce rascunho e só vira verdade quando <strong>você publica</strong>.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Cadência</div>
            <div className="v">
              <span className="accent">Semanal</span>{" "}
              <span className="quiet">— 1 por projeto</span>
            </div>
          </div>
          <div>
            <div className="k">Janela</div>
            <div className="v">Terça a sexta</div>
          </div>
          <div>
            <div className="k">Dono</div>
            <div className="v">O PM do projeto</div>
          </div>
          <div>
            <div className="k">Regra</div>
            <div className="v">Sempre publicado</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW" num="01 / 10" />
    </>
  );
}
