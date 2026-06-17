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
            AGENTES <span>/</span> COMO FUNCIONAM
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">OS AGENTES DO ZORDON</span> · como funcionam ·
          PM &amp; Admin
        </Eyebrow>
        <h1 className={styles.titleH1} style={{ marginTop: 28 }}>
          O agente não é chat.
          <br />
          <em>É o motor do app</em>
          <br />
          <span className="quiet">onde o trabalho acontece.</span>
        </h1>
        <p className={styles.lede} style={{ marginTop: 32 }}>
          O Zordon é uma plataforma agêntica. Vitor, Vitoria e Alpha não vivem
          numa janela de chat à parte — eles operam dentro dos apps (Design
          Session, Rituais, Ops), enxergam o estado real e agem por ferramentas.
          Abaixo, o que cada um faz, onde vive e como roda por baixo.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Agentes</div>
            <div className="v">
              <span className="accent">03</span>{" "}
              <span className="quiet">— Vitor · Vitoria · Alpha</span>
            </div>
          </div>
          <div>
            <div className="k">Onde vivem</div>
            <div className="v">Dentro dos apps</div>
          </div>
          <div>
            <div className="k">Runtime</div>
            <div className="v">Claude Daemon + fallback</div>
          </div>
          <div>
            <div className="k">Acesso</div>
            <div className="v">PM &amp; Admin</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES" num="01 / 11" />
    </>
  );
}
