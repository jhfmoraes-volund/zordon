import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide01Cover() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            PLAYBOOK <span>/</span> OPERAÇÃO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">OPERAÇÃO VOLUND</span> · v1.0 · 2026
        </Eyebrow>
        <h1 className={styles.titleH1} style={{ marginTop: 28 }}>
          Como entregamos
          <br />
          <em>produto</em> com método,
          <br />
          <span className="quiet">do comercial ao go-live.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 32 }}>
          Três fases, um time, um cronograma claro. Da imersão com o cliente à
          operação assistida em produção — abaixo, o desenho completo do nosso
          fluxo.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Fases</div>
            <div className="v">
              <span className="accent">03</span>{" "}
              <span className="quiet">— imersão · ops · pós-ops</span>
            </div>
          </div>
          <div>
            <div className="k">Imersão</div>
            <div className="v">4 dias úteis</div>
          </div>
          <div>
            <div className="k">Operação</div>
            <div className="v">1 a 3 meses</div>
          </div>
          <div>
            <div className="k">Pós-Ops</div>
            <div className="v">3 meses</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO" num="01 / 10" />
    </>
  );
}
