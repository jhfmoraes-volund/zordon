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
            RITUAIS <span>/</span> O COMBINADO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">RITUAIS DO PROJETO</span> · combinado interno ·
          PM &amp; Admin
        </Eyebrow>
        <h1 className={styles.titleH1} style={{ marginTop: 28 }}>
          Preencher ritual
          <br />
          <em>é parte do trabalho</em>,
          <br />
          <span className="quiet">não burocracia.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 32 }}>
          Os rituais são onde o contexto do projeto — reuniões, planilhas,
          Notion, Drive — vira a nossa realidade interna. Se o ritual não está
          em dia, o Zordon e a liderança ficam cegos. Abaixo, o combinado de
          como operamos cada um.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Rituais ativos</div>
            <div className="v">
              <span className="accent">03</span>{" "}
              <span className="quiet">— planning · review · release</span>
            </div>
          </div>
          <div>
            <div className="k">Cadência</div>
            <div className="v">Semanal a 1× / projeto</div>
          </div>
          <div>
            <div className="k">Dono</div>
            <div className="v">PM &amp; Head Ops</div>
          </div>
          <div>
            <div className="k">Regra</div>
            <div className="v">Sempre em dia</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS" num="01 / 10" />
    </>
  );
}
